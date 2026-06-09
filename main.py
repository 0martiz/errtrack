import os
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import bcrypt
import psycopg2
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel, Field

try:
    from pydantic import ConfigDict
except ImportError:  # Pydantic 1.x fallback
    ConfigDict = None


load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
SECRET_KEY = os.getenv("SECRET_KEY", "troca-isso-em-producao")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HORAS = int(os.getenv("TOKEN_EXPIRE_HORAS", "8"))
DATABASE_URL = os.getenv("DATABASE_URL")

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://errtrack-uesv.onrender.com",
    "https://errtrack.onrender.com",
]
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", ",".join(DEFAULT_ALLOWED_ORIGINS)).split(",")
    if origin.strip()
]

app = FastAPI(title="ErrTrack")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/css", StaticFiles(directory=BASE_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=BASE_DIR / "js"), name="js")
app.mount("/img", StaticFiles(directory=BASE_DIR / "img"), name="img")


class Login(BaseModel):
    usuario: str
    senha: str


class Funcionarios(BaseModel):
    classnomefuncionario: str
    classespecializacao: str = ""
    classperiodo: str = ""
    classcategoria: str
    classobservacoes: str = Field(default="", alias="classobservações")

    if ConfigDict:
        model_config = ConfigDict(populate_by_name=True)
    else:
        class Config:
            allow_population_by_field_name = True


class Funcionario(BaseModel):
    nomefuncionario: str
    especializacao: str = ""
    periodo: str = ""
    categoria: str
    observacoes: str = ""


class Erro(BaseModel):
    nomefuncionario: str
    periodo: str = ""
    descricao: str
    gravidade: str
    categoria: str


class CriarAdmin(BaseModel):
    usuario: str
    senha: str
    pode_criar_admins: bool = False


def erro_json(mensagem: str, status_code: int) -> JSONResponse:
    return JSONResponse(content={"mensagem": mensagem}, status_code=status_code)


def database_url() -> str:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL não configurada.")
    return DATABASE_URL


@contextmanager
def db_cursor():
    conn = psycopg2.connect(database_url())
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def criar_tabelas() -> None:
    with db_cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS funcionarios(
                id SERIAL PRIMARY KEY,
                nomecompleto TEXT,
                especializacao TEXT,
                periodo VARCHAR(20),
                categoria TEXT,
                observacoes TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS login(
                usuario TEXT PRIMARY KEY,
                nome TEXT,
                senha TEXT,
                role TEXT NOT NULL DEFAULT 'admin'
            )
            """
        )
        cur.execute("ALTER TABLE login ADD COLUMN IF NOT EXISTS nome TEXT")
        cur.execute("ALTER TABLE login ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS erros(
                id SERIAL PRIMARY KEY,
                nomefuncionario TEXT,
                periodo TEXT,
                descricao TEXT,
                gravidade TEXT,
                categoria TEXT,
                ts INTEGER
            )
            """
        )


@app.on_event("startup")
def startup() -> None:
    criar_tabelas()


def gerar_hash(senha: str) -> str:
    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verificar_senha(senha: str, hash_salvo: str) -> bool:
    if not hash_salvo:
        return False
    return bcrypt.checkpw(senha.encode("utf-8"), hash_salvo.encode("utf-8"))


def gerar_token(usuario: str, role: str) -> str:
    expira = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HORAS)
    return jwt.encode({"sub": usuario, "role": role, "exp": expira}, SECRET_KEY, algorithm=ALGORITHM)


def verificar_token(token: str | None) -> dict[str, str] | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None

    usuario = payload.get("sub")
    if not usuario:
        return None
    return {"usuario": usuario, "role": payload.get("role", "admin")}


def usuario_autenticado(request: Request) -> dict[str, str] | None:
    return verificar_token(request.cookies.get("errtrack_token"))


def exige_autenticacao(request: Request) -> dict[str, str] | None:
    return usuario_autenticado(request)


def exige_role(request: Request, roles_permitidas: list[str]) -> dict[str, str] | None:
    info = usuario_autenticado(request)
    if not info or info["role"] not in roles_permitidas:
        return None
    return info


def row_to_list(row: tuple[Any, ...] | None) -> list[Any] | None:
    return list(row) if row else None


@app.get("/")
def serve_login():
    return FileResponse(BASE_DIR / "login.html")


@app.get("/sistema")
def serve_sistema(request: Request):
    if not usuario_autenticado(request):
        return FileResponse(BASE_DIR / "login.html")
    return FileResponse(BASE_DIR / "errtrack-premium.html")


@app.get("/health")
def health():
    return {"status": "ok", "database_configurada": bool(DATABASE_URL)}


@app.post("/login")
def verifica_usuario(login: Login, request: Request):
    with db_cursor() as cur:
        cur.execute("SELECT senha, role FROM login WHERE usuario = %s", (login.usuario,))
        resultado = cur.fetchone()

    if not resultado or not verificar_senha(login.senha, resultado[0]):
        return erro_json("Usuário ou senha incorretos.", 401)

    role = resultado[1]
    token = gerar_token(login.usuario, role)
    response = JSONResponse(content={"status": "sucesso", "role": role})
    response.set_cookie(
        key="errtrack_token",
        value=token,
        httponly=True,
        max_age=TOKEN_EXPIRE_HORAS * 3600,
        secure=request.url.scheme == "https",
        samesite="lax",
    )
    return response


@app.post("/logout")
def logout():
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie("errtrack_token")
    return response


@app.get("/me")
def get_me(request: Request):
    info = usuario_autenticado(request)
    if not info:
        return erro_json("Não autorizado.", 401)
    return {"usuario": info["usuario"], "role": info["role"]}


@app.post("/funcionarios")
def cadastrar_funcionario(funcionarios: Funcionarios, request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute(
            "SELECT id FROM funcionarios WHERE nomecompleto = %s",
            (funcionarios.classnomefuncionario,),
        )
        if cur.fetchone():
            return {"mensagem": "Funcionário já cadastrado!"}

        cur.execute(
            """
            INSERT INTO funcionarios(nomecompleto, especializacao, periodo, categoria, observacoes)
            VALUES(%s, %s, %s, %s, %s)
            """,
            (
                funcionarios.classnomefuncionario,
                funcionarios.classespecializacao,
                funcionarios.classperiodo,
                funcionarios.classcategoria,
                funcionarios.classobservacoes,
            ),
        )

    return {"status": "sucesso", "mensagem": "Funcionário cadastrado com sucesso!"}


@app.get("/funcionarios")
def listar_funcionarios(request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute("SELECT id, nomecompleto, categoria FROM funcionarios ORDER BY categoria, nomecompleto")
        rows = cur.fetchall()
    return {"funcionarios": [list(row) for row in rows]}


@app.get("/funcionarios/{nome}")
def buscar_funcionario(nome: str, request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute("SELECT * FROM funcionarios WHERE nomecompleto = %s", (nome,))
        resultado = cur.fetchone()

    if resultado:
        return {"funcionario": row_to_list(resultado)}
    return {"mensagem": "Funcionário não encontrado"}


@app.put("/funcionarios/{nome}")
def atualizar_funcionario(nome: str, funcionario: Funcionario, request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
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
            ),
        )
        atualizado = cur.rowcount

    if atualizado:
        return {"status": "sucesso", "mensagem": "Funcionário atualizado!"}
    return {"mensagem": "Funcionário não encontrado"}


@app.delete("/funcionarios/{nome}")
def deletar_funcionario(nome: str, request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute("DELETE FROM funcionarios WHERE nomecompleto = %s", (nome,))
        removido = cur.rowcount

    if removido:
        return {"mensagem": "Funcionário excluído com sucesso!"}
    return {"mensagem": "Funcionário não encontrado"}


@app.post("/erros")
def registrar_erro(erro: Erro, request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute(
            """
            INSERT INTO erros(nomefuncionario, periodo, descricao, gravidade, categoria, ts)
            VALUES(%s, %s, %s, %s, %s, %s)
            """,
            (
                erro.nomefuncionario,
                erro.periodo,
                erro.descricao,
                erro.gravidade,
                erro.categoria,
                int(time.time()),
            ),
        )

    return {"status": "sucesso", "mensagem": "Erro registrado com sucesso!"}


@app.get("/erros")
def listar_todos_erros(request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute(
            """
            SELECT e.id, e.nomefuncionario, e.periodo, e.descricao, e.gravidade, e.categoria, e.ts,
                   f.categoria AS cat_func
            FROM erros e
            LEFT JOIN funcionarios f ON f.nomecompleto = e.nomefuncionario
            ORDER BY e.ts DESC
            """
        )
        rows = cur.fetchall()

    return {
        "erros": [
            {
                "id": row[0],
                "nomefuncionario": row[1],
                "periodo": row[2],
                "descricao": row[3],
                "gravidade": row[4],
                "categoria": row[5],
                "ts": row[6],
                "cat_func": row[7],
            }
            for row in rows
        ]
    }


@app.get("/erros/{nome}")
def listar_erros_funcionario(nome: str, request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute(
            """
            SELECT id, periodo, descricao, gravidade, categoria, ts
            FROM erros
            WHERE nomefuncionario = %s
            ORDER BY ts DESC
            """,
            (nome,),
        )
        rows = cur.fetchall()

    return {
        "erros": [
            {
                "id": row[0],
                "periodo": row[1],
                "descricao": row[2],
                "gravidade": row[3],
                "categoria": row[4],
                "ts": row[5],
            }
            for row in rows
        ]
    }


@app.delete("/erros/{erro_id}")
def deletar_erro(erro_id: int, request: Request):
    if not exige_autenticacao(request):
        return erro_json("Não autorizado.", 401)

    with db_cursor() as cur:
        cur.execute("DELETE FROM erros WHERE id = %s", (erro_id,))
        removido = cur.rowcount

    if removido:
        return {"status": "sucesso", "mensagem": "Erro deletado!"}
    return {"mensagem": "Erro não encontrado"}


@app.get("/admins")
def listar_admins(request: Request):
    if not exige_role(request, ["superadmin", "admin_full"]):
        return erro_json("Não autorizado.", 403)

    with db_cursor() as cur:
        cur.execute("SELECT usuario, nome, role FROM login ORDER BY role, usuario")
        rows = cur.fetchall()

    return {"admins": [{"usuario": row[0], "nome": row[1], "role": row[2]} for row in rows]}


@app.post("/admins")
def criar_admin(dados: CriarAdmin, request: Request):
    info = exige_role(request, ["superadmin", "admin_full"])
    if not info:
        return erro_json("Não autorizado.", 403)

    role_novo = "admin_full" if dados.pode_criar_admins else "admin"
    if role_novo == "admin_full" and info["role"] != "superadmin":
        return erro_json("Apenas o superadmin pode criar admins com essa permissão.", 403)

    with db_cursor() as cur:
        cur.execute("SELECT usuario FROM login WHERE usuario = %s", (dados.usuario,))
        if cur.fetchone():
            return erro_json("Usuário já existe.", 400)

        cur.execute(
            "INSERT INTO login(usuario, nome, senha, role) VALUES(%s, %s, %s, %s)",
            (dados.usuario, dados.usuario, gerar_hash(dados.senha), role_novo),
        )

    return {"status": "sucesso", "mensagem": f"Admin '{dados.usuario}' criado com role '{role_novo}'."}


@app.delete("/admins/{usuario}")
def deletar_admin(usuario: str, request: Request):
    if not exige_role(request, ["superadmin"]):
        return erro_json("Apenas o superadmin pode remover admins.", 403)

    with db_cursor() as cur:
        cur.execute("SELECT role FROM login WHERE usuario = %s", (usuario,))
        alvo = cur.fetchone()
        if not alvo:
            return erro_json("Usuário não encontrado.", 404)
        if alvo[0] == "superadmin":
            return erro_json("O superadmin não pode ser removido.", 400)

        cur.execute("DELETE FROM login WHERE usuario = %s", (usuario,))

    return {"status": "sucesso", "mensagem": f"Admin '{usuario}' removido."}


@app.post("/setup")
def criar_superadmin(login: Login):
    with db_cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM login")
        total = cur.fetchone()[0]
        if total > 0:
            return erro_json("Setup já foi realizado. Rota desativada.", 403)

        cur.execute(
            "INSERT INTO login(usuario, nome, senha, role) VALUES(%s, %s, %s, %s)",
            (login.usuario, login.usuario, gerar_hash(login.senha), "superadmin"),
        )

    return {"status": "sucesso", "mensagem": f"Superadmin '{login.usuario}' criado com sucesso!"}
