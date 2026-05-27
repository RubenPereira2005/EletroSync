const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Criar o cliente com persistSession a false para não misturar utilizadores na memória do Servidor (sendo uma API pura)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
});

router.post('/register', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Faltam campos obrigatórios.' });
    }

    // Para onde o user é redirecionado depois de clicar no link de confirmação.
    // Override via env EMAIL_CONFIRM_REDIRECT - útil para diferentes ambientes.
    const emailRedirectTo = process.env.EMAIL_CONFIRM_REDIRECT
        || `${req.protocol}://${req.get('host')}/login.html`;

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { full_name: name },
            emailRedirectTo,
        }
    });

    if (error) {
        return res.status(400).json({ error: error.message });
    }

    return res.json({ message: 'Registo bem sucedido. Aguardando confirmação no email.', data });
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Faltam campos obrigatórios.' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
        email, 
        password
    });

    if (error) {
        return res.status(401).json({ error: error.message });
    }
    
    return res.json({ message: 'Login bem sucedido.', session: data.session, user: data.user });
});

// Numa arquitetura API pura, o logout principal ocorre ao destruir o token guardado no Frontend
router.post('/logout', async (req, res) => {
    return res.json({ message: 'Sessão destruída localmente no cliente.' });
});

// POST /api/auth/forgot-password - envia email com link de recuperação.
// Devolve sempre 200 mesmo se o email não existir (não expor que emails estão registados).
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || email.length > 254) {
        return res.status(400).json({ error: 'Email inválido.' });
    }

    // Redirect URL para a página onde o utilizador define a nova password.
    // PASSWORD_RESET_REDIRECT permite override (útil para diferentes ambientes).
    const redirectTo = process.env.PASSWORD_RESET_REDIRECT
        || `${req.protocol}://${req.get('host')}/reset-password.html`;

    try {
        await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    } catch (e) {
        // Não vazar detalhes - mas registar no log para debug
        console.error('[auth] forgot-password erro:', e.message);
    }

    return res.json({ message: 'Se este email estiver registado, vais receber um link para recuperar a palavra-passe.' });
});

// POST /api/auth/update-password - usa os tokens de recuperação para definir nova password.
// Os tokens vêm do link enviado por email (access_token + refresh_token no hash URL).
// O Supabase requer uma sessão COMPLETA (não só access_token) para updateUser().
router.post('/update-password', async (req, res) => {
    const { access_token, refresh_token, password } = req.body || {};

    if (!access_token || typeof access_token !== 'string') {
        return res.status(400).json({ error: 'Token de recuperação em falta.' });
    }
    if (!refresh_token || typeof refresh_token !== 'string') {
        return res.status(400).json({ error: 'Refresh token de recuperação em falta.' });
    }
    if (!password || typeof password !== 'string' || password.length < 8 || password.length > 72) {
        return res.status(400).json({ error: 'A palavra-passe deve ter entre 8 e 72 caracteres.' });
    }

    const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Estabelecer sessão completa (access + refresh). Sem isto, o updateUser falha
    // com "Auth session missing!" porque o cliente não tem state interno de auth.
    const { error: sessErr } = await userClient.auth.setSession({ access_token, refresh_token });
    if (sessErr) {
        return res.status(400).json({ error: 'Link de recuperação inválido ou expirado.' });
    }

    const { error } = await userClient.auth.updateUser({ password });
    if (error) {
        return res.status(400).json({ error: error.message });
    }

    return res.json({ message: 'Palavra-passe atualizada com sucesso.' });
});

// =============================================================================
// ENDPOINTS DE GESTÃO DE CONTA (requerem token de sessão válido)
// =============================================================================

// Middleware: valida o Bearer token. Se estiver expirado E houver refresh_token
// no header X-Refresh-Token, faz auto-refresh e devolve os novos tokens em
// headers (X-New-Access-Token, X-New-Refresh-Token) para o cliente guardar.
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!accessToken) return res.status(401).json({ error: 'Falta o token de autenticação.' });

    let { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data?.user) {
        // Tentar renovar com refresh_token, se vier no header
        const refreshToken = req.headers['x-refresh-token'];
        if (!refreshToken) return res.status(401).json({ error: 'Token inválido ou expirado.' });

        const refreshClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const refreshResult = await refreshClient.auth.refreshSession({ refresh_token: refreshToken });
        if (refreshResult.error || !refreshResult.data?.session) {
            return res.status(401).json({ error: 'Sessão expirada. Inicia sessão novamente.' });
        }

        const newAccess = refreshResult.data.session.access_token;
        const newRefresh = refreshResult.data.session.refresh_token;

        const reval = await supabase.auth.getUser(newAccess);
        if (reval.error || !reval.data?.user) {
            return res.status(401).json({ error: 'Sessão inválida.' });
        }

        // Expor novos tokens ao cliente via headers para ele atualizar localStorage.
        // Access-Control-Expose-Headers garante que o JS browser os consegue ler.
        res.setHeader('X-New-Access-Token', newAccess);
        res.setHeader('X-New-Refresh-Token', newRefresh);
        res.setHeader('Access-Control-Expose-Headers', 'X-New-Access-Token, X-New-Refresh-Token');

        req.user = reval.data.user;
        req.userToken = newAccess;
        return next();
    }

    req.user = data.user;
    req.userToken = accessToken;
    next();
}

// Cliente admin (service_role) - usado para operações que NÃO exigem fluxo de
// confirmação (delete account, change-password depois de verificar a antiga).
function getAdminClient() {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) return null;
    return createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

// Middleware que estabelece uma sessão completa (access + refresh) num cliente
// Supabase para chamadas que precisam de contexto de utilizador (updateUser,
// que dispara email de confirmação quando o email muda). Lê o refresh_token
// do header X-Refresh-Token.
async function withUserSession(req, res, next) {
    const refreshToken = req.headers['x-refresh-token'];
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token em falta.' });

    req.userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await req.userClient.auth.setSession({
        access_token: req.userToken,
        refresh_token: refreshToken,
    });
    if (error) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    next();
}

// PUT /api/auth/profile - atualiza nome e/ou email do utilizador autenticado.
// Usa setSession (com refresh_token do user) para que o updateUser dispare email
// de confirmação quando o email muda (fluxo standard Supabase).
router.put('/profile', requireAuth, withUserSession, async (req, res) => {
    const { name, email } = req.body || {};
    const updates = {};

    if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed.length < 2 || trimmed.length > 80) {
            return res.status(400).json({ error: 'Nome deve ter entre 2 e 80 caracteres.' });
        }
        // No fluxo user-context, a chave é `data` (e não `user_metadata`).
        updates.data = { ...(req.user.user_metadata || {}), full_name: trimmed };
    }

    let emailChanged = false;
    if (typeof email === 'string') {
        const trimmed = email.trim();
        if (trimmed.length === 0 || trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            return res.status(400).json({ error: 'Email inválido.' });
        }
        if (trimmed !== req.user.email) {
            updates.email = trimmed;
            emailChanged = true;
        }
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Nada para atualizar.' });
    }

    const { data, error } = await req.userClient.auth.updateUser(updates);
    if (error) return res.status(400).json({ error: error.message });

    return res.json({
        message: emailChanged
            ? 'Verifica o teu novo email para confirmar a alteração.'
            : 'Dados atualizados.',
        user: data.user,
    });
});

// POST /api/auth/change-password - altera a password do utilizador autenticado.
// Re-verifica a password antiga antes de aceitar (segurança). Usa admin client
// para o update final (Supabase exige sessão estabelecida, que não temos no servidor).
router.post('/change-password', requireAuth, async (req, res) => {
    const { current_password, new_password } = req.body || {};

    if (!current_password || typeof current_password !== 'string') {
        return res.status(400).json({ error: 'Palavra-passe atual em falta.' });
    }
    if (!new_password || typeof new_password !== 'string' || new_password.length < 8 || new_password.length > 72) {
        return res.status(400).json({ error: 'Nova palavra-passe deve ter entre 8 e 72 caracteres.' });
    }
    if (current_password === new_password) {
        return res.status(400).json({ error: 'A nova palavra-passe tem de ser diferente da atual.' });
    }

    const admin = getAdminClient();
    if (!admin) return res.status(500).json({ error: 'Funcionalidade não configurada no servidor (SUPABASE_SERVICE_KEY em falta).' });

    // Re-autenticar com a password atual para confirmar identidade
    const verify = await supabase.auth.signInWithPassword({
        email: req.user.email,
        password: current_password,
    });
    if (verify.error) {
        return res.status(401).json({ error: 'Palavra-passe atual incorreta.' });
    }

    const { error } = await admin.auth.admin.updateUserById(req.user.id, { password: new_password });
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ message: 'Palavra-passe alterada.' });
});

// DELETE /api/auth/account - elimina a conta do utilizador e os seus dados.
// Requer SUPABASE_SERVICE_KEY no .env (chave service_role).
router.delete('/account', requireAuth, async (req, res) => {
    const admin = getAdminClient();
    if (!admin) return res.status(500).json({ error: 'Funcionalidade não configurada no servidor (SUPABASE_SERVICE_KEY em falta).' });

    const userId = req.user.id;

    // 1) Apagar dados de tabelas custom. Ignorar erros de "tabela não existe" (42P01)
    //    porque tabelas opcionais como orders podem não estar criadas ainda.
    const tablesToClean = ['cart_items', 'favorites', 'orders'];
    for (const table of tablesToClean) {
        try {
            const { error } = await admin.from(table).delete().eq('user_id', userId);
            if (error && error.code !== '42P01') {
                console.error(`[auth] delete account: erro a limpar ${table}:`, error.message, error.code);
            }
        } catch (e) {
            console.error(`[auth] delete account: exceção a limpar ${table}:`, e.message);
        }
    }

    // 2) Eliminar o user do auth. Soft delete (segundo param=true) marca como
    //    deleted_at sem remover hard - evita erros de FK em tabelas internas
    //    do Supabase (auth.identities, auth.audit_log_entries, etc).
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
        console.error('[auth] admin.deleteUser falhou:', {
            message: error.message,
            code: error.code,
            status: error.status,
            userId,
        });

        // Tentar soft delete como fallback - útil quando há FKs internas que bloqueiam hard delete
        const { error: softErr } = await admin.auth.admin.deleteUser(userId, true);
        if (softErr) {
            console.error('[auth] soft delete também falhou:', softErr.message);
            return res.status(500).json({
                error: 'Não foi possível eliminar a conta. Detalhes: ' + (error.message || 'erro desconhecido'),
            });
        }
        return res.json({ message: 'Conta eliminada.' });
    }

    return res.json({ message: 'Conta eliminada.' });
});

module.exports = router;
