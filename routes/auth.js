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

module.exports = router;
