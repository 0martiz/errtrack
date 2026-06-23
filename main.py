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
from datetime import datetime, timedelta, timezone

# ── configuração ──────────────────────────────────────────────────────────────

load_dotenv()

SECRET_KEY         = os.environ.get("SECRET_KEY", "troca-isso-em-producao")
ALGORITHM          = "HS256"
TOKEN_EXPIRE_HORAS = 8
IS_PROD            = os.environ.get("RENDER") == "true"   # Render define RENDER=true automaticamente

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://errtrack.onrender.com"
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

# ── static files ──────────────────────────────────────────────────────────────
# /static removido — /css, /js e /img já cobrem tudo sem conflito

app.mount("/css", StaticFiles(directory=os.path.join(BASE_DIR, "front-end/css")), name="css")
app.mount("/js",  StaticFiles(directory=os.path.join(BASE_DIR, "front-end/js")),  name="js")
app.mount("/img", StaticFiles(directory=os.path.join(BASE_DIR, "front-end/img")), name="img")

# ── conexão com reconexão automática ─────────────────────────────────────────

conexao = None

def get_cursor():
    """
    Retorna um cursor ativo.
    Se a conexão estiver morta (timeout, restart do banco free tier),
    fecha a conexão antiga e abre uma nova antes de devolver o cursor.
    """
    global conexao
    try:
        if conexao is None or conexao.closed:
            raise Exception("conexão nula ou fechada")
        cur = conexao.cursor()
        cur.execute("SELECT 1")
        return cur
    except Exception:
        # Fecha a conexão antiga para não vazar recursos
        if conexao is not None:
            try:
                conexao.close()
            except Exception:
                pass
        conexao = psycopg2.connect(
            os.environ["DATABASE_URL"],
            connect_timeout=10
        )
        return conexao.cursor()

def commit():
    conexao.commit()

# ── criação de tabelas via startup event ──────────────────────────────────────
# FIX BUG 1: criatabela() estava sendo chamada no toplevel (linha solta).
# Isso causava crash imediato se DATABASE_URL não estivesse disponível
# no exato momento do import. Agora é executada apenas após o app estar pronto.

@app.on_event("startup")
def startup():
    _criatabela()

def _criatabela():
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
    # Migração segura: adiciona coluna role se a tabela já existia sem ela
    try:
        cur.execute("ALTER TABLE login ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'")
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

# ── modelos ───────────────────────────────────────────────────────────────────

class Login(BaseModel):
    usuario: str
    senha:   str

class Funcionarios(BaseModel):
    classnomefuncionario: str
    classespecializacao:  str
    classperiodo:         str
    classcategoria:       str
    classobservacoes:     str   # FIX BUG 7: era classobservações (com acento)

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

# ── utilitários ───────────────────────────────────────────────────────────────

def gerar_hash(senha: str) -> str:
    return bcrypt.hashpw(senha.encode(), bcrypt.gensalt()).decode()

def verificar_senha(senha: str, hash_salvo: str) -> bool:
    return bcrypt.checkpw(senha.encode(), hash_salvo.encode())

def gerar_token(usuario: str, role: str) -> str:
    # FIX BUG 6: datetime.utcnow() está deprecated no Python 3.12+
    expira = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HORAS)
    return jwt.encode({"sub": usuario, "role": role, "exp": expira}, SECRET_KEY, algorithm=ALGORITHM)

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
    return FileResponse(os.path.join(BASE_DIR, "front-end/login.html"))

@app.get("/sistema")
def serve_sistema(request: Request):
    if not usuario_autenticado(request):
        return FileResponse(os.path.join(BASE_DIR, "front-end/login.html"))
    path = os.path.join(BASE_DIR, "front-end/errtrack-premium.html")
    with open(path, "r") as f:
        content = f.read().replace("/static/conectaapi.js", "/js/conectaapi.js")
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=content)

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
        role  = resultado[1]
        token = gerar_token(login.usuario, role)
        response = JSONResponse(content={"status": "sucesso", "role": role})
        # FIX BUG 4: adicionado samesite="lax" e secure condicional
        # samesite="lax" funciona em HTTPS same-origin (Render) sem precisar de none
        response.set_cookie(
            key="errtrack_token",
            value=token,
            httponly=True,
            max_age=TOKEN_EXPIRE_HORAS * 3600,
            samesite="lax",
            secure=IS_PROD,
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
        "SELECT id FROM funcionarios WHERE nomecompleto = %s",
        (funcionarios.classnomefuncionario,)
    )
    if cur.fetchone():
        return {"mensagem": "Funcionário já cadastrado!"}
    cur.execute(
        "INSERT INTO funcionarios(nomecompleto, especializacao, periodo, categoria, observacoes) VALUES(%s, %s, %s, %s, %s)",
        (
            funcionarios.classnomefuncionario,
            funcionarios.classespecializacao,
            funcionarios.classperiodo,
            funcionarios.classcategoria,
            funcionarios.classobservacoes,   # FIX BUG 7: campo sem acento
        )
    )
    commit()
    return {"status": "sucesso", "mensagem": "Funcionário cadastrado com sucesso!"}

@app.get("/funcionarios")
def listar_funcionarios(request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("SELECT id, nomecompleto, categoria FROM funcionarios ORDER BY categoria, nomecompleto")
    rows = cur.fetchall()
    return {"funcionarios": [{"id": r[0], "nomecompleto": r[1], "categoria": r[2]} for r in rows]}

@app.get("/funcionarios/{nome}")
def buscar_funcionario(nome: str, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("SELECT id, nomecompleto, especializacao, periodo, categoria, observacoes FROM funcionarios WHERE nomecompleto = %s", (nome,))
    r = cur.fetchone()
    if r:
        return {"funcionario": {"id": r[0], "nomecompleto": r[1], "especializacao": r[2], "periodo": r[3], "categoria": r[4], "observacoes": r[5]}}
    return JSONResponse(content={"mensagem": "Funcionário não encontrado"}, status_code=404)

@app.put("/funcionarios/{nome}")
def atualizar_funcionario(nome: str, funcionario: Funcionario, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("""
        UPDATE funcionarios
        SET nomecompleto=%s, especializacao=%s, periodo=%s, categoria=%s, observacoes=%s
        WHERE nomecompleto=%s
    """, (
        funcionario.nomefuncionario, funcionario.especializacao,
        funcionario.periodo, funcionario.categoria,
        funcionario.observacoes, nome
    ))
    commit()
    if cur.rowcount:
        return {"status": "sucesso", "mensagem": "Funcionário atualizado!"}
    return JSONResponse(content={"mensagem": "Funcionário não encontrado"}, status_code=404)

@app.delete("/funcionarios/{nome}")
def deletar_funcionario(nome: str, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute("DELETE FROM funcionarios WHERE nomecompleto = %s", (nome,))
    commit()
    if cur.rowcount:
        return {"mensagem": "Funcionário excluído com sucesso!"}
    return JSONResponse(content={"mensagem": "Funcionário não encontrado"}, status_code=404)

# ── erros ─────────────────────────────────────────────────────────────────────

@app.post("/erros")
def registrar_erro(erro: Erro, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute(
        "INSERT INTO erros(nomefuncionario, periodo, descricao, gravidade, categoria, ts) VALUES(%s, %s, %s, %s, %s, %s)",
        (erro.nomefuncionario, erro.periodo, erro.descricao, erro.gravidade, erro.categoria, int(time.time()))
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
               f.categoria as cat_func
        FROM erros e
        LEFT JOIN funcionarios f ON f.nomecompleto = e.nomefuncionario
        ORDER BY e.ts DESC
    """)
    rows = cur.fetchall()
    return {"erros": [
        {"id": r[0], "nomefuncionario": r[1], "periodo": r[2], "descricao": r[3],
         "gravidade": r[4], "categoria": r[5], "ts": r[6], "cat_func": r[7]}
        for r in rows
    ]}

@app.get("/erros/{nome}")
def listar_erros_funcionario(nome: str, request: Request):
    if not usuario_autenticado(request):
        return JSONResponse(content={"mensagem": "Não autorizado."}, status_code=401)
    cur = get_cursor()
    cur.execute(
        "SELECT id, periodo, descricao, gravidade, categoria, ts FROM erros WHERE nomefuncionario = %s ORDER BY ts DESC",
        (nome,)
    )
    rows = cur.fetchall()
    return {"erros": [
        {"id": r[0], "periodo": r[1], "descricao": r[2], "gravidade": r[3], "categoria": r[4], "ts": r[5]}
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
    return JSONResponse(content={"mensagem": "Erro não encontrado"}, status_code=404)

# ── gestão de admins ──────────────────────────────────────────────────────────

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
    cur.execute(
        "INSERT INTO login(usuario, nome, senha, role) VALUES(%s, %s, %s, %s)",
        (dados.usuario, dados.usuario, gerar_hash(dados.senha), role_novo)
    )
    commit()
    return {"status": "sucesso", "mensagem": f"Admin '{dados.usuario}' criado com role '{role_novo}'."}

@app.delete("/admins/{usuario}")
def deletar_admin(usuario: str, request: Request):
    info = exige_role(request, ["superadmin"])
    if not info:
        return JSONResponse(content={"mensagem": "Apenas o superadmin pode remover admins."}, status_code=403)
    cur = get_cursor()
    cur.execute("SELECT role FROM login WHERE usuario = %s", (usuario,))
    alvo = cur.fetchone()
    if not alvo:
        return JSONResponse(content={"mensagem": "Usuário não encontrado."}, status_code=404)
    if alvo[0] == "superadmin":
        return JSONResponse(content={"mensagem": "O superadmin não pode ser removido."}, status_code=400)
    cur.execute("DELETE FROM login WHERE usuario = %s", (usuario,))
    commit()
    return {"status": "sucesso", "mensagem": f"Admin '{usuario}' removido."}

# ── setup inicial (cria o primeiro superadmin) ────────────────────────────────

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
    cur.execute(
        "INSERT INTO login(usuario, nome, senha, role) VALUES(%s, %s, %s, %s)",
        (login.usuario, login.usuario, gerar_hash(login.senha), "superadmin")
    )
    commit()
    return {"status": "sucesso", "mensagem": f"Superadmin '{login.usuario}' criado com sucesso!"}
