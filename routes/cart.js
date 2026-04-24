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

// GET /api/cart — lista todos os itens do carrinho do utilizador
router.get('/', requireAuth, async (req, res) => {
    const { data, error } = await req.supabase
        .from('cart_items')
        .select('product_id, product_data, quantity, created_at')
        .order('created_at', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const items = data.map(row => ({ ...row.product_data, quantity: row.quantity }));
    return res.json({ items });
});

// POST /api/cart — adiciona um produto (ou incrementa quantidade se já existir)
router.post('/', requireAuth, async (req, res) => {
    const { product, quantity = 1 } = req.body;

    if (!product || !product.name) {
        return res.status(400).json({ error: 'Produto inválido — campo "name" em falta.' });
    }

    // Tenta inserir. Se já existir (unique violation), incrementa a quantidade.
    const { error: insertError } = await req.supabase
        .from('cart_items')
        .insert({
            user_id: req.user.id,
            product_id: product.name,
            product_data: product,
            quantity
        });

    if (insertError) {
        if (insertError.code === '23505') {
            // Já existe → busca quantidade atual e incrementa
            const { data: existing, error: selErr } = await req.supabase
                .from('cart_items')
                .select('quantity')
                .eq('product_id', product.name)
                .single();

            if (selErr) return res.status(500).json({ error: selErr.message });

            const { error: updErr } = await req.supabase
                .from('cart_items')
                .update({ quantity: (existing.quantity || 0) + quantity })
                .eq('product_id', product.name);

            if (updErr) return res.status(500).json({ error: updErr.message });
            return res.json({ message: 'Quantidade atualizada.' });
        }
        return res.status(500).json({ error: insertError.message });
    }

    return res.json({ message: 'Produto adicionado ao carrinho.' });
});

// PUT /api/cart/:product_id — atualiza a quantidade de um produto (remove se <= 0)
router.put('/:product_id', requireAuth, async (req, res) => {
    const productId = decodeURIComponent(req.params.product_id);
    const { quantity } = req.body;

    if (typeof quantity !== 'number' || isNaN(quantity)) {
        return res.status(400).json({ error: 'Quantidade inválida.' });
    }

    if (quantity <= 0) {
        const { error } = await req.supabase
            .from('cart_items')
            .delete()
            .eq('product_id', productId);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ message: 'Produto removido do carrinho.' });
    }

    const { error } = await req.supabase
        .from('cart_items')
        .update({ quantity })
        .eq('product_id', productId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ message: 'Quantidade atualizada.' });
});

// DELETE /api/cart/:product_id — remove um item do carrinho
router.delete('/:product_id', requireAuth, async (req, res) => {
    const productId = decodeURIComponent(req.params.product_id);

    const { error } = await req.supabase
        .from('cart_items')
        .delete()
        .eq('product_id', productId);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ message: 'Produto removido do carrinho.' });
});

// DELETE /api/cart — limpa o carrinho todo
router.delete('/', requireAuth, async (req, res) => {
    const { error } = await req.supabase
        .from('cart_items')
        .delete()
        .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ message: 'Carrinho limpo.' });
});

module.exports = router;
