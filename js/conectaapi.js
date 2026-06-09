const API = "https://errtrack-uesv.onrender.com";

async function apiFetch(path, options = {}) {
    const res = await fetch(API + path, {
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options
    });
    return res.json();
}

// ── funcionários ──────────────────────────────────────────────────────────────

async function pegaFuncionario() {
    const nome       = document.getElementById('funcionarionome').value.trim();
    const espec      = document.getElementById('especializacao').value.trim();
    const periodo    = document.getElementById('periodotrabalho').value;
    const categoria  = document.getElementById('categoria').value;
    const observacao = document.getElementById('observacoes').value.trim();
    const msgEl      = document.getElementById('save-msg-func');

    if (!nome) {
        msgEl.style.color = 'red';
        msgEl.textContent = 'Nome do funcionário é obrigatório.';
        return;
    }

    try {
        const dados = await apiFetch('/funcionarios', {
            method: 'POST',
            body: JSON.stringify({
                classnomefuncionario: nome,
                classespecializacao:  espec,
                classperiodo:         periodo,
                classcategoria:       categoria,
                "classobservações":   observacao
            })
        });

        if (dados.status === 'sucesso') {
            msgEl.style.color = 'green';
            msgEl.textContent = 'Funcionário cadastrado com sucesso!';
            document.getElementById('funcionarionome').value = '';
            document.getElementById('especializacao').value  = '';
            document.getElementById('observacoes').value     = '';
            carregarFuncionarios();
        } else {
            msgEl.style.color = 'red';
            msgEl.textContent = dados.mensagem || 'Erro ao cadastrar.';
        }
    } catch {
        msgEl.style.color = 'red';
        msgEl.textContent = 'Não foi possível conectar ao servidor.';
    }

    setTimeout(() => { msgEl.textContent = ''; }, 3000);
}

async function buscarFuncionario() {
    const nome = document.getElementById('busca-nome').value.trim();
    if (!nome) return alert('Digite um nome para buscar.');

    try {
        const dados = await apiFetch('/funcionarios/' + encodeURIComponent(nome));
        if (!dados.funcionario) {
            alert('Funcionário não encontrado.');
            document.getElementById('form-edicao').style.display = 'none';
            return;
        }
        const f = dados.funcionario;
        window._nomeOriginal = f[1];
        document.getElementById('edit-nome').value    = f[1];
        document.getElementById('edit-espec').value   = f[2];
        document.getElementById('edit-periodo').value = f[3];
        document.getElementById('edit-cat').value     = f[4];
        document.getElementById('edit-obs').value     = f[5];
        document.getElementById('form-edicao').style.display = 'block';
    } catch {
        alert('Erro ao conectar ao servidor.');
    }
}

async function salvarEdicao() {
    const body = {
        nomefuncionario: document.getElementById('edit-nome').value,
        especializacao:  document.getElementById('edit-espec').value,
        periodo:         document.getElementById('edit-periodo').value,
        categoria:       document.getElementById('edit-cat').value,
        observacoes:     document.getElementById('edit-obs').value
    };
    try {
        const dados = await apiFetch('/funcionarios/' + encodeURIComponent(window._nomeOriginal), {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        const msg = document.getElementById('msg-edicao');
        msg.style.color = dados.status === 'sucesso' ? 'green' : 'red';
        msg.textContent = dados.mensagem;
        setTimeout(() => { msg.textContent = ''; }, 3000);
        if (dados.status === 'sucesso') carregarFuncionarios();
    } catch {
        alert('Erro ao salvar.');
    }
}

async function excluirFuncionario() {
    if (!confirm('Tem certeza que deseja excluir este funcionário?')) return;
    try {
        const dados = await apiFetch('/funcionarios/' + encodeURIComponent(window._nomeOriginal), { method: 'DELETE' });
        alert(dados.mensagem);
        document.getElementById('form-edicao').style.display = 'none';
        document.getElementById('busca-nome').value = '';
        carregarFuncionarios();
    } catch {
        alert('Erro ao excluir.');
    }
}

async function carregarFuncionarios() {
    try {
        const dados = await apiFetch('/funcionarios');
        const lista = dados.funcionarios || [];

        const selectMaster = document.getElementById('f-master');
        const selectMulti  = document.getElementById('f-multiskill');

        if (selectMaster) {
            const valM = selectMaster.value;
            selectMaster.innerHTML = '<option value="">— Selecione —</option>';
            lista.filter(f => f[2] === 'Master').forEach(f => {
                const opt = document.createElement('option');
                opt.value = f[1]; opt.textContent = f[1];
                selectMaster.appendChild(opt);
            });
            selectMaster.value = valM;
        }

        if (selectMulti) {
            const valMu = selectMulti.value;
            selectMulti.innerHTML = '<option value="">— Selecione —</option>';
            lista.filter(f => f[2] === 'MultiSkill').forEach(f => {
                const opt = document.createElement('option');
                opt.value = f[1]; opt.textContent = f[1];
                selectMulti.appendChild(opt);
            });
            selectMulti.value = valMu;
        }
    } catch {
        console.error('Erro ao carregar funcionários.');
    }
}
