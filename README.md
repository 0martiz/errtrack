# ErrTrack

Painel de erros e melhoria por colaborador, com frontend, backend e banco de dados.

## O que vem pronto

- Login por perfil: Master, Multiskill e Gestao.
- Mathues.Almeida com visao de Master e Multiskill para comparacao.
- Cadastro e exclusao de erros.
- Painel semanal por colaborador e por tipo de erro.
- Backend em Node.js.
- Frontend em HTML, CSS e JavaScript.
- PostgreSQL para hospedagem online.
- Modo local com `data/db.json` para teste no computador.

## Rodar localmente

Instale Node.js 18 ou superior.

Na pasta do projeto:

```bash
npm install
npm start
```

Abra:

```text
http://localhost:3000
```

Sem `DATABASE_URL`, o sistema salva os registros em:

```text
data/db.json
```

## Subir online no Render

1. Crie uma conta em `render.com`.
2. Crie um repositorio no GitHub e envie esta pasta do projeto para ele.
3. No Render, clique em `New +`.
4. Escolha `Blueprint`.
5. Conecte o repositorio do GitHub.
6. O Render vai ler o arquivo `render.yaml` e criar:
   - o site Node.js
   - o banco PostgreSQL
7. Configure estas variaveis quando o Render pedir:
   - `MASTER_PASSWORD`
   - `MULTI_PASSWORD`
   - `GESTAO_PASSWORD`
8. Clique para publicar.

Depois do deploy, o Render vai gerar um link parecido com:

```text
https://errtrack-site.onrender.com
```

Esse link pode ser enviado para varias pessoas.

## Subir online no Railway

1. Crie uma conta em `railway.app`.
2. Crie um novo projeto a partir do GitHub.
3. Adicione um banco PostgreSQL.
4. Configure a variavel `DATABASE_URL` com o link do PostgreSQL.
5. Configure:
   - `MASTER_PASSWORD`
   - `MULTI_PASSWORD`
   - `GESTAO_PASSWORD`
6. O comando de start e:

```bash
npm start
```

## Logins padrao

Master:

- Lucas.Martins
- Herique.Velloso
- Guilherme.Caetano
- Ana.Aguiar
- Senha padrao: Master@2026!

Multiskill:

- Wganer.Moreira
- Camilly.Vitoria
- Mathues-Mouta
- Lughi.Piccoli
- Senha padrao: Multi@2026#

Gestao:

- Mathues.Almeida
- Evelyn Araujo
- Senha padrao: Gestao.operacional2026

Em producao, use as variaveis de ambiente para trocar essas senhas.

## Observacao importante

Esta versao ja funciona online para muitas pessoas, mas ainda usa login simples por senha de perfil. Para uso mais formal, o proximo passo ideal e criar usuarios individuais com senha criptografada e recuperacao de acesso.

