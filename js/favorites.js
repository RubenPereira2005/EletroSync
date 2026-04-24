/**
 * favorites.js — API unificada para gestão de favoritos.
 *
 * Quando o utilizador está autenticado, usa a API Node + Supabase.
 * Quando não está, cai para localStorage (para não perder a UX).
 *
 * Todas as funções devolvem promises.
 */

(function () {
    'use strict';

    const LS_KEY = 'myFavorites';

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
        const res = await fetch('/api/favorites', { headers: authHeaders() });
        if (!res.ok) throw new Error('Falha a carregar favoritos.');
        const data = await res.json();
        return data.favorites || [];
    }

    async function apiAdd(product) {
        const res = await fetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify(product)
        });
        if (!res.ok) throw new Error('Falha a adicionar favorito.');
    }

    async function apiRemove(productId) {
        const res = await fetch(`/api/favorites/${encodeURIComponent(productId)}`, {
            method: 'DELETE',
            headers: authHeaders()
        });
        if (!res.ok) throw new Error('Falha a remover favorito.');
    }

    // ── localStorage (fallback) ─────────────────────────────────────────────
    function lsGet() {
        try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
        catch { return []; }
    }

    function lsSet(list) {
        localStorage.setItem(LS_KEY, JSON.stringify(list));
    }

    // ── API pública ─────────────────────────────────────────────────────────
    async function getFavorites() {
        if (isLoggedIn()) {
            try { return await apiGet(); }
            catch (e) { console.error('[favorites] fallback para localStorage:', e); }
        }
        return lsGet();
    }

    async function addFavorite(product) {
        if (isLoggedIn()) {
            try { await apiAdd(product); return; }
            catch (e) { console.error('[favorites] fallback para localStorage:', e); }
        }
        const list = lsGet();
        if (!list.some(p => p.name === product.name)) {
            list.push(product);
            lsSet(list);
        }
    }

    async function removeFavorite(productId) {
        if (isLoggedIn()) {
            try { await apiRemove(productId); return; }
            catch (e) { console.error('[favorites] fallback para localStorage:', e); }
        }
        const list = lsGet().filter(p => p.name !== productId);
        lsSet(list);
    }

    async function isFavorite(productId) {
        const list = await getFavorites();
        return list.some(p => p.name === productId);
    }

    // Exportar globalmente
    window.Favorites = { getFavorites, addFavorite, removeFavorite, isFavorite, isLoggedIn };
})();
