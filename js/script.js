(function () {
  'use strict';

  const API = "https://errtrack-uesv.onrender.com";

  var selSev  = '';
  var myChart = null;

  var SEV_W   = { baixa: 1, media: 2, alta: 3, critica: 4 };
  var SEV_CLS = { baixa: 's-bx', media: 's-md', alta: 's-al', critica: 's-cr' };

  // ── API helper ─────────────────────────────────────────────────────────────

  async function apiFetch(path, options = {}) {
    const res = await fetch(API + path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    if (res.status === 401) {
      window.location.href = "/";
      return null;
    }
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

    if (page === 'painel') renderDashboard();
  }

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

    // agrupa erros por funcionário
    const DB = {};
    erros.forEach(e => {
      if (!DB[e.nomefuncionario]) {
        DB[e.nomefuncionario] = { categoria: e.cat_func || '', errors: [] };
      }
      DB[e.nomefuncionario].errors.push(e);
    });

    const names  = Object.keys(DB);
    const master = names.filter(n => DB[n].categoria === 'Master');
    const multi  = names.filter(n => DB[n].categoria === 'MultiSkill');

    function calcKpis(lista) {
      var tot = 0, cri = 0, piora = 0, melh = 0;
      lista.forEach(n => {
        const errs = DB[n].errors || [];
        tot  += errs.length;
        cri  += errs.filter(e => e.gravidade === 'critica').length;
        const tr = getTrend(errs);
        if (tr === 'up')   piora++;
        if (tr === 'down') melh++;
      });
      return { tot, cri, piora, melh };
    }

    const km  = calcKpis(master);
    const kmu = calcKpis(multi);

    setText('kpi-master-total',   km.tot);
    setText('kpi-master-critica', km.cri);
    setText('kpi-master-piora',   km.piora);
    setText('kpi-master-melhora', km.melh);

    setText('kpi-multi-total',   kmu.tot);
    setText('kpi-multi-critica', kmu.cri);
    setText('kpi-multi-piora',   kmu.piora);
    setText('kpi-multi-melhora', kmu.melh);

    const gridMaster = document.getElementById('emp-grid-master');
    const gridMulti  = document.getElementById('emp-grid-multiskill');
    const empty      = document.getElementById('emp-empty');

    if (!gridMaster || !gridMulti) return;

    if (!names.length) {
      gridMaster.innerHTML = '';
      gridMulti.innerHTML  = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    function renderCard(n) {
      const emp  = DB[n];
      const errs = emp.errors || [];
      const avg  = getAvg(errs);
      const c    = errs.filter(e => e.gravidade === 'critica').length;
      const tr   = getTrend(errs);
      const ti   = tInfo(tr);
      const meta = errs.length + ' erro' + (errs.length !== 1 ? 's' : '');

      return '<div class="kpi" style="cursor:pointer" data-emp-card="' + encodeURIComponent(n) + '">'
        + '<div class="kl" style="font-weight:bold; font-size:16px;">' + htmlEsc(n) + '</div>'
        + '<div class="ps">' + meta + '</div>'
        + '<div style="display:flex; gap:15px; margin-top:10px;">'
        +   '<div><span style="font-size:11px;">Média:</span> <strong>' + avg + '</strong></div>'
        +   '<div><span style="font-size:11px;">Críticos:</span> <strong style="color:red">' + c + '</strong></div>'
        + '</div>'
        + '<span style="font-size:12px; margin-top:5px; display:inline-block;">' + ti.icon + ' ' + ti.label + '</span>'
        + '</div>';
    }

    gridMaster.innerHTML = master.map(renderCard).join('');
    gridMulti.innerHTML  = multi.map(renderCard).join('');

    document.querySelectorAll('[data-emp-card]').forEach(card => {
      card.addEventListener('click', function () {
        openDetail(decodeURIComponent(this.dataset.empCard));
      });
    });
  }

  // ── detalhe do funcionário ─────────────────────────────────────────────────

  async function openDetail(nome) {
    const dados = await apiFetch('/erros/' + encodeURIComponent(nome));
    if (!dados) return;

    const erros = dados.erros || [];

    show('pn-detail'); hide('pn-list');
    setText('d-name',  nome);
    setText('d-cargo', '');

    setText('dm-total',   erros.length);
    setText('dm-avg',     getAvg(erros));
    setText('dm-critica', erros.filter(e => e.gravidade === 'critica').length);

    const periods = [...new Set(erros.map(e => e.periodo).filter(Boolean))];
    setText('dm-period', periods[periods.length - 1] || '—');

    const tr = getTrend(erros);
    const ti = tInfo(tr);
    const trendEl = document.getElementById('d-trend');
    if (trendEl) trendEl.textContent = ti.icon + ' ' + ti.label;

    renderChart(erros);
    renderErrList(nome, erros);
  }

  function renderChart(erros) {
    const byP = {};
    erros.forEach(e => {
      if (!byP[e.periodo]) byP[e.periodo] = { sum: 0, cnt: 0 };
      byP[e.periodo].sum += (SEV_W[e.gravidade] || 1);
      byP[e.periodo].cnt++;
    });
    const labs = Object.keys(byP);
    const avgs = labs.map(l => +(byP[l].sum / byP[l].cnt).toFixed(2));

    if (myChart) { myChart.destroy(); myChart = null; }
    const canvas = document.getElementById('chart-canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    myChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labs,
        datasets: [{
          label: 'Gravidade Média',
          data: avgs,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 1, max: 4,
            ticks: {
              callback: v => ['', 'Baixa', 'Média', 'Alta', 'Crítica'][Math.round(v)] || ''
            }
          }
        }
      }
    });
  }

  function renderErrList(nome, erros) {
    const wrap = document.getElementById('err-list');
    if (!wrap) return;

    const sorted = erros.slice().sort((a, b) => b.ts - a.ts);
    if (!sorted.length) {
      wrap.innerHTML = '<div style="font-size:12px;color:gray;padding:12px 0;">Nenhum erro registrado ainda.</div>';
      return;
    }

    wrap.innerHTML = sorted.map(e => {
      const cls  = SEV_CLS[e.gravidade] || 's-md';
      const meta = htmlEsc(e.periodo) + (e.categoria ? ' · ' + htmlEsc(e.categoria) : '');
      return '<div class="el-item" style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid rgba(255,255,255,0.05)">'
        + '<div>'
        +   '<span class="badge ' + cls + '" style="margin-right:10px;">' + (e.gravidade || '?').toUpperCase() + '</span>'
        +   '<strong>' + htmlEsc(e.descricao) + '</strong> <small style="color:gray">(' + meta + ')</small>'
        + '</div>'
        + '<button class="btn-del" style="background:none; border:none; color:red; cursor:pointer;" data-erro-id="' + e.id + '" data-emp-nome="' + encodeURIComponent(nome) + '">×</button>'
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
    show('pn-list'); hide('pn-detail');
    renderDashboard();
  }

  // ── registrar erro ─────────────────────────────────────────────────────────

  function initForms() {
    const SEV_SEL = { baixa: 'a-bx', media: 'a-md', alta: 'a-al', critica: 'a-cr' };

    document.querySelectorAll('.sp-pick .so').forEach(btn => {
      btn.addEventListener('click', function () {
        selSev = this.dataset.sev;
        document.querySelectorAll('.sp-pick .so').forEach(b => {
          b.classList.remove('a-bx', 'a-md', 'a-al', 'a-cr');
        });
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

    const categoria = nomeMaster ? 'Master' : 'MultiSkill';

    try {
      const dados = await apiFetch('/erros', {
        method: 'POST',
        body: JSON.stringify({
          nomefuncionario: nome,
          periodo:         '',
          descricao:       desc,
          gravidade:       selSev,
          categoria:       categoria
        })
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
    if (btnExport) btnExport.addEventListener('click', async () => {
      const dados = await apiFetch('/erros');
      if (!dados || !dados.erros.length) { showToast('Nenhum dado para exportar.', 'wn'); return; }

      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'errtrack_backup.json';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Dados exportados!', 'ok');
    });
  }

  // ── tema ───────────────────────────────────────────────────────────────────

  function initTheme() {
    const btn   = document.getElementById('theme-btn');
    const saved = localStorage.getItem('errtrack_theme') || 'dark';
    if (saved === 'light') { document.body.classList.add('light-theme'); if (btn) btn.textContent = '☀️'; }
    if (btn) btn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-theme');
      localStorage.setItem('errtrack_theme', isLight ? 'light' : 'dark');
      btn.textContent = isLight ? '☀️' : '🌙';
    });
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
    t.className = 'toast show ' + (type || 'success');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('show'), 3600);
  }

  function htmlEsc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function val(id)       { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
  function setText(id,v) { const el = document.getElementById(id); if (el) el.textContent = v; }
  function show(id)      { const el = document.getElementById(id); if (el) el.style.display = 'block'; }
  function hide(id)      { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

  // ── init ───────────────────────────────────────────────────────────────────

  function init() {
    initNavigation();
    initForms();
    initSync();
    initTheme();

    const btnBack = document.getElementById('btn-back');
    if (btnBack) btnBack.addEventListener('click', showList);

    carregarFuncionarios();
    renderDashboard();
    console.log('[ErrTrack] Conectado à API.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
