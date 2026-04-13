// Este ficheiro gere a autenticação comunicando com a nossa API Node em /api/auth

// Funções utilitárias para sessão
function storeSession(sessionData, rememberMe) {
    const dataToStore = {
        data: sessionData,
        expiry: rememberMe ? (Date.now() + 30 * 24 * 60 * 60 * 1000) : null
    };
    if (rememberMe) {
        localStorage.setItem('eletrosync_session', JSON.stringify(dataToStore));
        sessionStorage.removeItem('eletrosync_session');
    } else {
        sessionStorage.setItem('eletrosync_session', JSON.stringify(dataToStore));
        localStorage.removeItem('eletrosync_session');
    }
}

function retrieveSession() {
    let sessionStr = sessionStorage.getItem('eletrosync_session') || localStorage.getItem('eletrosync_session');
    if (!sessionStr) return null;
    
    try {
        const parsed = JSON.parse(sessionStr);
        if (parsed.expiry && Date.now() > parsed.expiry) {
            localStorage.removeItem('eletrosync_session');
            sessionStorage.removeItem('eletrosync_session');
            return null;
        }
        return parsed.data ? parsed.data : parsed;
    } catch (e) {
        return null;
    }
}

// Função auxiliar para inicializar a sessão se existir cache
function checkSession() {
    let isAuthenticated = false;
    const sessionData = retrieveSession();
    
    if (sessionData && sessionData.user) {
        console.log("Utilizador autenticado via API:", sessionData.user);
        updateUIAfterLogin(sessionData.user);
        isAuthenticated = true;
    }

    if (!isAuthenticated) {
        updateUIForLoggedOut();
    }
}

function updateUIForLoggedOut() {
    // Esconder o botão de logout usando a classe do Bootstrap 'd-none'
    const logoutBtnContainers = document.querySelectorAll('#logout-btn-container');
    logoutBtnContainers.forEach(container => container.classList.add('d-none'));

    // Mudar o link de perfil para login e usar ícone de 'entrar'
    const profileLinks = document.querySelectorAll('a[href="profile.html"], a[href="/profile"]');
    profileLinks.forEach(link => {
        link.href = '/login.html';
        link.title = 'Entrar / Registar';
        link.innerHTML = '<i class="fa-solid fa-right-to-bracket fs-5" style="padding: 2px;"></i>';
    });

    // Se estiver explicitamente na página de perfil, alertar e redirecionar
    const path = window.location.pathname;
    if (path.includes('profile') && !path.includes('product-profile')) {
        alert("Não tens sessão iniciada!");
        window.location.href = '/login.html';
    }
}

function updateUIAfterLogin(user) {
    // Redirecionamento se estiver nas páginas de login/registo
    const path = window.location.pathname;
    if (path.includes('login') || path.includes('register')) {
        window.location.href = '/profile';
    }

    // Podes atualizar o nome no header ou esconder botões de 'login' se existirem
    const profileLink = document.querySelector('a[href="profile.html"]');
    if (profileLink) {
        profileLink.title = user.user_metadata?.full_name || user.email;
    }

    // Atualiza o nome na página de perfil, se estivermos nela
    const profileNameElement = document.getElementById('profile-user-name');
    if (profileNameElement) {
        const userName = user.user_metadata?.full_name || user.email.split('@')[0];
        profileNameElement.textContent = `Olá ${userName}!`;
    }
}

// Lógica Visual da Força da Password
let pendingEmail = "";
let pendingPassword = "";

const registerForm = document.getElementById('register-form');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirm-password');
const pwBar = document.getElementById('pw-bar');
const pwText = document.getElementById('pw-text');

if (passwordInput) {
    passwordInput.addEventListener('input', () => {
        const val = passwordInput.value;
        let pwr = 0;

        if (val.length > 5) pwr += 33;
        if (val.length > 7 && /[A-Z]/.test(val) && /[0-9]/.test(val)) pwr += 33;
        if (val.length > 10 && /[^A-Za-z0-9]/.test(val)) pwr += 34;

        if (pwr === 0) {
            pwBar.style.width = '0%';
            pwBar.style.backgroundColor = 'transparent';
            pwText.innerText = "Força da password";
            pwText.style.color = '#6c757d';
        } else if (pwr <= 33) {
            pwBar.style.width = '33%';
            pwBar.style.backgroundColor = '#dc3545'; // Vermelho
            pwText.innerText = "Fraca";
            pwText.style.color = '#dc3545';
        } else if (pwr <= 66) {
            pwBar.style.width = '66%';
            pwBar.style.backgroundColor = '#ffc107'; // Amarelo
            pwText.innerText = "Média";
            pwText.style.color = '#ffc107';
        } else {
            pwBar.style.width = '100%';
            pwBar.style.backgroundColor = '#198754'; // Verde
            pwText.innerText = "Forte";
            pwText.style.color = '#198754';
        }
    });
}

// Lidar com o Formulário de Registo (Comunicando com Node Backend)
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value;
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        const name = document.getElementById('name').value;

        // Validar correspondência da password
        if (password !== confirmPassword) {
            confirmPasswordInput.classList.add('is-invalid');
            return;
        } else {
            confirmPasswordInput.classList.remove('is-invalid');
        }

        const btn = document.getElementById('register-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> A registar...';

        try {
            const resp = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name })
            });
            const responseData = await resp.json();

            if (!resp.ok) {
                alert("Erro: " + (responseData.error || "Algo falhou"));
            } else {
                // Sucesso no registo
                pendingEmail = email;
                pendingPassword = password;
                document.getElementById('register-view').classList.add('hidden');
                document.getElementById('confirm-view').classList.remove('hidden');
            }
        } catch (error) {
            console.error("Erro na API de registo:", error);
            alert("Erro de conexão ao servidor.");
        } finally {
            btn.disabled = false;
            btn.innerText = "Registar Gratuitamente";
        }
    });
}

// Botão "Já confirmei o email"
const verifyDoneBtn = document.getElementById('verify-done-btn');
if (verifyDoneBtn) {
    verifyDoneBtn.addEventListener('click', async () => {
        verifyDoneBtn.disabled = true;
        verifyDoneBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> A verificar...';

        try {
            const resp = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: pendingEmail, password: pendingPassword })
            });
            const responseData = await resp.json();

            if (!resp.ok) {
                alert("O email ainda não foi confirmado ou ocorreu um erro.\nSe já clicou no link, aguarde uns segundos e tente de novo.");
                verifyDoneBtn.disabled = false;
                verifyDoneBtn.innerText = "Já confirmei o email";
            } else {
                // Sucesso! Guardar token sem duração permanente a menos que alterem
                storeSession({
                    user: responseData.user,
                    session: responseData.session
                }, false);
                window.location.href = "/";
            }
        } catch (error) {
            console.error("Erro na API de verificação:", error);
            verifyDoneBtn.disabled = false;
            verifyDoneBtn.innerText = "Já confirmei o email";
        }
    });
}

// Lidar com o Formulário de Login (Comunicando com Node Backend)
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('login-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> A entrar...';

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const resp = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const responseData = await resp.json();

            if (!resp.ok) {
                let errorMsg = responseData.error || "Erro ao entrar.";
                if (errorMsg.includes('Email not confirmed')) errorMsg = "Por favor confirme o seu email antes de entrar!";
                alert("Erro: " + errorMsg);
            } else {
                // Logado com sucesso
                const rememberMeEl = document.getElementById('remember-me');
                const rememberMe = rememberMeEl ? rememberMeEl.checked : false;
                
                storeSession({
                    user: responseData.user,
                    session: responseData.session
                }, rememberMe);
                window.location.href = "/";
            }
        } catch (error) {
            console.error("Erro na API de Login:", error);
            alert("Erro de conexão ao servidor.");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = "Entrar na Conta";
            }
        }
    });
}

// Lidar com o Logout
async function handleLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { }
    localStorage.removeItem('eletrosync_session');
    sessionStorage.removeItem('eletrosync_session');
    window.location.href = "/";
}

// Exportar ou colocar global
window.handleLogout = handleLogout;

// Chamar a verificação de sessão local no arranque
checkSession();
