const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
});

// Middleware idêntico ao de cart.js / favorites.js
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Falta o token de autenticação.' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Token inválido ou expirado.' });

    req.user = data.user;
    req.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
    });
    next();
}

function isPositiveNumber(n) {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

// Valida e normaliza shipping_info. Devolve { ok, info, error }.
function validateShipping(input) {
    if (!input || typeof input !== 'object') return { ok: false, error: 'Dados de envio em falta.' };
    const { full_name, address, city, postal_code, country, phone, email } = input;

    if (typeof full_name !== 'string' || full_name.trim().length < 2 || full_name.length > 80) {
        return { ok: false, error: 'Nome inválido.' };
    }
    if (typeof address !== 'string' || address.trim().length < 4 || address.length > 200) {
        return { ok: false, error: 'Morada inválida.' };
    }
    if (typeof city !== 'string' || city.trim().length < 2 || city.length > 80) {
        return { ok: false, error: 'Cidade inválida.' };
    }
    if (typeof postal_code !== 'string' || !/^\d{4}-\d{3}$/.test(postal_code.trim())) {
        return { ok: false, error: 'Código postal inválido (formato 0000-000).' };
    }
    if (typeof country !== 'string' || country.length > 80) {
        return { ok: false, error: 'País inválido.' };
    }
    if (phone && (typeof phone !== 'string' || phone.length > 30)) {
        return { ok: false, error: 'Telefone inválido.' };
    }
    if (email && (typeof email !== 'string' || email.length > 254)) {
        return { ok: false, error: 'Email inválido.' };
    }

    return {
        ok: true,
        info: {
            full_name: full_name.trim(),
            address: address.trim(),
            city: city.trim(),
            postal_code: postal_code.trim(),
            country: country.trim() || 'Portugal',
            phone: phone ? String(phone).trim() : null,
            email: email ? String(email).trim() : null,
        }
    };
}

// GET /api/orders - lista os pedidos do utilizador (mais recentes primeiro)
router.get('/', requireAuth, async (req, res) => {
    const { data, error } = await req.supabase
        .from('orders')
        .select('id, status, items, total, shipping_info, created_at')
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ orders: data || [] });
});

// GET /api/orders/:id - detalhe de um pedido
router.get('/:id', requireAuth, async (req, res) => {
    const orderId = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
        return res.status(400).json({ error: 'Id de pedido inválido.' });
    }

    const { data, error } = await req.supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return res.status(404).json({ error: 'Pedido não encontrado.' });
        return res.status(500).json({ error: error.message });
    }
    return res.json({ order: data });
});

// POST /api/orders - cria um pedido a partir dos items recebidos + shipping info.
// Limpa o carrinho do utilizador após o sucesso.
router.post('/', requireAuth, async (req, res) => {
    const { items, total, shipping } = req.body || {};

    // Validar items
    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'O carrinho está vazio.' });
    }
    if (items.length > 50) {
        return res.status(400).json({ error: 'Demasiados items no pedido (máx. 50).' });
    }
    for (const it of items) {
        if (!it || typeof it !== 'object') return res.status(400).json({ error: 'Item inválido.' });
        if (typeof it.name !== 'string' || it.name.length > 500) return res.status(400).json({ error: 'Nome de item inválido.' });
        if (!isPositiveNumber(Number(it.price))) return res.status(400).json({ error: 'Preço de item inválido.' });
        if (!isPositiveNumber(Number(it.quantity)) || Number(it.quantity) < 1) return res.status(400).json({ error: 'Quantidade inválida.' });
    }

    // Validar total
    if (!isPositiveNumber(Number(total))) {
        return res.status(400).json({ error: 'Total inválido.' });
    }

    // Validar shipping
    const v = validateShipping(shipping);
    if (!v.ok) return res.status(400).json({ error: v.error });

    // Snapshot mínimo dos items (não guardar lojas inteiras)
    const itemsSnapshot = items.map(it => ({
        name: String(it.name),
        price: Number(it.price),
        quantity: Number(it.quantity),
        store: it.store ? String(it.store).slice(0, 80) : null,
        image: it.image ? String(it.image).slice(0, 500) : null,
    }));

    const { data, error } = await req.supabase
        .from('orders')
        .insert({
            user_id: req.user.id,
            status: 'completed',
            items: itemsSnapshot,
            total: Number(total).toFixed(2),
            shipping_info: v.info,
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    // Limpar o carrinho do utilizador após pedido criado
    await req.supabase.from('cart_items').delete().eq('user_id', req.user.id);

    return res.json({ message: 'Pedido criado.', order: data });
});

module.exports = router;
