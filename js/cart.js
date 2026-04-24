/**
 * cart.js — gestão do carrinho de compras.
 *
 * Quando o utilizador está autenticado, usa a API Node + Supabase.
 * Quando não está, cai para localStorage (para não perder a UX).
 *
 * Renderiza automaticamente o offcanvas (#offcanvasCart) e atualiza os
 * badges (.cart-badge) e totais (.cart-total) em qualquer página onde
 * este script esteja incluído.
 *
 * API pública (todas async): window.Cart = { add, remove, updateQuantity, clear, get, getCount, getTotal }
 */

(function () {
    'use strict';

    const LS_KEY = 'eletrosync_cart';

    // Cache em memória para evitar refetch a cada render sincrono (badges).
    let cache = [];

    // ── Autenticação ────────────────────────────────────────────────────────
    function getAccessToken() {
        const raw = sessionStorage.getItem('eletrosync_session') || localStorage.getItem('eletrosync_session');
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            const data = parsed.data || parsed;
            return data?.session?.access_token || null;
        } catch {
            return null;
        }
    }

    function isLoggedIn() {
        return !!getAccessToken();
    }

    function authHeaders() {
        return { 'Authorization': 'Bearer ' + getAccessToken() };
    }

    // ── Backend ─────────────────────────────────────────────────────────────
    async function apiGet() {
        const res = await fetch('/api/cart', { headers: authHeaders() });
        if (!res.ok) throw new Error('Falha a carregar carrinho.');
        const data = await res.json();
        return data.items || [];
    }

    async function apiAdd(product, quantity = 1) {
        const res = await fetch('/api/cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ product, quantity })
        });
        if (!res.ok) throw new Error('Falha a adicionar ao carrinho.');
    }

    async function apiUpdate(productId, quantity) {
        const res = await fetch(`/api/cart/${encodeURIComponent(productId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ quantity })
        });
        if (!res.ok) throw new Error('Falha a atualizar quantidade.');
    }

    async function apiRemove(productId) {
        const res = await fetch(`/api/cart/${encodeURIComponent(productId)}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (!res.ok) throw new Error('Falha a remover item.');
    }

    async function apiClear() {
        const res = await fetch('/api/cart', {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (!res.ok) throw new Error('Falha a limpar carrinho.');
    }

    // ── localStorage (fallback quando não autenticado) ─────────────────────
    function lsGet() {
        try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
        catch { return []; }
    }

    function lsSet(list) {
        localStorage.setItem(LS_KEY, JSON.stringify(list));
    }

    // ── Preços ──────────────────────────────────────────────────────────────
    function getUnitPrice(item) {
        if (typeof item.price === 'number') return item.price;
        if (typeof item.price === 'string') {
            const n = parseFloat(item.price);
            if (!isNaN(n)) return n;
        }
        if (item.minPrice != null) {
            const n = parseFloat(item.minPrice);
            if (!isNaN(n)) return n;
        }
        if (Array.isArray(item.shops) && item.shops.length) {
            const prices = item.shops.map(s => parseFloat(s.price)).filter(n => !isNaN(n));
            if (prices.length) return Math.min(...prices);
        }
        return 0;
    }

    function formatPrice(value) {
        return value.toFixed(2) + '€';
    }

    function computeTotal(items) {
        return items.reduce((sum, item) => sum + getUnitPrice(item) * (item.quantity || 1), 0);
    }

    function computeCount(items) {
        return items.reduce((sum, item) => sum + (item.quantity || 1), 0);
    }

    // ── Operações ───────────────────────────────────────────────────────────
    async function refresh() {
        if (isLoggedIn()) {
            try {
                cache = await apiGet();
            } catch (e) {
                console.error('[cart] fallback para localStorage:', e);
                cache = lsGet();
            }
        } else {
            cache = lsGet();
        }
        render();
        updateBadges();
    }

    async function addToCart(product, quantity = 1) {
        if (!product || !product.name) return;

        if (isLoggedIn()) {
            try { await apiAdd(product, quantity); }
            catch (e) { console.error('[cart] add fallback:', e); return localAdd(product, quantity); }
        } else {
            localAdd(product, quantity);
        }
        await refresh();
    }

    function localAdd(product, quantity) {
        const list = lsGet();
        const existing = list.find(i => i.name === product.name);
        if (existing) existing.quantity = (existing.quantity || 1) + quantity;
        else list.push({ ...product, quantity });
        lsSet(list);
    }

    async function removeFromCart(name) {
        if (isLoggedIn()) {
            try { await apiRemove(name); }
            catch (e) { console.error('[cart] remove fallback:', e); return localRemove(name); }
        } else {
            localRemove(name);
        }
        await refresh();
    }

    function localRemove(name) {
        lsSet(lsGet().filter(i => i.name !== name));
    }

    async function updateQuantity(name, quantity) {
        if (isLoggedIn()) {
            try { await apiUpdate(name, quantity); }
            catch (e) { console.error('[cart] update fallback:', e); return localUpdate(name, quantity); }
        } else {
            localUpdate(name, quantity);
        }
        await refresh();
    }

    function localUpdate(name, quantity) {
        const list = lsGet();
        const item = list.find(i => i.name === name);
        if (!item) return;
        if (quantity <= 0) lsSet(list.filter(i => i.name !== name));
        else { item.quantity = quantity; lsSet(list); }
    }

    async function clearCart() {
        if (isLoggedIn()) {
            try { await apiClear(); }
            catch (e) { console.error('[cart] clear fallback:', e); lsSet([]); }
        } else {
            lsSet([]);
        }
        await refresh();
    }

    // ── Melhor loja para o carrinho todo ────────────────────────────────────
    function computeBestStore(items) {
        if (!items.length) return null;

        const storeTotals = {};
        for (const item of items) {
            if (!Array.isArray(item.shops)) continue;
            const qty = item.quantity || 1;
            for (const shop of item.shops) {
                const price = parseFloat(shop.price);
                if (isNaN(price)) continue;
                storeTotals[shop.name] = (storeTotals[shop.name] || 0) + price * qty;
            }
        }

        const entries = Object.entries(storeTotals);
        if (!entries.length) return null;
        entries.sort((a, b) => a[1] - b[1]);
        return { best: entries[0], others: entries.slice(1) };
    }

    // ── Render ──────────────────────────────────────────────────────────────
    function render() {
        const body = document.querySelector('#offcanvasCart .offcanvas-body');
        if (!body) return;

        const items = cache;

        if (items.length === 0) {
            body.innerHTML = `
                <div class="order-md-last text-center py-5">
                    <svg width="64" height="64" viewBox="0 0 24 24" class="text-muted mb-3" style="opacity:.5">
                        <path fill="currentColor" d="M7 18a2 2 0 1 0 0 4a2 2 0 0 0 0-4m10 0a2 2 0 1 0 0 4a2 2 0 0 0 0-4M7.16 14l.03-.12l.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.86-7.01L19.42 3H5.21L4.27 1H1v2h2l3.6 7.59L5.25 13c-.16.28-.25.61-.25.96c0 1.1.9 2.04 2 2.04h12v-2H7.42c-.13 0-.25-.11-.26-.24Z"/>
                    </svg>
                    <h5 class="text-muted">O teu carrinho está vazio</h5>
                    <p class="text-muted small">Adiciona produtos para começares a comparar preços.</p>
                    <a href="product.html" class="btn btn-primary rounded-5 px-4 mt-2">Explorar Produtos</a>
                </div>
            `;
            return;
        }

        const itemsHtml = items.map(item => {
            const qty = item.quantity || 1;
            const unit = getUnitPrice(item);
            return `
                <li class="list-group-item lh-sm">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div class="flex-grow-1 pe-2">
                            <h6 class="my-0">${escapeHtml(item.name)}</h6>
                            <small class="text-body-secondary">${formatPrice(unit)} por unidade</small>
                        </div>
                        <span class="fw-bold">${formatPrice(unit * qty)}</span>
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="btn-group btn-group-sm" role="group">
                            <button type="button" class="btn btn-outline-secondary"
                                    data-cart-qty="-" data-cart-name="${encodeURIComponent(item.name)}">−</button>
                            <span class="btn btn-outline-secondary disabled" style="min-width:42px;">${qty}</span>
                            <button type="button" class="btn btn-outline-secondary"
                                    data-cart-qty="+" data-cart-name="${encodeURIComponent(item.name)}">+</button>
                        </div>
                        <button class="btn btn-sm btn-link text-danger p-0 text-decoration-none"
                                data-cart-remove="${encodeURIComponent(item.name)}">
                            <i class="fa-solid fa-trash-can"></i> Remover
                        </button>
                    </div>
                </li>
            `;
        }).join('');

        const total = computeTotal(items);
        const bestStore = computeBestStore(items);

        let bestStoreHtml = '';
        if (bestStore) {
            bestStoreHtml = `
                <div class="card mb-3 border-success">
                    <div class="card-body">
                        <h6 class="card-title text-success mb-1">Melhor opção (soma de todos os produtos)</h6>
                        <p class="mb-1"><strong>${escapeHtml(bestStore.best[0])}</strong></p>
                        <p class="mb-0 text-success">Total: ${formatPrice(bestStore.best[1])}</p>
                    </div>
                </div>
            `;
            if (bestStore.others.length) {
                bestStoreHtml += `
                    <div class="mb-3">
                        <small class="text-muted">Outras lojas:</small>
                        <ul class="list-group mt-2">
                            ${bestStore.others.map(([name, val]) => `
                                <li class="list-group-item d-flex justify-content-between py-2">
                                    <span>${escapeHtml(name)}</span>
                                    <span>${formatPrice(val)}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                `;
            }
        }

        body.innerHTML = `
            <div class="order-md-last">
                <h4 class="d-flex justify-content-between align-items-center mb-3">
                    <span class="text-primary">Carrinho</span>
                    <span class="badge bg-primary rounded-pill cart-badge">${computeCount(items)}</span>
                </h4>

                <ul class="list-group mb-3">
                    ${itemsHtml}
                    <li class="list-group-item d-flex justify-content-between bg-light">
                        <span class="fw-bold">Total (preço mínimo)</span>
                        <strong>${formatPrice(total)}</strong>
                    </li>
                </ul>

                ${bestStoreHtml}

                <button class="w-100 btn btn-outline-danger btn-sm" data-cart-clear>
                    <i class="fa-solid fa-trash-can me-1"></i> Limpar carrinho
                </button>
            </div>
        `;
    }

    function updateBadges() {
        const count = computeCount(cache);
        const total = computeTotal(cache);
        document.querySelectorAll('.cart-badge').forEach(el => { el.textContent = count; });
        document.querySelectorAll('.cart-total').forEach(el => { el.textContent = formatPrice(total); });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Event delegation para controlos dentro do offcanvas ────────────────
    function attachEvents() {
        document.addEventListener('click', async (e) => {
            const target = e.target.closest('[data-cart-remove], [data-cart-qty], [data-cart-clear]');
            if (!target) return;

            if (target.hasAttribute('data-cart-clear')) {
                if (confirm('Tens a certeza que queres limpar o carrinho?')) await clearCart();
                return;
            }

            const name = decodeURIComponent(target.getAttribute('data-cart-name') || target.getAttribute('data-cart-remove') || '');
            if (!name) return;

            if (target.hasAttribute('data-cart-remove')) {
                await removeFromCart(name);
            } else if (target.hasAttribute('data-cart-qty')) {
                const delta = target.getAttribute('data-cart-qty') === '+' ? 1 : -1;
                const item = cache.find(i => i.name === name);
                await updateQuantity(name, (item?.quantity || 1) + delta);
            }
        });
    }

    // ── API pública ────────────────────────────────────────────────────────
    window.Cart = {
        add: addToCart,
        remove: removeFromCart,
        updateQuantity,
        clear: clearCart,
        get: async () => { await refresh(); return cache; },
        getCount: () => computeCount(cache),
        getTotal: () => computeTotal(cache)
    };

    // ── Init ───────────────────────────────────────────────────────────────
    async function init() {
        attachEvents();
        await refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
