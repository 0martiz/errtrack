(function () {
  'use strict';

  const API = window.location.origin;
  var selSev  = '';
  var myChart = null;
  var SEV_W   = { baixa: 1, media: 2, alta: 3, critica: 4 };
  var SEV_CLS = { baixa: 's-bx', media: 's-md', alta: 's-al', critica: 's-cr' };

  // ── API helper ─────────────────────────────────────────────────────────────
  async function apiFetch(path, options = {}) {
    const res = await fetch(API + path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (res.status === 401) { window.location.href = '/'; return null; }
    if (res.status === 403) { showToast('Sem permissão para esta ação.', 'er'); return null; }
    return res.json();
  }

  // ── navegação ──────────────────────────────────────────────────────────────
  function goTo(page) {
    document.querySelectorAll('.pg').forEach(p => p.classList.remove('on'));
    const pg = document.getElementById('pg-' + page);
    if (pg) pg.classList.add('on');
    document.querySelectorAll('.ni[data-page]').forEach(b => {
      b.classList.toggle('on', b.dataset.page === page);
    });
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.style.display = 'none';
    if (page === 'painel') showList();
  }

  window.goTo = goTo;

  function initNavigation() {
    document.querySelectorAll('.ni[data-page]').forEach(btn => {
      btn.addEventListener('click', function () { goTo(this.dataset.page); });
    });
    const mBtn    = document.getElementById('mobile-menu');
    const overlay = document.getElementById('sidebar-overlay');
    const sidebar = document.getElementById('sidebar');
    if (mBtn) mBtn.addEventListener('click', () => {
      if (sidebar) sidebar.classList.toggle('open');
      if (overlay) overlay.style.display = sidebar.classList.contains('open') ? 'block' : 'none';
    });
    if (overlay) overlay.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('open');
      overlay.style.display = 'none';
    });
  }

  // ── dashboard ──────────────────────────────────────────────────────────────
  async function renderDashboard() {
    const dados = await apiFetch('/erros');
    if (!dados) return;
    const erros = dados.erros || [];
    const DB = {};
    erros.forEach(e => {
      if (!DB[e.nomefuncionario]) DB[e.nomefuncionario] = { categoria: e.cat_func || e.categoria || '', errors: [] };
      DB[e.nomefuncionario].errors.push(e);
    });

    // Atualiza grids via renderDashCards do HTML inline
    if (typeof renderDashCards === 'function') renderDashCards();
  }

  window.renderDashboard = renderDashboard;

  // ── detalhe do funcionário ─────────────────────────────────────────────────
  async function openDetail(nome) {
    const dados = await apiFetch('/erros/' + encodeURIComponent(nome));
    if (!dados) return;
    const erros = dados.erros || [];

    // Esconde lista, mostra detalhe
    const pnList   = document.getElementById('pn-list');
    const pnDetail = document.getElementById('pn-detail');
    if (pnList)   pnList.style.display   = 'none';
    if (pnDetail) pnDetail.style.display = 'block';

    setText('d-name',    nome);
    setText('dm-total',  erros.length);
    setText('dm-avg',    getAvg(erros));
    setText('dm-critica',erros.filter(e => e.gravidade === 'critica').length);

    const periods = [...new Set(erros.map(e => e.periodo).filter(Boolean))];
    setText('dm-period', periods[periods.length - 1] || '—');

    const tr = getTrend(erros);
    const ti = tInfo(tr);
    const trendEl = document.getElementById('d-trend');
    if (trendEl) {
      trendEl.className = 'tb ' + (tr === 'up' ? 't-up' : tr === 'down' ? 't-dn' : 't-fl');
      trendEl.textContent = ti.icon + ' ' + ti.label;
    }

    renderDetailChart(erros);
    renderErrList(nome, erros);
  }

  window.openDetail = openDetail;

  function renderDetailChart(erros) {
    const sorted = erros.slice().sort((a, b) => a.ts - b.ts);
    const byDate = {};
    sorted.forEach(e => {
      const d = new Date(e.ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (!byDate[d]) byDate[d] = { sum: 0, cnt: 0, criticos: 0 };
      byDate[d].sum += (SEV_W[e.gravidade] || 1);
      byDate[d].cnt++;
      if (e.gravidade === 'critica') byDate[d].criticos++;
    });

    const labs  = Object.keys(byDate);
    const avgs  = labs.map(l => +(byDate[l].sum / byDate[l].cnt).toFixed(2));
    const crits = labs.map(l => byDate[l].criticos);

    if (myChart) { myChart.destroy(); myChart = null; }
    const canvas = document.getElementById('chart-canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    const gradP = ctx.createLinearGradient(0, 0, 0, 180);
    gradP.addColorStop(0, 'rgba(139,92,246,.25)');
    gradP.addColorStop(1, 'rgba(139,92,246,0)');

    myChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labs,
        datasets: [
          {
            label: 'Gravidade Média',
            data: avgs,
            borderColor: '#8b5cf6',
            backgroundColor: gradP,
            tension: 0.4, fill: true,
            pointRadius: 4, pointBackgroundColor: '#8b5cf6',
            pointBorderColor: '#111827', pointBorderWidth: 2, pointHoverRadius: 6
          },
          {
            label: 'Críticos',
            data: crits,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            tension: 0.4, fill: true,
            pointRadius: 4, pointBackgroundColor: '#ef4444',
            pointBorderColor: '#111827', pointBorderWidth: 2, pointHoverRadius: 6
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 8 } },
          tooltip: { backgroundColor: '#111827', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, padding: 10 }
        },
        scales: {
          y: {
            min: 0, max: 4,
            ticks: {
              color: '#64748b', font: { size: 10 },
              callback: v => ['', 'Baixa', 'Média', 'Alta', 'Crítica'][Math.round(v)] || ''
            },
            grid: { color: 'rgba(255,255,255,.04)' }
          },
          x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.04)' } }
        }
      }
    });
  }

  function renderErrList(nome, erros) {
    const wrap = document.getElementById('err-list');
    if (!wrap) return;
    const sorted = erros.slice().sort((a, b) => b.ts - a.ts);
    if (!sorted.length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--mt);padding:12px 0;">Nenhum erro registrado ainda.</div>';
      return;
    }
    wrap.innerHTML = sorted.map(e => {
      const cls  = SEV_CLS[e.gravidade] || 's-md';
      const data = new Date(e.ts * 1000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const hora = new Date(e.ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const meta = data + ' ' + hora + (e.periodo ? ' · ' + htmlEsc(e.periodo) : '') + (e.categoria ? ' · ' + htmlEsc(e.categoria) : '');
      return '<div class="er">'
        + '<span class="sp ' + cls + '">' + (e.gravidade || '?').toUpperCase() + '</span>'
        + '<div style="flex:1"><div class="ed">' + htmlEsc(e.descricao) + '</div><div class="em">' + meta + '</div></div>'
        + '<button class="db" data-erro-id="' + e.id + '" data-emp-nome="' + encodeURIComponent(nome) + '" title="Remover">×</button>'
        + '</div>';
    }).join('');

    wrap.querySelectorAll('[data-erro-id]').forEach(btn => {
      btn.addEventListener('click', async function () {
        if (!confirm('Deseja remover este erro?')) return;
        const id   = this.dataset.erroId;
        const nome = decodeURIComponent(this.dataset.empNome);
        await apiFetch('/erros/' + id, { method: 'DELETE' });
        openDetail(nome);
      });
    });
  }

  function showList() {
    const pnList   = document.getElementById('pn-list');
    const pnDetail = document.getElementById('pn-detail');
    if (pnList)   pnList.style.display   = 'block';
    if (pnDetail) pnDetail.style.display = 'none';
    if (typeof refreshDashboard === 'function') refreshDashboard();
  }

  window.showList = showList;

  // ── registrar erro ─────────────────────────────────────────────────────────
  function initForms() {
    const SEV_SEL = { baixa: 'a-bx', media: 'a-md', alta: 'a-al', critica: 'a-cr' };
    document.querySelectorAll('.sp-pick .so').forEach(btn => {
      btn.addEventListener('click', function () {
        selSev = this.dataset.sev;
        document.querySelectorAll('.sp-pick .so').forEach(b => b.classList.remove('a-bx', 'a-md', 'a-al', 'a-cr'));
        this.classList.add(SEV_SEL[selSev]);
      });
    });
    const btnSaveError = document.getElementById('btn-save-error');
    if (btnSaveError) btnSaveError.addEventListener('click', saveError);
  }

  async function saveError() {
    const nomeMaster = val('f-master');
    const nomeMulti  = val('f-multiskill');
    const nome       = nomeMaster || nomeMulti;
    const desc       = val('f-desc');
    const msgEl      = document.getElementById('save-msg-error');

    if (!nome || !desc || !selSev) {
      if (msgEl) { msgEl.style.color = 'red'; msgEl.textContent = 'Selecione um operador, descreva o erro e escolha a gravidade.'; }
      return;
    }

    const descSanitizada = desc.replace(/[<>'"]/g, '');
    const categoria = nomeMaster ? 'Master' : 'MultiSkill';

    try {
      const dados = await apiFetch('/erros', {
        method: 'POST',
        body: JSON.stringify({ nomefuncionario: nome, periodo: '', descricao: descSanitizada, gravidade: selSev, categoria })
      });
      if (dados && dados.status === 'sucesso') {
        if (msgEl) { msgEl.style.color = 'green'; msgEl.textContent = '✓ Erro registrado com sucesso!'; }
        document.getElementById('f-master').selectedIndex    = 0;
        document.getElementById('f-multiskill').selectedIndex = 0;
        setVal('f-desc', '');
        selSev = '';
        document.querySelectorAll('.sp-pick .so').forEach(b => b.classList.remove('a-bx', 'a-md', 'a-al', 'a-cr'));
        setTimeout(() => { if (msgEl) msgEl.textContent = ''; }, 3200);
      }
    } catch {
      if (msgEl) { msgEl.style.color = 'red'; msgEl.textContent = 'Erro ao conectar ao servidor.'; }
    }
  }

  // ── exportar ───────────────────────────────────────────────────────────────
  function initSync() {
    const btnExport = document.getElementById('btn-export-top');
    if (btnExport) btnExport.addEventListener('click', () => { window.location.href = '/exportar-excel'; });
  }

  // ── tema ───────────────────────────────────────────────────────────────────
  function initTheme() {
    const btn   = document.getElementById('theme-btn');
    const saved = localStorage.getItem('errtrack_theme') || 'dark';
    if (saved === 'light') { document.body.classList.add('light'); if (btn) btn.textContent = '☀️'; }
    if (btn) btn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light');
      localStorage.setItem('errtrack_theme', isLight ? 'light' : 'dark');
      btn.textContent = isLight ? '☀️' : '🌙';
    });
  }

  // ── funcionários ───────────────────────────────────────────────────────────
  async function carregarFuncionarios() {
    try {
      const dados = await apiFetch('/funcionarios');
      const lista = dados ? (dados.funcionarios || []) : [];
      const selectMaster = document.getElementById('f-master');
      const selectMulti  = document.getElementById('f-multiskill');
      if (selectMaster) {
        selectMaster.innerHTML = '<option value="">— Selecione —</option>';
        lista.filter(f => f.categoria === 'Master').forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.nomecompleto; opt.textContent = f.nomecompleto;
          selectMaster.appendChild(opt);
        });
      }
      if (selectMulti) {
        selectMulti.innerHTML = '<option value="">— Selecione —</option>';
        lista.filter(f => f.categoria === 'MultiSkill').forEach(f => {
          const opt = document.createElement('option');
          opt.value = f.nomecompleto; opt.textContent = f.nomecompleto;
          selectMulti.appendChild(opt);
        });
      }
    } catch { console.error('Erro ao carregar funcionários.'); }
  }

  // ── utilitários ────────────────────────────────────────────────────────────
  function getTrend(e) {
    if (!e || e.length < 2) return 'flat';
    const h  = Math.floor(e.length / 2);
    const a1 = e.slice(0, h).reduce((s, x) => s + (SEV_W[x.gravidade] || 1), 0) / h;
    const a2 = e.slice(h).reduce((s, x) => s + (SEV_W[x.gravidade] || 1), 0) / (e.length - h);
    const diff = a2 - a1;
    if (diff > 0.3)  return 'up';
    if (diff < -0.3) return 'down';
    return 'flat';
  }

  function getAvg(e) {
    if (!e || !e.length) return '0';
    return (e.reduce((s, x) => s + (SEV_W[x.gravidade] || 1), 0) / e.length).toFixed(1);
  }

  function tInfo(t) {
    return { up: { label: 'Piorando', icon: '↑' }, down: { label: 'Melhorando', icon: '↓' }, flat: { label: 'Estável', icon: '→' } }[t] || { label: 'Estável', icon: '→' };
  }

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (type === 'ok' ? 't-ok' : type === 'er' ? 't-er' : 't-wn') + ' on';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('on'), 3600);
  }

  window.showToast = showToast;

  function htmlEsc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  window.htmlEsc = htmlEsc;

  function val(id)       { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
  function setText(id, v){ const el = document.getElementById(id); if (el) el.textContent = v; }

  // ── funcionários: cadastro, edição, exclusão, pausas ──────────────────────
  async function pegaFuncionario() {
    const nome  = val('funcionarionome');
    const espec = val('especializacao');
    const per   = val('periodotrabalho');
    const cat   = val('categoria');
    const obs   = val('observacoes');
    const p1    = val('pausa1');
    const p2    = val('pausa2');
    const p3    = val('pausa3');
    const msgEl = document.getElementById('save-msg-func');
    if (!nome || !cat) {
      msgEl.style.color = 'red'; msgEl.textContent = 'Nome e categoria são obrigatórios.'; return;
    }
    try {
      const dados = await apiFetch('/funcionarios', {
        method: 'POST',
        body: JSON.stringify({ nomecompleto: nome, especializacao: espec, periodotrabalho: per, categoria: cat, observacoes: obs, pausa1: p1, pausa2: p2, pausa3: p3 })
      });
      if (dados && dados.status === 'sucesso') {
        msgEl.style.color = 'green'; msgEl.textContent = '✓ Funcionário salvo!';
        ['funcionarionome','especializacao','observacoes','pausa1','pausa2','pausa3'].forEach(id => setVal(id, ''));
        document.getElementById('periodotrabalho').selectedIndex = 0;
        document.getElementById('categoria').selectedIndex = 0;
        carregarFuncionarios();
      } else { msgEl.style.color = 'red'; msgEl.textContent = (dados && dados.mensagem) || 'Erro ao salvar.'; }
    } catch { msgEl.style.color = 'red'; msgEl.textContent = 'Erro ao conectar.'; }
    setTimeout(() => { msgEl.textContent = ''; }, 3500);
  }

  window.pegaFuncionario = pegaFuncionario;

  async function buscarFuncionario() {
    const nome  = val('busca-nome');
    const msgEl = document.getElementById('msg-edicao');
    const form  = document.getElementById('form-edicao');
    if (!nome) { msgEl.style.color = 'red'; msgEl.textContent = 'Digite um nome para buscar.'; return; }
    try {
      const dados = await apiFetch('/funcionarios');
      const lista = dados ? (dados.funcionarios || []) : [];
      const func  = lista.find(f => f.nomecompleto.toLowerCase().includes(nome.toLowerCase()));
      if (!func) { msgEl.style.color = 'red'; msgEl.textContent = 'Funcionário não encontrado.'; form.style.display = 'none'; return; }
      form.style.display = 'block';
      setVal('edit-nome',   func.nomecompleto);
      setVal('edit-espec',  func.especializacao || '');
      setVal('edit-obs',    func.observacoes || '');
      setVal('edit-pausa1', func.pausa1 || '');
      setVal('edit-pausa2', func.pausa2 || '');
      setVal('edit-pausa3', func.pausa3 || '');
      const selPer = document.getElementById('edit-periodo');
      if (selPer) selPer.value = func.periodotrabalho || '';
      const selCat = document.getElementById('edit-cat');
      if (selCat) selCat.value = func.categoria || '';
      form.dataset.funcId = func.id;
      msgEl.textContent = '';
    } catch { msgEl.style.color = 'red'; msgEl.textContent = 'Erro ao buscar.'; }
  }

  window.buscarFuncionario = buscarFuncionario;

  async function salvarEdicao() {
    const form  = document.getElementById('form-edicao');
    const id    = form ? form.dataset.funcId : null;
    const msgEl = document.getElementById('msg-edicao');
    if (!id) { msgEl.style.color = 'red'; msgEl.textContent = 'Busque um funcionário primeiro.'; return; }
    try {
      const dados = await apiFetch('/funcionarios/' + id, {
        method: 'PUT',
        body: JSON.stringify({
          nomecompleto:    val('edit-nome'),
          especializacao:  val('edit-espec'),
          periodotrabalho: val('edit-periodo'),
          categoria:       val('edit-cat'),
          observacoes:     val('edit-obs'),
          pausa1:          val('edit-pausa1'),
          pausa2:          val('edit-pausa2'),
          pausa3:          val('edit-pausa3')
        })
      });
      if (dados && dados.status === 'sucesso') {
        msgEl.style.color = 'green'; msgEl.textContent = '✓ Funcionário atualizado!';
        carregarFuncionarios();
      } else { msgEl.style.color = 'red'; msgEl.textContent = (dados && dados.mensagem) || 'Erro ao atualizar.'; }
    } catch { msgEl.style.color = 'red'; msgEl.textContent = 'Erro ao conectar.'; }
    setTimeout(() => { msgEl.textContent = ''; }, 3500);
  }

  window.salvarEdicao = salvarEdicao;

  async function excluirFuncionario() {
    const form  = document.getElementById('form-edicao');
    const id    = form ? form.dataset.funcId : null;
    const msgEl = document.getElementById('msg-edicao');
    if (!id) return;
    if (!confirm('Excluir este funcionário? Todos os erros serão mantidos.')) return;
    try {
      const dados = await apiFetch('/funcionarios/' + id, { method: 'DELETE' });
      if (dados && dados.status === 'sucesso') {
        msgEl.style.color = 'green'; msgEl.textContent = '✓ Funcionário excluído!';
        form.style.display = 'none'; setVal('busca-nome', '');
        carregarFuncionarios();
      } else { msgEl.style.color = 'red'; msgEl.textContent = (dados && dados.mensagem) || 'Erro ao excluir.'; }
    } catch { msgEl.style.color = 'red'; msgEl.textContent = 'Erro ao conectar.'; }
    setTimeout(() => { msgEl.textContent = ''; }, 3500);
  }

  window.excluirFuncionario = excluirFuncionario;

  async function importarPausas() {
    const input = document.getElementById('arquivo-pausas');
    const msgEl = document.getElementById('msg-import-pausas');
    if (!input || !input.files[0]) { msgEl.style.color = 'red'; msgEl.textContent = 'Selecione um arquivo .xlsx.'; return; }
    const formData = new FormData();
    formData.append('file', input.files[0]);
    try {
      const res = await fetch(API + '/importar-pausas', { method: 'POST', credentials: 'include', body: formData });
      const dados = await res.json();
      if (dados && dados.status === 'sucesso') { msgEl.style.color = 'green'; msgEl.textContent = dados.mensagem || '✓ Pausas importadas!'; }
      else { msgEl.style.color = 'red'; msgEl.textContent = (dados && dados.mensagem) || 'Erro ao importar.'; }
    } catch { msgEl.style.color = 'red'; msgEl.textContent = 'Erro ao conectar.'; }
    setTimeout(() => { msgEl.textContent = ''; }, 4000);
  }

  window.importarPausas = importarPausas;

  // ── init ───────────────────────────────────────────────────────────────────
  function init() {
    initNavigation();
    initForms();
    initSync();
    initTheme();

    const btnBack = document.getElementById('btn-back');
    if (btnBack) btnBack.addEventListener('click', showList);

    carregarFuncionarios();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
