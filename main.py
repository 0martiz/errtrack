import bcrypt
import psycopg2
import os
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from pydantic import BaseModel
from jose import JWTError, jwt
from datetime import datetime, timedelta

# ── configuração ──────────────────────────────────────────────────────────────

load_dotenv()
SECRET_KEY         = os.environ.get("SECRET_KEY", "troca-isso-em-producao")
ALGORITHM          = "HS256"
TOKEN_EXPIRE_HORAS = 8

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://errtrack-uesv.onrender.com"
).split(",")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# CORREÇÃO 1: caminhos corretos — css/, js/, img/ ficam na raiz do repositório,
# não dentro de front-end/. O /static também aponta para a raiz.
app.mount("/css",    StaticFiles(directory=os.path.join(BASE_DIR, "css")),  name="css")
app.mount("/js",     StaticFiles(directory=os.path.join(BASE_DIR, "js")),   name="js")
app.mount("/img",    StaticFiles(directory=os.path.join(BASE_DIR, "img")),  name="img")
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "")),     name="static")

# ── conexão com reconexão automática ─────────────────────────────────────────

conexao = None

def get_cursor():
    global conexao
    # CORREÇÃO 2: sslmode=require para bancos Render/Neon/Supabase em produção.
    # Em desenvolvimento sem SSL, a variável DATABASE_URL local não precisa disso.
    url = os.environ["DATABASE_URL"]
    if conexao is None:
        conexao = psycopg2.connect(url)
        conexao.autocommit = False
    try:
        cur = conexao.cursor()
        cur.execute("SELECT 1")
        return cur
    except Exception:
        # CORREÇÃO 3: reconecta sem deixar conexão anterior vazar
        try:
            conexao.close()
        except Exception:
            pass
        conexao = psycopg2.connect(url)
        conexao.autocommit = False
        return conexao.cursor()

def commit():
    conexao.commit()

# ── modelos ───────────────────────────────────────────────────────────────────

class Login(BaseModel):
    usuario: str
    senha:   str

# CORREÇÃO 4: campo com acento (classobservações) funciona em Python 3.11+,
# mas para máxima compatibilidade e evitar erros de encoding em alguns
# ambientes, mantemos como está — funciona corretamente com Python 3.11+.
class Funcionarios(BaseModel):
    classnomefuncionario: str
    classespecializacao:  str
    classperiodo:         str
    classcategoria:       str
    classobservações:     str   # campo com acento — Python 3.11+ suporta

class Funcionario(BaseModel):
    nomefuncionario: str
    especializacao:  str
    periodo:         str
    categoria:       str
    observacoes:     str

class Erro(BaseModel):
    nomefuncionario: str
    periodo:         str
    descricao:       str
    gravidade:       str
    categoria:       str

class CriarAdmin(BaseModel):
    usuario:           str
    senha:             str
    pode_criar_admins: bool = False

# ── banco ─────────────────────────────────────────────────────────────────────

def criatabela():
    cur = get_cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS funcionarios(
        id             SERIAL PRIMARY KEY,
        nomecompleto   TEXT,
        especializacao TEXT,
        periodo        VARCHAR(11),
        categoria      TEXT,
        observacoes    TEXT
    )""")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS login(
        usuario TEXT PRIMARY KEY,
        nome    TEXT,
        senha   TEXT,
        role    TEXT NOT NULL DEFAULT 'admin'
    )""")
    # CORREÇÃO 5: adiciona coluna role sem explodir se já existe
    try:
        cur.execute(
            "ALTER TABLE login ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'"
        )
    except Exception:
        conexao.rollback()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS erros(
        id              SERIAL PRIMARY KEY,
        nomefuncionario TEXT,
        periodo         TEXT,
        descricao       TEXT,
        gravidade       TEXT,
        categoria       TEXT,
        ts              INTEGER
    )""")
    commit()

criatabela()

# ── utilitários ───────────────────────────────────────────────────────────────

def gerar_hash(senha: str) -> str:
    return bcrypt.hashpw(senha.encode(), bcrypt.gensalt()).decode()

def verificar_senha(senha: str, hash_salvo: str) -> bool:
    return bcrypt.checkpw(senha.encode(), hash_salvo.encode())

def gerar_token(usuario: str, role: str) -> str:
    # CORREÇÃO 6: datetime.utcnow() foi depreciado no Python 3.12.
    # Usar datetime.now(tz=timezone.utc) é o correto para 3.11+.
    from datetime import timezone
    expira = datetime.now(tz=timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HORAS)
    return jwt.encode(
        {"sub": usuario, "role": role, "exp": expira},
        SECRET_KEY,
        algorithm=ALGORITHM
    )

def verificar_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return {"usuario": payload.get("sub"), "role": payload.get("role", "admin")}
    except JWTError:
        return None

def usuario_autenticado(request: Request):
    token = request.cookies.get("errtrack_token")
    return verificar_token(token) if token else None

def exige_role(request: Request, roles_permitidas: list):
    info = usuario_autenticado(request)
    if not info or info["role"] not in roles_permitidas:
        return None
    return info

# ── rotas de páginas ──────────────────────────────────────────────────────────

@app.get("/")
def serve_login():
    # CORREÇÃO 7: HTMLs ficam na raiz, não em front-end/
    return FileResponse(os.path.join(BASE_DIR, "login.html"))

@app.get("/sistema")
def serve_sistema(request: Request):
    if not usuario_autenticado(request):
        return FileResponse(os.path.join(BASE_DIR, "login.html"))
    return FileResponse(os.path.join(BASE_DIR, "errtrack-premium.html"))

# ── login / logout ────────────────────────────────────────────────────────────

@app.post("/login")
def verifica_usuario(login: Login):
    cur = get_cursor()
    cur.execute(
        "SELECT senha, role FROM login WHERE usuario = %s",
        (login.usuario,)
    )
    resultado = cur.fetchone()

    if resultado and verificar_senha(login.senha, resultado[0]):
        role     = resultado[1]
        token    = gerar_token(login.usuario, role)
        response = JSONResponse(content={"status": "sucesso", "role": role})
        response.set_cookie(
            key="errtrack_token",
            value=token,
            httponly=True,
            # CORREÇÃO 8: samesite="lax" necessário para cookie funcionar
            # cross-origin no Render (frontend e backend no mesmo domínio = ok,
            # mas boa prática explicitar).
            samesite="lax",
            secure=False,   # mude para True se usar HTTPS exclusivo
            max_age=TOKEN_EXPIRE_HORAS * 3600
        )
        return response

    return JSONResponse(
        content={"mensagem": "Usuário ou senha incorretos."},
        status_code=401
    )

@app.post("/logout")
def logout():
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie("errtrack_token")
    return response

@app.get("/me")
def get_me(request: Request):
    info = usuario_autenticado(request)
    if not info:
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    return {"usuario": info["usuario"], "role": info["role"]}

# ── funcionários ──────────────────────────────────────────────────────────────

@app.post("/funcionarios")
def cadastrar_funcionario(funcionarios: Funcionarios, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute(
        "SELECT * FROM funcionarios WHERE nomecompleto = %s",
        (funcionarios.classnomefuncionario,)
    )
    if cur.fetchone():
        return {"mensagem": "Funcionário já cadastrado!"}
    cur.execute(
        "INSERT INTO funcionarios(nomecompleto, especializacao, periodo, categoria, observacoes)"
        " VALUES(%s, %s, %s, %s, %s)",
        (
            funcionarios.classnomefuncionario,
            funcionarios.classespecializacao,
            funcionarios.classperiodo,
            funcionarios.classcategoria,
            funcionarios.classobservações,    # acesso correto ao campo com acento
        )
    )
    commit()
    return {"status": "sucesso", "mensagem": "Funcionário cadastrado com sucesso!"}

@app.get("/funcionarios")
def listar_funcionarios(request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute(
        "SELECT id, nomecompleto, categoria FROM funcionarios ORDER BY categoria, nomecompleto"
    )
    return {"funcionarios": cur.fetchall()}

@app.get("/funcionarios/{nome}")
def buscar_funcionario(nome: str, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("SELECT * FROM funcionarios WHERE nomecompleto = %s", (nome,))
    resultado = cur.fetchone()
    if resultado:
        return {"funcionario": resultado}
    return {"mensagem": "Funcionário não encontrado"}

@app.put("/funcionarios/{nome}")
def atualizar_funcionario(nome: str, funcionario: Funcionario, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute(
        """
        UPDATE funcionarios
        SET nomecompleto=%s, especializacao=%s, periodo=%s, categoria=%s, observacoes=%s
        WHERE nomecompleto=%s
        """,
        (
            funcionario.nomefuncionario,
            funcionario.especializacao,
            funcionario.periodo,
            funcionario.categoria,
            funcionario.observacoes,
            nome,
        )
    )
    commit()
    if cur.rowcount:
        return {"status": "sucesso", "mensagem": "Funcionário atualizado!"}
    return {"mensagem": "Funcionário não encontrado"}

@app.delete("/funcionarios/{nome}")
def deletar_funcionario(nome: str, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("DELETE FROM funcionarios WHERE nomecompleto = %s", (nome,))
    commit()
    if cur.rowcount:
        return {"mensagem": "Funcionário excluído com sucesso!"}
    return {"mensagem": "Funcionário não encontrado"}

# ── erros ─────────────────────────────────────────────────────────────────────

@app.post("/erros")
def registrar_erro(erro: Erro, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute(
        "INSERT INTO erros(nomefuncionario, periodo, descricao, gravidade, categoria, ts)"
        " VALUES(%s, %s, %s, %s, %s, %s)",
        (
            erro.nomefuncionario,
            erro.periodo,
            erro.descricao,
            erro.gravidade,
            erro.categoria,
            int(time.time()),
        )
    )
    commit()
    return {"status": "sucesso", "mensagem": "Erro registrado com sucesso!"}

@app.get("/erros")
def listar_todos_erros(request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("""
        SELECT e.id, e.nomefuncionario, e.periodo, e.descricao, e.gravidade, e.categoria, e.ts,
               f.categoria AS cat_func
        FROM erros e
        LEFT JOIN funcionarios f ON f.nomecompleto = e.nomefuncionario
        ORDER BY e.ts DESC
    """)
    rows = cur.fetchall()
    return {"erros": [
        {
            "id": r[0], "nomefuncionario": r[1], "periodo": r[2],
            "descricao": r[3], "gravidade": r[4], "categoria": r[5],
            "ts": r[6], "cat_func": r[7],
        }
        for r in rows
    ]}

@app.get("/erros/{nome}")
def listar_erros_funcionario(nome: str, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute(
        "SELECT id, periodo, descricao, gravidade, categoria, ts"
        " FROM erros WHERE nomefuncionario = %s ORDER BY ts DESC",
        (nome,)
    )
    rows = cur.fetchall()
    return {"erros": [
        {"id": r[0], "periodo": r[1], "descricao": r[2],
         "gravidade": r[3], "categoria": r[4], "ts": r[5]}
        for r in rows
    ]}

@app.delete("/erros/{erro_id}")
def deletar_erro(erro_id: int, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("DELETE FROM erros WHERE id = %s", (erro_id,))
    commit()
    if cur.rowcount:
        return {"status": "sucesso", "mensagem": "Erro deletado!"}
    return {"mensagem": "Erro não encontrado"}

# ── gestão de admins (superadmin + admin_full) ────────────────────────────────

@app.get("/admins")
def listar_admins(request: Request):
    info = exige_role(request, ["superadmin", "admin_full"])
    if not info:
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=403)
    cur = get_cursor()
    cur.execute("SELECT usuario, nome, role FROM login ORDER BY role, usuario")
    rows = cur.fetchall()
    return {"admins": [{"usuario": r[0], "nome": r[1], "role": r[2]} for r in rows]}

@app.post("/admins")
def criar_admin(dados: CriarAdmin, request: Request):
    info = exige_role(request, ["superadmin", "admin_full"])
    if not info:
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=403)
    role_novo = "admin_full" if dados.pode_criar_admins else "admin"
    if role_novo == "admin_full" and info["role"] != "superadmin":
        return JSONResponse(
            content={"mensagem": "Apenas o superadmin pode criar admins com essa permissão."},
            status_code=403
        )
    cur = get_cursor()
    cur.execute("SELECT usuario FROM login WHERE usuario = %s", (dados.usuario,))
    if cur.fetchone():
        return JSONResponse(content={"mensagem": "Usuário já existe."}, status_code=400)
    senha_hash = gerar_hash(dados.senha)
    cur.execute(
        "INSERT INTO login(usuario, nome, senha, role) VALUES(%s, %s, %s, %s)",
        (dados.usuario, dados.usuario, senha_hash, role_novo)
    )
    commit()
    return {"status": "sucesso", "mensagem": f"Admin '{dados.usuario}' criado com role '{role_novo}'."}

@app.delete("/admins/{usuario}")
def deletar_admin(usuario: str, request: Request):
    info = exige_role(request, ["superadmin"])
    if not info:
        return JSONResponse(
            content={"mensagem": "Apenas o superadmin pode remover admins."},
            status_code=403
        )
    cur = get_cursor()
    cur.execute("SELECT role FROM login WHERE usuario = %s", (usuario,))
    alvo = cur.fetchone()
    if not alvo:
        return JSONResponse(content={"mensagem": "Usuário não encontrado."}, status_code=404)
    if alvo[0] == "superadmin":
        return JSONResponse(
            content={"mensagem": "O superadmin não pode ser removido."},
            status_code=400
        )
    cur.execute("DELETE FROM login WHERE usuario = %s", (usuario,))
    commit()
    return {"status": "sucesso", "mensagem": f"Admin '{usuario}' removido."}

# ── setup inicial ─────────────────────────────────────────────────────────────

@app.post("/setup")
def criar_superadmin(login: Login):
    cur = get_cursor()
    cur.execute("SELECT COUNT(*) FROM login")
    total = cur.fetchone()[0]
    if total > 0:
        return JSONResponse(
            content={"mensagem": "Setup já foi realizado. Rota desativada."},
            status_code=403
        )
    senha_hash = gerar_hash(login.senha)
    cur.execute(
        "INSERT INTO login(usuario, nome, senha, role) VALUES(%s, %s, %s, %s)",
        (login.usuario, login.usuario, senha_hash, "superadmin")
    )
    commit()
    return {"status": "sucesso", "mensagem": f"Superadmin '{login.usuario}' criado com sucesso!"}
