const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || '';
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const jsonDbPath = path.join(dataDir, 'db.json');

const users = [
  { name: 'Lucas.Martins', pass: process.env.MASTER_PASSWORD || 'Master@2026!', role: 'Master', teams: ['Master'] },
  { name: 'Herique.Velloso', pass: process.env.MASTER_PASSWORD || 'Master@2026!', role: 'Master', teams: ['Master'] },
  { name: 'Guilherme.Caetano', pass: process.env.MASTER_PASSWORD || 'Master@2026!', role: 'Master', teams: ['Master'] },
  { name: 'Ana.Aguiar', pass: process.env.MASTER_PASSWORD || 'Master@2026!', role: 'Master', teams: ['Master'] },
  { name: 'Wganer.Moreira', pass: process.env.MULTI_PASSWORD || 'Multi@2026#', role: 'Multiskill', teams: ['Multiskill'] },
  { name: 'Camilly.Vitoria', pass: process.env.MULTI_PASSWORD || 'Multi@2026#', role: 'Multiskill', teams: ['Multiskill'] },
  { name: 'Mathues-Mouta', pass: process.env.MULTI_PASSWORD || 'Multi@2026#', role: 'Multiskill', teams: ['Multiskill'] },
  { name: 'Lughi.Piccoli', pass: process.env.MULTI_PASSWORD || 'Multi@2026#', role: 'Multiskill', teams: ['Multiskill'] },
  { name: 'Mathues.Almeida', pass: process.env.GESTAO_PASSWORD || 'Gestao.operacional2026', role: 'Gestao', teams: ['Master', 'Multiskill'], compareAll: true },
  { name: 'Evelyn Araujo', pass: process.env.GESTAO_PASSWORD || 'Gestao.operacional2026', role: 'Gestao', teams: ['Gestao'] }
];

const collaborators = [
  { name: 'CAIO HENRIQUE LOPES', team: 'Master' },
  { name: 'ANA CLARA DEMETRIO', team: 'Master' },
  { name: 'BRUNO ROBERTO', team: 'Master' },
  { name: 'CAUE VIEIRA BARBOSA DA SILVA', team: 'Master' },
  { name: 'DANIELLY DOS SANTOS', team: 'Master' },
  { name: 'MATHEUS RODRIGUES', team: 'Master' },
  { name: 'CICERO MAIA', team: 'Master' },
  { name: 'FELIPE ALVES DE OLIVEIRA', team: 'Master' },
  { name: 'MICHELE DE OLIVEIRA', team: 'Master' },
  { name: 'GABRIEL ROCHA', team: 'Master' },
  { name: 'GUSTAVO SANTANA', team: 'Master' },
  { name: 'PEDRO HENRIQUE PUKOSKI', team: 'Master' },
  { name: 'ROSELI NUNES DE SOUZA', team: 'Master' },
  { name: 'JULIA VIEIRA SILVA', team: 'Master' },
  { name: 'GIOVANNA INACIO DA SILVA', team: 'Master' },
  { name: 'LEONARDO MARATO KALAYSHI', team: 'Master' },
  { name: 'GIULIA LUZ PEREIRA', team: 'Master' },
  { name: 'LIVIA COSTA', team: 'Master' },
  { name: 'GUSTAVO XAVIER', team: 'Master' },
  { name: 'LUCCA SHUMAHER FERREIRA', team: 'Master' },
  { name: 'IONARA LARISSA SILVA PAZ', team: 'Master' },
  { name: 'LUIZA CIKEMI SUGAWARA', team: 'Master' },
  { name: 'ISADORA CRISTINA', team: 'Master' },
  { name: 'MARCELA VAMPRE', team: 'Master' },
  { name: 'LAYSSA PASSARELLI ALVES', team: 'Master' },
  { name: 'MATHEUS MARTINS DE OLIVEIRA', team: 'Master' },
  { name: 'LUIZ GUSTAVO SOUZA DE OLIVEIRA', team: 'Master' },
  { name: 'RAYANE JULIA CAMILO', team: 'Master' },
  { name: 'MARCOS VINICIUS DE SOUZA', team: 'Master' },
  { name: 'RUAN ARANTES', team: 'Master' },
  { name: 'PEDRO HENRIQUE', team: 'Master' },
  { name: 'GABRIEL RODRIGUES BOAVENTURA', team: 'Master' },
  { name: 'RIQUELME CRISTIANO ROCHA', team: 'Master' },
  { name: 'Wganer.Moreira', team: 'Multiskill' },
  { name: 'Camilly.Vitoria', team: 'Multiskill' },
  { name: 'Mathues-Mouta', team: 'Multiskill' },
  { name: 'Lughi.Piccoli', team: 'Multiskill' }
];

const errorTypes = ['Processo', 'Prazo', 'Comunicacao', 'Qualidade', 'Sistema', 'Retrabalho'];
const sessions = new Map();
let pool = null;

function seededErrors() {
  const today = new Date();
  const addDays = (days) => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };
  return [
    ['CAIO HENRIQUE LOPES', 'Processo', -13, 'Medio', 'Etapa pulada no fluxo'],
    ['ANA CLARA DEMETRIO', 'Comunicacao', -9, 'Baixo', 'Informacao incompleta'],
    ['BRUNO ROBERTO', 'Qualidade', -10, 'Alto', 'Correcao posterior necessaria'],
    ['CAUE VIEIRA BARBOSA DA SILVA', 'Qualidade', -3, 'Medio', 'Validacao parcial'],
    ['DANIELLY DOS SANTOS', 'Sistema', -15, 'Baixo', 'Falha de registro'],
    ['MATHEUS RODRIGUES', 'Prazo', -8, 'Medio', 'Tratativa fora do prazo'],
    ['CICERO MAIA', 'Prazo', -2, 'Baixo', 'Pequeno atraso'],
    ['Wganer.Moreira', 'Retrabalho', -14, 'Medio', 'Reabertura'],
    ['Wganer.Moreira', 'Retrabalho', -6, 'Baixo', 'Ajuste apos revisao'],
    ['Camilly.Vitoria', 'Comunicacao', -12, 'Baixo', 'Dados incompletos'],
    ['Mathues-Mouta', 'Processo', -4, 'Alto', 'Divergencia no procedimento'],
    ['Mathues-Mouta', 'Qualidade', -1, 'Medio', 'Conferencia incompleta'],
    ['Lughi.Piccoli', 'Sistema', -16, 'Baixo', 'Registro duplicado']
  ].map(([person, type, days, impact, note]) => ({
    id: crypto.randomUUID(),
    person,
    team: collaborators.find((item) => item.name === person).team,
    type,
    impact,
    note,
    date: addDays(days)
  }));
}

async function initDb() {
  if (DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    });
    await pool.query(`
      create table if not exists errors (
        id text primary key,
        person text not null,
        team text not null,
        type text not null,
        impact text not null,
        note text default '',
        date date not null,
        created_at timestamptz default now()
      )
    `);
    const count = await pool.query('select count(*)::int as count from errors');
    if (count.rows[0].count === 0) {
      for (const item of seededErrors()) await insertError(item);
    }
    return;
  }

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(jsonDbPath)) {
    fs.writeFileSync(jsonDbPath, JSON.stringify({ errors: seededErrors() }, null, 2));
    return;
  }
  const db = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
  if (!Array.isArray(db.errors) || db.errors.length === 0) {
    fs.writeFileSync(jsonDbPath, JSON.stringify({ errors: seededErrors() }, null, 2));
  }
}

async function listErrors() {
  if (pool) {
    const result = await pool.query('select id, person, team, type, impact, note, to_char(date, $1) as date from errors order by date desc, created_at desc', ['YYYY-MM-DD']);
    return result.rows;
  }
  const db = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
  return db.errors;
}

async function insertError(item) {
  if (pool) {
    await pool.query(
      'insert into errors (id, person, team, type, impact, note, date) values ($1, $2, $3, $4, $5, $6, $7)',
      [item.id, item.person, item.team, item.type, item.impact, item.note, item.date]
    );
    return item;
  }
  const db = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
  db.errors.push(item);
  fs.writeFileSync(jsonDbPath, JSON.stringify(db, null, 2));
  return item;
}

async function deleteError(id) {
  if (pool) {
    const current = await pool.query('select * from errors where id = $1', [id]);
    if (!current.rows.length) return null;
    await pool.query('delete from errors where id = $1', [id]);
    return current.rows[0];
  }
  const db = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
  const target = db.errors.find((item) => item.id === id);
  if (!target) return null;
  db.errors = db.errors.filter((item) => item.id !== id);
  fs.writeFileSync(jsonDbPath, JSON.stringify(db, null, 2));
  return target;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Corpo da requisicao muito grande'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('JSON invalido'));
      }
    });
  });
}

function getToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function getSession(req) {
  return sessions.get(getToken(req));
}

function publicUser(user) {
  return {
    name: user.name,
    role: user.role,
    teams: user.teams,
    compareAll: Boolean(user.compareAll)
  };
}

function allowedCollaborators(session) {
  return collaborators.filter((item) => session.teams.includes(item.team));
}

function allowedErrors(session, errors) {
  const names = new Set(allowedCollaborators(session).map((item) => item.name));
  return errors.filter((item) => names.has(item.person));
}

function serveStatic(req, res) {
  const cleanPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = cleanPath === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, cleanPath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(publicDir))) {
    res.writeHead(403);
    res.end('Acesso negado');
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Arquivo nao encontrado');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleApi(req, res) {
  if (req.method === 'GET' && req.url === '/api/health') {
    return sendJson(res, 200, { ok: true, database: pool ? 'postgres' : 'json' });
  }

  if (req.method === 'POST' && req.url === '/api/login') {
    const body = await readBody(req);
    const user = users.find((item) => item.name.toLowerCase() === String(body.username || '').trim().toLowerCase() && item.pass === body.password);
    if (!user) return sendJson(res, 401, { error: 'Usuario ou senha invalidos' });
    const token = crypto.randomUUID();
    sessions.set(token, publicUser(user));
    return sendJson(res, 200, { token, user: publicUser(user) });
  }

  const session = getSession(req);
  if (!session) return sendJson(res, 401, { error: 'Sessao invalida' });

  if (req.method === 'GET' && req.url === '/api/bootstrap') {
    const errors = await listErrors();
    return sendJson(res, 200, {
      user: session,
      collaborators: allowedCollaborators(session),
      errors: allowedErrors(session, errors),
      errorTypes,
      users: users.map(publicUser)
    });
  }

  if (req.method === 'GET' && req.url === '/api/errors') {
    const errors = await listErrors();
    return sendJson(res, 200, { errors: allowedErrors(session, errors) });
  }

  if (req.method === 'POST' && req.url === '/api/errors') {
    const body = await readBody(req);
    const collaborator = allowedCollaborators(session).find((item) => item.name === body.person);
    if (!collaborator) return sendJson(res, 403, { error: 'Colaborador fora da sua visao' });
    if (!errorTypes.includes(body.type)) return sendJson(res, 400, { error: 'Tipo de erro invalido' });
    const item = {
      id: crypto.randomUUID(),
      date: String(body.date || '').slice(0, 10),
      person: collaborator.name,
      team: collaborator.team,
      type: body.type,
      impact: String(body.impact || 'Baixo'),
      note: String(body.note || '').trim()
    };
    await insertError(item);
    return sendJson(res, 201, { error: item });
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/errors/')) {
    const id = decodeURIComponent(req.url.split('/').pop());
    const allErrors = await listErrors();
    const target = allErrors.find((item) => item.id === id);
    if (!target) return sendJson(res, 404, { error: 'Registro nao encontrado' });
    if (!allowedCollaborators(session).some((item) => item.name === target.person)) {
      return sendJson(res, 403, { error: 'Registro fora da sua visao' });
    }
    await deleteError(id);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Rota nao encontrada' });
}

async function main() {
  await initDb();
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      handleApi(req, res).catch((error) => sendJson(res, 500, { error: error.message }));
      return;
    }
    serveStatic(req, res);
  });
  server.listen(PORT, () => {
    console.log(`ErrTrack rodando em http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
