let token = '';
let sessionUser = null;
let collaborators = [];
let errors = [];
let errorTypes = [];
let accessUsers = [];

const $ = (id) => document.getElementById(id);
const today = new Date();
const isoDate = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha na requisicao');
  return data;
}

function weekStart(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

function weekValue(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function weekRangeFromInput(value) {
  const [year, week] = value.split('-W').map(Number);
  const jan4 = new Date(year, 0, 4);
  const start = weekStart(jan4);
  start.setDate(start.getDate() + (week - 1) * 7);
  return { start, end: addDays(start, 7), previousStart: addDays(start, -7), previousEnd: start };
}

function statusFor(current, previous, daysClear) {
  if (current === 0 && (previous > 0 || daysClear >= 7)) return { text: 'Melhorando', cls: 'good' };
  if (current < previous) return { text: 'Melhorando', cls: 'good' };
  if (current > previous) return { text: 'Piorando', cls: 'bad' };
  if (current === 0 && previous === 0) return { text: 'Sem erros', cls: 'good' };
  return { text: 'Estavel', cls: 'warn' };
}

function countInRange(items, start, end) {
  return items.filter((item) => {
    const d = new Date(`${item.date}T00:00:00`);
    return d >= start && d < end;
  }).length;
}

function daysSinceLast(person, items) {
  const dates = items
    .filter((item) => item.person === person)
    .map((item) => new Date(`${item.date}T00:00:00`))
    .sort((a, b) => b - a);
  if (!dates.length) return 999;
  return Math.max(0, Math.floor((weekStart(today) - dates[0]) / 86400000));
}

function filteredErrors() {
  const team = $('teamFilter').value;
  const type = $('typeFilter').value;
  return errors.filter((item) => (!team || item.team === team) && (!type || item.type === type));
}

function metricCard(title, value, detail, cls = '') {
  return `<div class="card"><div class="muted tiny">${title}</div><div class="metric">${value}</div><span class="badge ${cls}">${detail}</span></div>`;
}

function teamClass(team) {
  if (team === 'Master') return 'master';
  if (team === 'Multiskill') return 'multi';
  return 'gestao';
}

function renderDashboard() {
  const week = weekRangeFromInput($('weekFilter').value);
  const data = filteredErrors();
  const current = countInRange(data, week.start, week.end);
  const previous = countInRange(data, week.previousStart, week.previousEnd);
  const people = collaborators.filter((item) => !$('teamFilter').value || item.team === $('teamFilter').value);
  const zeroPeople = people.filter((item) => countInRange(data.filter((error) => error.person === item.name), week.start, week.end) === 0).length;
  const trend = statusFor(current, previous, zeroPeople ? 7 : 0);
  const delta = current - previous;

  $('metrics').innerHTML = [
    metricCard('Erros na semana', current, `${previous} na semana anterior`),
    metricCard('Variacao', delta > 0 ? `+${delta}` : String(delta), trend.text, trend.cls),
    metricCard('Sem erro na semana', zeroPeople, `${people.length} colaboradores visiveis`, 'good'),
    metricCard('Equipe visivel', $('teamFilter').value || 'Todas', `${people.length} colaboradores`)
  ].join('');

  renderPeopleTable(data, week, people);
  renderTypeTable(data, week);
}

function renderPeopleTable(data, week, people) {
  if (!people.length) {
    $('peopleTable').innerHTML = '<div class="empty">Nenhum colaborador disponivel para este perfil.</div>';
    return;
  }
  const rows = people.map((person) => {
    const own = data.filter((item) => item.person === person.name);
    const current = countInRange(own, week.start, week.end);
    const previous = countInRange(own, week.previousStart, week.previousEnd);
    const daysClear = daysSinceLast(person.name, data);
    const status = statusFor(current, previous, daysClear);
    const max = Math.max(current, previous, 1);
    const width = Math.round((current / max) * 100);
    return `<tr>
      <td><strong>${person.name}</strong><br><span class="badge ${teamClass(person.team)}">${person.team}</span></td>
      <td>${current}</td>
      <td>${previous}</td>
      <td>${daysClear === 999 ? 'Sem historico' : `${daysClear} dia(s)`}</td>
      <td><span class="badge ${status.cls}">${status.text}</span></td>
      <td><div class="bar"><span style="--w:${width}%;--c:${status.cls === 'bad' ? 'var(--bad)' : status.cls === 'good' ? 'var(--good)' : 'var(--warn)'}"></span></div></td>
    </tr>`;
  }).join('');
  $('peopleTable').innerHTML = `<table><thead><tr><th>Colaborador</th><th>Semana</th><th>Anterior</th><th>Sem erro</th><th>Status</th><th>Volume</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderTypeTable(data, week) {
  const rows = errorTypes.map((type) => {
    const own = data.filter((item) => item.type === type);
    const current = countInRange(own, week.start, week.end);
    const previous = countInRange(own, week.previousStart, week.previousEnd);
    const status = statusFor(current, previous, current === 0 ? 7 : 0);
    return `<tr><td><strong>${type}</strong></td><td>${current}</td><td>${previous}</td><td><span class="badge ${status.cls}">${status.text}</span></td></tr>`;
  }).join('');
  $('typeTable').innerHTML = `<table><thead><tr><th>Erro</th><th>Semana</th><th>Anterior</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPeopleCards() {
  const week = weekRangeFromInput($('weekFilter').value);
  const data = filteredErrors();
  const people = collaborators.filter((item) => !$('teamFilter').value || item.team === $('teamFilter').value);
  $('peopleCards').innerHTML = `<table><thead><tr><th>Nome</th><th>Equipe</th><th>Semana atual</th><th>Semana anterior</th><th>Leitura</th></tr></thead><tbody>${
    people.map((person) => {
      const own = data.filter((item) => item.person === person.name);
      const current = countInRange(own, week.start, week.end);
      const previous = countInRange(own, week.previousStart, week.previousEnd);
      const daysClear = daysSinceLast(person.name, data);
      const status = statusFor(current, previous, daysClear);
      return `<tr><td><strong>${person.name}</strong></td><td><span class="badge ${teamClass(person.team)}">${person.team}</span></td><td>${current}</td><td>${previous}</td><td><span class="badge ${status.cls}">${status.text}</span> <span class="muted tiny">${daysClear === 999 ? 'sem erro registrado' : `${daysClear} dia(s) sem erro`}</span></td></tr>`;
    }).join('')
  }</tbody></table>`;
}

function renderErrors() {
  $('errorPerson').innerHTML = collaborators.map((item) => `<option value="${item.name}">${item.name} - ${item.team}</option>`).join('');
  $('errorType').innerHTML = errorTypes.map((type) => `<option value="${type}">${type}</option>`).join('');
  const list = [...errors].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  $('errorList').innerHTML = list.length ? `<table><thead><tr><th>Data</th><th>Colaborador</th><th>Erro</th><th></th></tr></thead><tbody>${
    list.map((item) => `<tr><td>${formatDate(item.date)}</td><td><strong>${item.person}</strong><br><span class="badge ${teamClass(item.team)}">${item.team}</span></td><td>${item.type}<br><span class="muted tiny">${item.impact}${item.note ? ' - ' + item.note : ''}</span></td><td><button class="btn danger" data-delete="${item.id}">Excluir</button></td></tr>`).join('')
  }</tbody></table>` : '<div class="empty">Nenhum erro registrado nesta visao.</div>';

  document.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      await api(`/api/errors/${encodeURIComponent(button.dataset.delete)}`, { method: 'DELETE' });
      await refreshErrors();
      renderAll();
    });
  });
}

function renderAccess() {
  const rows = accessUsers.map((user) => `<tr>
    <td><strong>${user.name}</strong></td>
    <td><span class="badge ${teamClass(user.role === 'Gestao' ? 'Gestao' : user.role)}">${user.role}</span></td>
    <td>${user.teams.join(', ')}</td>
    <td>${user.compareAll ? 'Compara Master e Multiskill' : 'Restrito ao perfil'}</td>
  </tr>`).join('');
  $('accessTable').innerHTML = `<table><thead><tr><th>Usuario</th><th>Perfil</th><th>Visao</th><th>Regra</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function formatDate(date) {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function fillFilters() {
  const teams = [...new Set(collaborators.map((item) => item.team))];
  $('teamFilter').innerHTML = `<option value="">Todas</option>${teams.map((team) => `<option value="${team}">${team}</option>`).join('')}`;
  $('typeFilter').innerHTML = `<option value="">Todos</option>${errorTypes.map((type) => `<option value="${type}">${type}</option>`).join('')}`;
  $('weekFilter').value = weekValue(today);
  $('errorDate').value = isoDate(today);
}

function renderAll() {
  renderDashboard();
  renderPeopleCards();
  renderErrors();
  renderAccess();
}

function setView(view) {
  const titles = {
    dashboard: ['Painel geral', 'Comparacao semanal dos erros e da melhoria dos colaboradores.'],
    people: ['Colaboradores', 'Evolucao individual com leitura de melhora ou piora.'],
    errors: ['Registro de erros', 'Cadastre novos erros para alimentar a comparacao semanal.'],
    settings: ['Acessos', 'Perfis separados por Master, Multiskill e Gestao.']
  };
  ['dashboard', 'people', 'errors', 'settings'].forEach((name) => {
    $(`${name}View`).classList.toggle('hidden', name !== view);
  });
  document.querySelectorAll('nav button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('pageTitle').textContent = titles[view][0];
  $('pageSubtitle').textContent = titles[view][1];
  renderAll();
}

async function refreshErrors() {
  const data = await api('/api/errors');
  errors = data.errors;
}

async function login() {
  $('loginError').textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('loginUser').value, password: $('loginPass').value })
    });
    token = data.token;
    sessionUser = data.user;
    const bootstrap = await api('/api/bootstrap');
    collaborators = bootstrap.collaborators;
    errors = bootstrap.errors;
    errorTypes = bootstrap.errorTypes;
    accessUsers = bootstrap.users;
    $('currentUser').textContent = sessionUser.name;
    $('currentRole').textContent = `${sessionUser.role} - visao: ${sessionUser.teams.join(', ')}`;
    $('login').classList.add('hidden');
    $('app').classList.remove('hidden');
    fillFilters();
    renderAll();
  } catch (error) {
    $('loginError').textContent = error.message;
  }
}

$('loginBtn').addEventListener('click', login);
$('logoutBtn').addEventListener('click', () => {
  token = '';
  sessionUser = null;
  $('app').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('loginPass').value = '';
});

$('clearFilters').addEventListener('click', () => {
  $('teamFilter').value = '';
  $('typeFilter').value = '';
  $('weekFilter').value = weekValue(today);
  renderAll();
});

['teamFilter', 'typeFilter', 'weekFilter'].forEach((id) => $(id).addEventListener('change', renderAll));
document.querySelectorAll('nav button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

$('errorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await api('/api/errors', {
    method: 'POST',
    body: JSON.stringify({
      date: $('errorDate').value,
      person: $('errorPerson').value,
      type: $('errorType').value,
      impact: $('errorImpact').value,
      note: $('errorNote').value
    })
  });
  $('errorNote').value = '';
  await refreshErrors();
  setView('dashboard');
});

$('loginUser').addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
$('loginPass').addEventListener('keydown', (event) => { if (event.key === 'Enter') login(); });
