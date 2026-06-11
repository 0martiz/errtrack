const API = "https://errtrack-uesv.onrender.com";

// toggle tema
const themeBtn = document.getElementById('theme-btn');
const saved = localStorage.getItem('errtrack-theme');
if (saved === 'light') { document.body.classList.add('light'); themeBtn.textContent = '☀️'; }

themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('light');
    const isLight = document.body.classList.contains('light');
    themeBtn.textContent = isLight ? '☀️' : '🌙';
    localStorage.setItem('errtrack-theme', isLight ? 'light' : 'dark');
});

// toggle mostrar/ocultar senha
const pwToggle = document.getElementById('pw-toggle');
const senhaInput = document.getElementById('login-senha');

pwToggle.addEventListener('click', () => {
    const show = senhaInput.type === 'password';
    senhaInput.type = show ? 'text' : 'password';
    pwToggle.querySelector('svg').innerHTML = show
        ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
        : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
});

async function fazerLogin() {
    const usuario = document.getElementById('login-usuario').value.trim();
    const senha   = document.getElementById('login-senha').value;
    const errEl   = document.getElementById('login-error');
    errEl.style.display = 'none';

    try {
        const res = await fetch(API + '/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, senha })
        });
        const dados = await res.json();
        if (dados.status === 'sucesso') {
            window.location.href = '/sistema';
        } else {
            errEl.style.display = 'block';
        }
    } catch {
        errEl.style.display = 'block';
    }
}
