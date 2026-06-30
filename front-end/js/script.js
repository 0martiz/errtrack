(function () {
  'use strict';

  const API = "https://errtrack-45jm.onrender.com";
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
    if (res.status === 401) { window.location.href = "/"; return null; }
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
    const DB = {};
    erros.forEach(e => {
      if (!DB[e.nomefuncionario]) DB[e.nomefuncionario] = { categoria: e.cat_func || '', errors: [] };
      DB[e.nomefuncionario].errors.push(e);
    });
    const names  = Object.keys(DB);
    const master = names.filter(n => DB[n].categoria === 'Master');
    const multi  = names.filter(n => DB[n].categoria === 'MultiSkill');

    function calcKpis(lista) {
      var tot = 0, cri = 0, piora = 0, melh = 0;
      lista.forEach(n => {
        const errs = DB[n].errors || [];
        tot += errs.length;
        cri += errs.filter(e => e.gravidade === 'critica').length;
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
    setText('kpi-multi-total',    kmu.tot);
    setText('kpi-multi-critica',  kmu.cri);
    setText('kpi-multi-piora',    kmu.piora);
    setText('kpi-multi-melhora',  kmu.melh);

    const gridMaster = document.getElementById('emp-grid-master');
    const gridMulti  = document.getElementById('emp-grid-multiskill');
    const empty      = document.getElementById('emp-empty');
    if (!gridMaster || !gridMulti) return;
    if (!names.length) {
      gridMaster.innerHTML = ''; gridMulti.innerHTML = '';
      if (empty) empty.style.display = 'block'; return;
    }
    if (empty) empty.style.display = 'none';

    const SEV_COLORS = { baixa:'#22c55e', media:'#eab308', alta:'#f97316', critica:'#ef4444' };

    function renderCard(n) {
      const emp  = DB[n];
      const errs = emp.errors || [];
      const avg  = getAvg(errs);
      const c    = errs.filter(e => e.gravidade === 'critica').length;
      const tr   = getTrend(errs);
      const ti   = tInfo(tr);
      const meta = errs.length + ' erro' + (errs.length !== 1 ? 's' : '');

      // Mini sparkline dos últimos 6 erros por gravidade
      const recent = errs.slice().sort((a,b) => a.ts - b.ts).slice(-6);
      const sparkW = 80, sparkH = 28;
      let sparkline = '';
      if (recent.length >= 2) {
        const pts = recent.map((e, i) => {
          const x = Math.round((i / (recent.length - 1)) * sparkW);
          const y = Math.round(sparkH - ((SEV_W[e.gravidade] || 1) / 4) * sparkH);
          return x + ',' + y;
        }).join(' ');
        const lastColor = SEV_COLORS[recent[recent.length-1].gravidade] || '#8b5cf6';
        sparkline = '<svg width="' + sparkW + '" height="' + sparkH + '" style="margin-top:8px;opacity:.8">'
          + '<polyline points="' + pts + '" fill="none" stroke="' + lastColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
          + '</svg>';
      }

      return '<div class="ec" style="cursor:pointer" data-emp-card="' + encodeURIComponent(n) + '">'
        + '<div class="ec-stripe"></div>'
        + '<div class="ec-n">' + htmlEsc(n) + '</div>'
        + '<div class="ec-m">' + meta + '</div>'
        + '<div class="ec-s">'
        +   '<div class="es"><div class="esv">' + avg + '</div><div class="esl">Média</div></div>'
        +   '<div class="es"><div class="esv" style="' + (c > 0 ? 'color:var(--rd)' : '') + '">' + c + '</div><div class="esl">Críticos</div></div>'
        + '</div>'
        + sparkline
        + '<span class="tb ' + (tr==='up'?'t-up':tr==='down'?'t-dn':'t-fl') + '" style="margin-top:8px;display:inline-block">' + ti.icon + ' ' + ti.label + '</span>'
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
    renderPausas(nome);
  }

  async function renderPausas(nome) {
    const wrap = document.getElementById('d-pausas-wrap');
    const span = document.getElementById('d-pausas');
    if (!wrap || !span) return;
    try {
      const dados = await apiFetch('/funcionarios/' + encodeURIComponent(nome));
      const f = dados && dados.funcionario;
      const partes = [];
      if (f && f.pausa1) partes.push('1ª ' + f.pausa1);
      if (f && f.pausa2) partes.push('2ª ' + f.pausa2);
      if (f && f.pausa3) partes.push('3ª ' + f.pausa3);
      if (partes.length) {
        span.textContent = partes.join('  ·  ');
        wrap.style.display = 'block';
      } else {
        wrap.style.display = 'none';
      }
    } catch {
      wrap.style.display = 'none';
    }
  }

  function renderChart(erros) {
    // Ordena por timestamp e agrupa por data
    const sorted = erros.slice().sort((a, b) => a.ts - b.ts);
    const byDate = {};
    sorted.forEach(e => {
      const d = new Date(e.ts * 1000).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
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

    const gradPurple = ctx.createLinearGradient(0, 0, 0, 180);
    gradPurple.addColorStop(0, 'rgba(139,92,246,.25)');
    gradPurple.addColorStop(1, 'rgba(139,92,246,0)');

    myChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labs,
        datasets: [
          {
            label: 'Gravidade Média',
            data: avgs,
            borderColor: '#8b5cf6',
            backgroundColor: gradPurple,
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#8b5cf6',
            pointBorderColor: '#111827',
            pointBorderWidth: 2,
            pointHoverRadius: 6,
          },
          {
            label: 'Críticos',
            data: crits,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#ef4444',
            pointBorderColor: '#111827',
            pointBorderWidth: 2,
            pointHoverRadius: 6,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 8 } },
          tooltip: {
            backgroundColor: '#111827',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            padding: 10,
          }
        },
        scales: {
          y: {
            min: 0,
            ticks: {
              color: '#64748b', font: { size: 10 },
              callback: v => v === Math.round(v) ? (['','Baixa','Média','Alta','Crítica'][Math.round(v)] || v) : ''
            },
            grid: { color: 'rgba(255,255,255,.04)' }
          },
          x: {
            ticks: { color: '#64748b', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,.04)' }
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
      wrap.innerHTML = '<div style="font-size:12px;color:var(--mt);padding:12px 0;">Nenhum erro registrado ainda.</div>';
      return;
    }
    wrap.innerHTML = sorted.map(e => {
      const cls  = SEV_CLS[e.gravidade] || 's-md';
      const data = new Date(e.ts * 1000).toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric'});
      const meta = data + (e.periodo ? ' · ' + htmlEsc(e.periodo) : '') + (e.categoria ? ' · ' + htmlEsc(e.categoria) : '');
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
    show('pn-list'); hide('pn-detail');
    renderDashboard();
  }

  // ── registrar erro ─────────────────────────────────────────────────────────
  function initForms() {
    const SEV_SEL = { baixa: 'a-bx', media: 'a-md', alta: 'a-al', critica: 'a-cr' };
    document.querySelectorAll('.sp-pick .so').forEach(btn => {
      btn.addEventListener('click', function () {
        selSev = this.dataset.sev;
        document.querySelectorAll('.sp-pick .so').forEach(b => b.classList.remove('a-bx','a-md','a-al','a-cr'));
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

    // Sanitiza entrada
    const descSanitizada = desc.replace(/[<>'"]/g, '');
    const categoria = nomeMaster ? 'Master' : 'MultiSkill';

    try {
      const dados = await apiFetch('/erros', {
        method: 'POST',
        body: JSON.stringify({
          nomefuncionario: nome,
          periodo:         '',
          descricao:       descSanitizada,
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
        document.querySelectorAll('.sp-pick .so').forEach(b => b.classList.remove('a-bx','a-md','a-al','a-cr'));
        setTimeout(() => { if (msgEl) msgEl.textContent = ''; }, 3200);
      }
    } catch {
      if (msgEl) { msgEl.style.color = 'red'; msgEl.textContent = 'Erro ao conectar ao servidor.'; }
    }
  }

  // ── exportar ───────────────────────────────────────────────────────────────
  function initSync() {
    const btnExport = document.getElementById('btn-export-top');
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        window.location.href = '/exportar-excel';
      });
    }
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
      const lista = dados.funcionarios || [];
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
    return { up:{label:'Piorando',icon:'↑'}, down:{label:'Melhorando',icon:'↓'}, flat:{label:'Estável',icon:'→'} }[t] || {label:'Estável',icon:'→'};
  }

  function showToast(msg, type) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (type === 'ok' ? 't-ok' : type === 'er' ? 't-er' : 't-wn') + ' on';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('on'), 3600);
  }

  function htmlEsc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
