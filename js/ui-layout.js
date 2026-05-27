/**
 * ui-layout.js - injeta header e footer unificados em qualquer página que
 * tenha um <div id="es-header-slot"></div> e/ou <div id="es-footer-slot"></div>.
 *
 * Executa imediatamente (não espera DOMContentLoaded) para evitar flashes.
 */

// fetchWithTimeout global: aborta requests pendurados após `ms` (default 15s)
window.fetchWithTimeout = function (url, options = {}, ms = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(timer));
};

// Converte nome de produto em slug URL-friendly. Determinista, para servir como id.
// Ex: "iPhone 15 Pro Max 256GB" → "iphone-15-pro-max-256gb"
window.slugifyProductName = function (name) {
    if (!name) return '';
    return String(name).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
};

// Quando o user escreve uma palavra que é o nome de uma categoria (ou sinónimo)
// na barra de pesquisa, em vez de pesquisar produtos com essa palavra navegamos
// para a página da categoria. UX melhor: "gaming" mostra produtos gaming, não
// resultados do Serper com "gaming" no título.
const CATEGORY_KEYWORDS = {
    eletrodomesticos: ['eletrodomesticos', 'eletrodomestico', 'frigorifico', 'maquina', 'aspirador', 'cozinha', 'lavandaria'],
    informatica:      ['informatica', 'computador', 'computadores', 'portatil', 'portateis', 'pc', 'desktop', 'monitor', 'monitores', 'teclado', 'rato', 'impressora'],
    smartphones:      ['smartphone', 'smartphones', 'telemovel', 'telemoveis', 'iphone', 'samsung galaxy', 'wearable', 'wearables', 'smartwatch', 'apple watch'],
    imagem:           ['imagem', 'som', 'tv', 'televisao', 'televisao', 'soundbar', 'colunas', 'auscultadores', 'headphones'],
    gaming:           ['gaming', 'gamer', 'jogos', 'consola', 'consolas', 'playstation', 'ps5', 'xbox', 'nintendo'],
};

function categoryFromQuery(raw) {
    if (!raw) return null;
    const q = String(raw).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim();
    if (q.length < 2) return null;
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(k => k === q)) return cat;
    }
    return null;
}

// Intercepta qualquer formulário de pesquisa: se a query for o nome de uma
// categoria, redireciona para product.html?cat=X em vez de ?query=X.
document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || form.getAttribute('role') !== 'search') return;
    const input = form.querySelector('input[name="query"]');
    if (!input) return;
    const cat = categoryFromQuery(input.value);
    if (cat) {
        e.preventDefault();
        window.location.href = `product.html?cat=${cat}`;
    }
}, true);

// =============================================================================
// AUTOCOMPLETE NA PESQUISA - dropdown com produtos enquanto o user escreve
// =============================================================================
// Usa /api/products/all (cacheado no servidor) - não consome créditos Serper extra.
// Carrega a lista uma vez por sessão e filtra client-side.
(function () {
    'use strict';
    const MIN_CHARS = 2;
    const MAX_RESULTS = 6;
    const DEBOUNCE_MS = 180;

    let catalogPromise = null;
    function loadCatalog() {
        if (catalogPromise) return catalogPromise;
        catalogPromise = (window.fetchWithTimeout || fetch)('/api/products/all', {}, 10000)
            .then(r => r.ok ? r.json() : { products: [] })
            .then(d => Array.isArray(d.products) ? d.products : [])
            .catch(() => []);
        return catalogPromise;
    }

    function normalize(s) {
        return String(s || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function attachAutocomplete(input) {
        if (!input || input.dataset.esAutocomplete) return;
        input.dataset.esAutocomplete = '1';
        input.setAttribute('autocomplete', 'off');

        const wrap = document.createElement('div');
        wrap.className = 'es-autocomplete';
        wrap.style.cssText = 'position:absolute;background:#fff;border:1px solid var(--es-gray-200);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.12);max-height:380px;overflow-y:auto;z-index:1100;display:none;min-width:280px;';
        document.body.appendChild(wrap);

        let timer = null;
        let active = -1;
        let lastResults = [];

        function position() {
            const r = input.getBoundingClientRect();
            wrap.style.top   = (window.scrollY + r.bottom + 6) + 'px';
            wrap.style.left  = (window.scrollX + r.left) + 'px';
            wrap.style.width = Math.max(r.width, 280) + 'px';
        }

        function close() {
            wrap.style.display = 'none';
            active = -1;
        }

        function highlight() {
            wrap.querySelectorAll('.es-ac-item').forEach((el, i) => {
                el.style.background = i === active ? 'var(--es-gray-50)' : '';
            });
        }

        function render(results, query) {
            lastResults = results;
            if (results.length === 0) {
                wrap.innerHTML = `<div style="padding:14px 16px;color:var(--es-text-muted);font-size:.875rem;">Sem sugestões para "${escapeHtml(query)}"</div>`;
                position();
                wrap.style.display = 'block';
                return;
            }
            const safeQ = escapeHtml(query);
            wrap.innerHTML = results.map((p, i) => {
                const safeName = escapeHtml(p.name);
                const price = p.minPrice ? `<span style="color:var(--es-primary);font-weight:700;white-space:nowrap;">${parseFloat(p.minPrice).toFixed(2)}€</span>` : '';
                const img = p.image ? `<img src="${escapeHtml(p.image)}" alt="" style="width:40px;height:40px;object-fit:contain;flex-shrink:0;border-radius:6px;background:var(--es-gray-50);" loading="lazy">` : '';
                return `
                    <a href="#" class="es-ac-item" data-idx="${i}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;text-decoration:none;color:var(--es-text);border-bottom:1px solid var(--es-gray-100);">
                        ${img}
                        <span style="flex:1;font-size:.875rem;line-height:1.25;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${safeName}</span>
                        ${price}
                    </a>
                `;
            }).join('') + `
                <a href="product.html?query=${encodeURIComponent(query)}" style="display:block;padding:10px 14px;text-align:center;color:var(--es-primary);font-weight:600;font-size:.875rem;text-decoration:none;background:var(--es-gray-50);">
                    Ver todos os resultados para "${safeQ}"
                </a>
            `;
            position();
            wrap.style.display = 'block';
        }

        async function search(query) {
            const q = normalize(query).trim();
            if (q.length < MIN_CHARS) { close(); return; }

            const all = await loadCatalog();
            // Match: começa por... ou inclui o termo
            const tokens = q.split(/\s+/);
            const results = all.filter(p => {
                const n = normalize(p.name);
                return tokens.every(t => n.includes(t));
            }).slice(0, MAX_RESULTS);

            render(results, query);
        }

        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => search(input.value), DEBOUNCE_MS);
        });

        input.addEventListener('focus', () => {
            if (input.value.trim().length >= MIN_CHARS) search(input.value);
        });

        input.addEventListener('blur', () => {
            // Pequeno delay para permitir click nas sugestões
            setTimeout(close, 180);
        });

        input.addEventListener('keydown', (e) => {
            if (wrap.style.display !== 'block') return;
            const items = wrap.querySelectorAll('.es-ac-item');
            if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); highlight(); }
            else if (e.key === 'ArrowUp')   { e.preventDefault(); active = Math.max(active - 1, -1); highlight(); }
            else if (e.key === 'Enter' && active >= 0 && lastResults[active]) {
                e.preventDefault();
                navigateToProduct(lastResults[active]);
            } else if (e.key === 'Escape') {
                close();
            }
        });

        wrap.addEventListener('click', (e) => {
            const item = e.target.closest('.es-ac-item');
            if (!item) return;
            e.preventDefault();
            const idx = parseInt(item.dataset.idx, 10);
            if (lastResults[idx]) navigateToProduct(lastResults[idx]);
        });

        window.addEventListener('scroll', position, { passive: true });
        window.addEventListener('resize', position);
    }

    function navigateToProduct(product) {
        try { localStorage.setItem('selectedProduct', JSON.stringify(product)); } catch {}
        const slug = window.slugifyProductName ? window.slugifyProductName(product.name) : '';
        window.location.href = slug ? `single-product.html?p=${slug}` : 'single-product.html';
    }

    function init() {
        document.querySelectorAll('form[role="search"] input[name="query"]').forEach(attachAutocomplete);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    // Re-attach quando o ui-layout injeta o header dinamicamente
    setTimeout(init, 100);
    setTimeout(init, 500);
})();

// window.Toast - notificações empilhadas no canto inferior direito.
// Uso: Toast.success('Adicionado!'), Toast.error('Falhou'), Toast.info('...')
(function () {
    const ICONS = {
        success: 'fa-circle-check',
        error:   'fa-circle-exclamation',
        info:    'fa-circle-info',
    };
    const COLORS = {
        success: { bg: '#10b981', fg: '#fff' },
        error:   { bg: '#ef4444', fg: '#fff' },
        info:    { bg: '#1f2937', fg: '#fff' },
    };

    let container = null;
    function ensureContainer() {
        if (container && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.id = 'es-toast-container';
        Object.assign(container.style, {
            position: 'fixed',
            right: '20px',
            bottom: '20px',
            zIndex: '9999',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            pointerEvents: 'none',
            maxWidth: 'calc(100vw - 40px)',
        });
        document.body.appendChild(container);
        return container;
    }

    function show(message, type = 'info', durationMs = 3200) {
        if (!message) return;
        const wrapper = ensureContainer();
        const toast = document.createElement('div');
        const c = COLORS[type] || COLORS.info;
        const icon = ICONS[type] || ICONS.info;
        Object.assign(toast.style, {
            background: c.bg,
            color: c.fg,
            padding: '12px 16px',
            borderRadius: '10px',
            boxShadow: '0 6px 20px rgba(0,0,0,.18)',
            fontSize: '14px',
            fontWeight: '500',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            minWidth: '220px',
            maxWidth: '360px',
            opacity: '0',
            transform: 'translateY(8px)',
            transition: 'opacity .25s ease, transform .25s ease',
            pointerEvents: 'auto',
        });
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span></span>`;
        toast.querySelector('span').textContent = String(message);
        wrapper.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        const remove = () => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(() => toast.remove(), 250);
        };
        toast.addEventListener('click', remove);
        setTimeout(remove, durationMs);
    }

    window.Toast = {
        show,
        success: (msg, ms) => show(msg, 'success', ms),
        error:   (msg, ms) => show(msg, 'error', ms),
        info:    (msg, ms) => show(msg, 'info', ms),
    };
})();

(function () {
    'use strict';

    const currentPage = (window.location.pathname.split('/').pop() || 'index.html').replace(/\?.*$/, '');
    const currentCat = new URLSearchParams(window.location.search).get('cat') || '';

    const navLinks = [
        { href: 'index.html',                        label: 'Início',              page: 'index.html',   cat: null },
        { href: 'product.html',                      label: 'Todos os Produtos',   page: 'product.html', cat: '' },
        { href: 'product.html?cat=eletrodomesticos', label: 'Eletrodomésticos',    page: 'product.html', cat: 'eletrodomesticos' },
        { href: 'product.html?cat=informatica',      label: 'Informática',         page: 'product.html', cat: 'informatica' },
        { href: 'product.html?cat=smartphones',      label: 'Smartphones',         page: 'product.html', cat: 'smartphones' },
        { href: 'product.html?cat=imagem',           label: 'Imagem e Som',        page: 'product.html', cat: 'imagem' },
        { href: 'product.html?cat=gaming',           label: 'Gaming',              page: 'product.html', cat: 'gaming' },
    ];

    function buildHeader() {
        const navHtml = navLinks.map(l => {
            let isActive = false;
            if (l.cat === null) {
                isActive = l.page === currentPage;
            } else {
                isActive = l.page === currentPage && l.cat === currentCat;
            }
            return `<a href="${l.href}" class="${isActive ? 'active' : ''}">${l.label}</a>`;
        }).join('');

        return `
        <header class="es-header">
            <div class="es-header-inner">
                <button type="button" class="es-header-burger" id="esHeaderBurger"
                        aria-label="Abrir menu" aria-expanded="false" aria-controls="esMobileNav">
                    <span></span><span></span><span></span>
                </button>

                <a href="index.html" class="es-header-logo">
                    <img src="images/logo3.png" alt="EletroSync">
                </a>

                <div class="es-header-search">
                    <form class="es-search-wrap" action="product.html" method="GET" role="search">
                        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="currentColor" d="M21.71 20.29L18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a1 1 0 0 0 1.42 0a1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 7-7a7 7 0 0 1-7 7Z"/>
                        </svg>
                        <input type="text" name="query" placeholder="O que procuras?" aria-label="Pesquisar produtos">
                    </form>
                </div>

                <div class="es-header-actions">
                    <a href="favorites.html" class="es-header-action" aria-label="Favoritos" title="Favoritos">
                        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="currentColor" d="M20.16 4.61A6.27 6.27 0 0 0 12 4a6.27 6.27 0 0 0-8.16 9.48l7.45 7.45a1 1 0 0 0 1.42 0l7.45-7.45a6.27 6.27 0 0 0 0-8.87Zm-1.41 7.46L12 18.81l-6.75-6.74a4.28 4.28 0 0 1 3-7.3a4.25 4.25 0 0 1 3 1.25a1 1 0 0 0 1.42 0a4.27 4.27 0 0 1 6 6.05Z"/>
                        </svg>
                    </a>

                    <a href="profile.html" class="es-header-action es-header-profile-link" aria-label="Perfil" title="Perfil">
                        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="currentColor" d="M15.71 12.71a6 6 0 1 0-7.42 0a10 10 0 0 0-6.22 8.18a1 1 0 0 0 2 .22a8 8 0 0 1 15.9 0a1 1 0 0 0 1 .89h.11a1 1 0 0 0 .88-1.1a10 10 0 0 0-6.25-8.19ZM12 12a4 4 0 1 1 4-4a4 4 0 0 1-4 4Z"/>
                        </svg>
                    </a>

                    <a href="#" class="es-header-action" data-bs-toggle="offcanvas" data-bs-target="#offcanvasCart" aria-controls="offcanvasCart" aria-label="Carrinho" title="Carrinho">
                        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="currentColor" d="M8.5 19a1.5 1.5 0 1 0 1.5 1.5A1.5 1.5 0 0 0 8.5 19ZM19 16H7a1 1 0 0 1 0-2h8.491a3.013 3.013 0 0 0 2.885-2.176l1.585-5.55A1 1 0 0 0 19 5H6.74a3.007 3.007 0 0 0-2.82-2H3a1 1 0 0 0 0 2h.921a1.005 1.005 0 0 1 .962.725l.155.545v.005l1.641 5.742A3 3 0 0 0 7 18h12a1 1 0 0 0 0-2Zm-1.326-9l-1.22 4.274a1.005 1.005 0 0 1-.963.726H8.754l-.255-.892L7.326 7ZM16.5 19a1.5 1.5 0 1 0 1.5 1.5a1.5 1.5 0 0 0-1.5-1.5Z"/>
                        </svg>
                        <span class="es-header-badge cart-badge">0</span>
                    </a>
                </div>
            </div>

            <nav class="es-header-nav" aria-label="Categorias">
                <div class="es-header-nav-inner">
                    ${navHtml}
                </div>
            </nav>

            <div class="es-mobile-nav" id="esMobileNav" aria-hidden="true">
                <form class="es-mobile-nav-search" action="product.html" method="GET" role="search">
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M21.71 20.29L18 16.61A9 9 0 1 0 16.61 18l3.68 3.68a1 1 0 0 0 1.42 0a1 1 0 0 0 0-1.39ZM11 18a7 7 0 1 1 7-7a7 7 0 0 1-7 7Z"/>
                    </svg>
                    <input type="text" name="query" placeholder="O que procuras?" aria-label="Pesquisar produtos">
                </form>
                ${navHtml}
            </div>
            <div class="es-mobile-nav-backdrop" id="esMobileNavBackdrop"></div>
        </header>

        <!-- Offcanvas do carrinho (preenchido por cart.js) -->
        <div class="offcanvas offcanvas-end" data-bs-scroll="true" tabindex="-1" id="offcanvasCart" aria-labelledby="offcanvasCartLabel">
            <div class="offcanvas-header">
                <h5 class="offcanvas-title mb-0" id="offcanvasCartLabel">O meu carrinho</h5>
                <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Fechar"></button>
            </div>
            <div class="offcanvas-body"></div>
        </div>
        `;
    }

    function buildFooter() {
        return `
        <footer class="es-footer">
            <div class="container">
                <div class="row g-5">
                    <div class="col-lg-6 col-md-6">
                        <div class="es-footer-brand" style="font-family: var(--es-font-heading); font-size: 1.5rem; font-weight: 800; color: #fff; margin-bottom: 12px; letter-spacing: -0.02em;">
                            ELETRO<span style="color: var(--es-primary);">SYNC</span>
                        </div>
                        <p style="max-width:380px;">A tua plataforma de comparação de preços em Portugal. Encontra as melhores ofertas em eletrodomésticos, informática, smartphones, gaming e muito mais.</p>
                    </div>

                    <div class="col-lg-3 col-md-3 col-sm-6">
                        <h5>Navegação</h5>
                        <ul>
                            <li><a href="index.html">Início</a></li>
                            <li><a href="product.html">Todos os produtos</a></li>
                            <li><a href="favorites.html">Favoritos</a></li>
                            <li><a href="profile.html">A minha conta</a></li>
                        </ul>
                    </div>

                    <div class="col-lg-3 col-md-3 col-sm-6">
                        <h5>Lojas parceiras</h5>
                        <ul>
                            <li><span>Worten</span></li>
                            <li><span>Fnac</span></li>
                            <li><span>Rádio Popular</span></li>
                            <li><span>PC Diga</span></li>
                        </ul>
                    </div>
                </div>

                <div class="es-footer-bottom">
                    <p class="m-0">© 2026 EletroSync. Todos os direitos reservados.</p>
                </div>
            </div>
        </footer>
        `;
    }

    function buildSvgSprite() {
        // Symbols usados pelos cards de produto (products.js / single-product.js)
        return `
        <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
            <defs>
                <symbol id="heart" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M20.16 4.61A6.27 6.27 0 0 0 12 4a6.27 6.27 0 0 0-8.16 9.48l7.45 7.45a1 1 0 0 0 1.42 0l7.45-7.45a6.27 6.27 0 0 0 0-8.87Zm-1.41 7.46L12 18.81l-6.75-6.74a4.28 4.28 0 0 1 3-7.3a4.25 4.25 0 0 1 3 1.25a1 1 0 0 0 1.42 0a4.27 4.27 0 0 1 6 6.05Z"/>
                </symbol>
                <symbol id="star-solid" viewBox="0 0 15 15">
                    <path fill="currentColor" d="M7.953 3.788a.5.5 0 0 0-.906 0L6.08 5.85l-2.154.33a.5.5 0 0 0-.283.843l1.574 1.613l-.373 2.284a.5.5 0 0 0 .736.518l1.92-1.063l1.921 1.063a.5.5 0 0 0 .736-.519l-.373-2.283l1.574-1.613a.5.5 0 0 0-.283-.844L8.921 5.85l-.968-2.062Z"/>
                </symbol>
                <symbol id="star-outline" viewBox="0 0 15 15">
                    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M7.5 9.804L5.337 11l.413-2.533L4 6.674l2.418-.37L7.5 4l1.082 2.304l2.418.37l-1.75 1.793L9.663 11L7.5 9.804Z"/>
                </symbol>
                <symbol id="arrow-right" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M17.92 11.62a1 1 0 0 0-.21-.33l-5-5a1 1 0 0 0-1.42 1.42l3.3 3.29H7a1 1 0 0 0 0 2h7.59l-3.3 3.29a1 1 0 0 0 0 1.42a1 1 0 0 0 1.42 0l5-5a1 1 0 0 0 .21-.33a1 1 0 0 0 0-.76Z"/>
                </symbol>
            </defs>
        </svg>
        `;
    }

    function wireMobileNav() {
        const burger   = document.getElementById('esHeaderBurger');
        const nav      = document.getElementById('esMobileNav');
        const backdrop = document.getElementById('esMobileNavBackdrop');
        if (!burger || !nav || !backdrop) return;

        function setOpen(open) {
            burger.setAttribute('aria-expanded', String(open));
            nav.setAttribute('aria-hidden', String(!open));
            document.body.classList.toggle('es-mobile-nav-active', open);
        }

        burger.addEventListener('click', () => {
            const isOpen = burger.getAttribute('aria-expanded') === 'true';
            setOpen(!isOpen);
        });

        backdrop.addEventListener('click', () => setOpen(false));

        // Fecha o menu ao escolher uma categoria ou ao submeter pesquisa
        nav.addEventListener('click', (e) => {
            if (e.target.closest('a')) setOpen(false);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') {
                setOpen(false);
                burger.focus();
            }
        });
    }

    // Injeção imediata (antes do DOMContentLoaded) quando possível
    function inject() {
        const headerSlot = document.getElementById('es-header-slot');
        const footerSlot = document.getElementById('es-footer-slot');
        if (headerSlot) headerSlot.outerHTML = buildSvgSprite() + buildHeader();
        if (footerSlot) footerSlot.outerHTML = buildFooter();
        wireMobileNav();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();
