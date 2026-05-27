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

    const { data, error } = await supabase.auth.signUp({
        email, 
        password,
        options: { data: { full_name: name } }
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

// Middleware: valida o Bearer token e expõe req.user + req.userClient (com token)
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Falta o token de autenticação.' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Token inválido ou expirado.' });

    req.user = data.user;
    req.userToken = token;
    req.userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
    });
    next();
}

// PUT /api/auth/profile - atualiza nome (e/ou email - email exige confirmação)
router.put('/profile', requireAuth, async (req, res) => {
    const { name, email } = req.body || {};
    const updates = {};

    if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed.length < 2 || trimmed.length > 80) {
            return res.status(400).json({ error: 'Nome deve ter entre 2 e 80 caracteres.' });
        }
        updates.data = { full_name: trimmed };
    }

    if (typeof email === 'string') {
        const trimmed = email.trim();
        if (trimmed.length === 0 || trimmed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
            return res.status(400).json({ error: 'Email inválido.' });
        }
        if (trimmed !== req.user.email) {
            updates.email = trimmed;
        }
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Nada para atualizar.' });
    }

    const { data, error } = await req.userClient.auth.updateUser(updates);
    if (error) return res.status(400).json({ error: error.message });

    const emailChanged = !!updates.email;
    return res.json({
        message: emailChanged
            ? 'Pedido enviado. Confirma o novo email para concluir a alteração.'
            : 'Dados atualizados.',
        user: data.user,
    });
});

// POST /api/auth/change-password - altera a password do utilizador autenticado.
// Re-verifica a password antiga antes de aceitar (segurança).
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

    // Re-autenticar com a password atual para confirmar identidade
    const verify = await supabase.auth.signInWithPassword({
        email: req.user.email,
        password: current_password,
    });
    if (verify.error) {
        return res.status(401).json({ error: 'Palavra-passe atual incorreta.' });
    }

    const { error } = await req.userClient.auth.updateUser({ password: new_password });
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ message: 'Palavra-passe alterada.' });
});

// DELETE /api/auth/account - elimina a conta do utilizador e os seus dados.
// Requer SUPABASE_SERVICE_KEY no .env (chave service_role) para chamar admin.deleteUser.
router.delete('/account', requireAuth, async (req, res) => {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) {
        return res.status(500).json({ error: 'Funcionalidade não configurada no servidor.' });
    }

    const adminClient = createClient(process.env.SUPABASE_URL, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Apagar dados do utilizador (cart_items, favorites). As tabelas têm RLS pelo user_id,
    // mas com service_role passamos por cima. Cascade no SQL é uma alternativa mais limpa.
    try {
        await adminClient.from('cart_items').delete().eq('user_id', req.user.id);
        await adminClient.from('favorites').delete().eq('user_id', req.user.id);
    } catch (e) {
        console.error('[auth] delete account: erro a limpar dados:', e.message);
    }

    const { error } = await adminClient.auth.admin.deleteUser(req.user.id);
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ message: 'Conta eliminada.' });
});

module.exports = router;
