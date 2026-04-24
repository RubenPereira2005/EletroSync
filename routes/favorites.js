const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
});

// Middleware: valida o token Supabase do header Authorization e coloca o user em req.user
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Falta o token de autenticação.' });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    req.user = data.user;
    req.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
    });
    next();
}

// GET /api/favorites — lista os favoritos do utilizador autenticado
router.get('/', requireAuth, async (req, res) => {
    const { data, error } = await req.supabase
        .from('favorites')
        .select('product_id, product_data, created_at')
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const favorites = data.map(row => row.product_data);
    return res.json({ favorites });
});

// POST /api/favorites — adiciona um produto aos favoritos
router.post('/', requireAuth, async (req, res) => {
    const product = req.body;

    if (!product || !product.name) {
        return res.status(400).json({ error: 'Produto inválido — campo "name" em falta.' });
    }

    const { error } = await req.supabase
        .from('favorites')
        .insert({
            user_id: req.user.id,
            product_id: product.name,
            product_data: product
        });

    if (error) {
        // Código 23505 = unique violation (já existe nos favoritos)
        if (error.code === '23505') {
            return res.json({ message: 'Produto já estava nos favoritos.' });
        }
        return res.status(500).json({ error: error.message });
    }

    return res.json({ message: 'Favorito adicionado.' });
});

// DELETE /api/favorites/:product_id — remove um favorito
router.delete('/:product_id', requireAuth, async (req, res) => {
    const productId = decodeURIComponent(req.params.product_id);

    const { error } = await req.supabase
        .from('favorites')
        .delete()
        .eq('product_id', productId);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ message: 'Favorito removido.' });
});

module.exports = router;
