/**
 * favorites.js — API unificada para gestão de favoritos.
 *
 * Apenas funciona com sessão iniciada (dados ficam no Supabase).
 * Sem login, qualquer tentativa de adicionar/remover redireciona para o login.
 *
 * Todas as funções devolvem promises.
 */

(function () {
    'use strict';

    const LS_KEY = 'myFavorites';
    // Limpa lixo antigo do localStorage (de versões anteriores)
    try { localStorage.removeItem(LS_KEY); } catch {}

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

    // ── API pública (apenas com login — sem fallback localStorage) ─────────
    function redirectToLogin() {
        window.location.href = '/login.html';
    }

    async function getFavorites() {
        if (!isLoggedIn()) return [];
        try { return await apiGet(); }
        catch (e) { console.error('[favorites] erro:', e); return []; }
    }

    async function addFavorite(product) {
        if (!isLoggedIn()) { redirectToLogin(); return; }
        try { await apiAdd(product); }
        catch (e) { console.error('[favorites] add:', e); }
    }

    async function removeFavorite(productId) {
        if (!isLoggedIn()) return;
        try { await apiRemove(productId); }
        catch (e) { console.error('[favorites] remove:', e); }
    }

    async function isFavorite(productId) {
        if (!isLoggedIn()) return false;
        const list = await getFavorites();
        return list.some(p => p.name === productId);
    }

    function showAuthPopup() {
        let popup = document.getElementById('es-auth-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'es-auth-popup';
            popup.style.position = 'fixed';
            popup.style.top = '20px';
            popup.style.right = '20px';
            popup.style.backgroundColor = '#dc3545';
            popup.style.color = '#fff';
            popup.style.padding = '15px 20px';
            popup.style.borderRadius = '8px';
            popup.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            popup.style.zIndex = '9999';
            popup.style.fontWeight = '600';
            popup.style.transition = 'opacity 0.3s ease';
            popup.style.display = 'flex';
            popup.style.alignItems = 'center';
            popup.style.gap = '10px';
            popup.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Precisas de iniciar sessão para guardar favoritos.';
            document.body.appendChild(popup);
        }
        
        // Reflow e mostrar
        popup.style.opacity = '0';
        setTimeout(() => popup.style.opacity = '1', 10);
        
        setTimeout(() => {
            popup.style.opacity = '0';
            setTimeout(() => {
                if (popup.parentElement) popup.remove();
            }, 300);
        }, 3000);
    }

    // Exportar globalmente
    window.Favorites = { getFavorites, addFavorite, removeFavorite, isFavorite, isLoggedIn, showAuthPopup };
})();
