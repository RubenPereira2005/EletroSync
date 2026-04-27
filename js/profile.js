/**
 * profile.js — popula a página de perfil com dados reais:
 * - Dados pessoais do utilizador (via sessão guardada localmente + Supabase)
 * - Contadores dinâmicos (ex: número de favoritos via API)
 */

(function () {
    'use strict';

    // ── Sessão ──────────────────────────────────────────────────────────────
    function retrieveSession() {
        const raw = sessionStorage.getItem('eletrosync_session') || localStorage.getItem('eletrosync_session');
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            const data = parsed.data || parsed;
            return data || null;
        } catch {
            return null;
        }
    }

    function getAccessToken() {
        return retrieveSession()?.session?.access_token || null;
    }

    function authHeaders() {
        const token = getAccessToken();
        return token ? { 'Authorization': 'Bearer ' + token } : {};
    }

    // ── Formatação ──────────────────────────────────────────────────────────
    function formatDate(isoString) {
        if (!isoString) return '—';
        try {
            const d = new Date(isoString);
            if (isNaN(d.getTime())) return '—';
            return d.toLocaleDateString('pt-PT', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch {
            return '—';
        }
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value || '—';
    }

    // ── Popular dados pessoais ──────────────────────────────────────────────
    function populatePersonalData() {
        const session = retrieveSession();
        const user = session?.user;
        if (!user) return;

        const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || '—';

        setText('profile-data-name', fullName);
        setText('profile-data-email', user.email);
        setText('profile-data-created', formatDate(user.created_at));
        setText('profile-data-last-login', formatDate(user.last_sign_in_at));
    }

    // ── Contador de favoritos ───────────────────────────────────────────────
    async function populateFavoritesCount() {
        const countEl = document.getElementById('profile-favorites-count');
        if (!countEl) return;

        const token = getAccessToken();
        if (!token) {
            countEl.textContent = '0';
            return;
        }

        try {
            const res = await fetch('/api/favorites', { headers: authHeaders() });
            if (!res.ok) throw new Error('Falha na API');
            const data = await res.json();
            countEl.textContent = (data.favorites || []).length;
        } catch (e) {
            console.error('[profile] contador de favoritos:', e);
            countEl.textContent = '—';
        }
    }

    // ── Init ────────────────────────────────────────────────────────────────
    function init() {
        populatePersonalData();
        populateFavoritesCount();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
