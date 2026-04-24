/**
 * ui-layout.js — injeta header e footer unificados em qualquer página que
 * tenha um <div id="es-header-slot"></div> e/ou <div id="es-footer-slot"></div>.
 *
 * Executa imediatamente (não espera DOMContentLoaded) para evitar flashes.
 */

(function () {
    'use strict';

    const currentPage = (window.location.pathname.split('/').pop() || 'index.html').replace(/\?.*$/, '');

    const navLinks = [
        { href: 'index.html',                      label: 'Início' },
        { href: 'product.html',                    label: 'Todos os Produtos' },
        { href: 'product.html?cat=eletrodomesticos', label: 'Eletrodomésticos' },
        { href: 'product.html?cat=informatica',    label: 'Informática' },
        { href: 'product.html?cat=smartphones',    label: 'Smartphones' },
        { href: 'product.html?cat=imagem',         label: 'Imagem e Som' },
        { href: 'product.html?cat=jogos',          label: 'Gaming' },
    ];

    function buildHeader() {
        const navHtml = navLinks.map(l => {
            const active = l.href.split('#')[0] === currentPage ? ' active' : '';
            return `<a href="${l.href}" class="${active.trim()}">${l.label}</a>`;
        }).join('');

        return `
        <header class="es-header">
            <div class="es-header-inner">
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
                    <div class="col-lg-4 col-md-6">
                        <img src="images/logo3.png" alt="EletroSync" style="height:44px;margin-bottom:16px;filter:brightness(0) invert(1);">
                        <p style="max-width:320px;">A tua plataforma de comparação de preços em Portugal. Encontra as melhores ofertas em eletrodomésticos, informática e muito mais.</p>
                        <ul class="es-footer-social">
                            <li><a href="#" aria-label="Facebook"><i class="fa-brands fa-facebook-f"></i></a></li>
                            <li><a href="#" aria-label="Instagram"><i class="fa-brands fa-instagram"></i></a></li>
                            <li><a href="#" aria-label="YouTube"><i class="fa-brands fa-youtube"></i></a></li>
                        </ul>
                    </div>

                    <div class="col-lg-2 col-md-6 col-6">
                        <h5>Sobre</h5>
                        <ul>
                            <li><a href="#">Sobre nós</a></li>
                            <li><a href="#">Condições</a></li>
                            <li><a href="#">Trabalhar connosco</a></li>
                            <li><a href="#">Parcerias</a></li>
                        </ul>
                    </div>

                    <div class="col-lg-3 col-md-6 col-6">
                        <h5>Apoio ao Cliente</h5>
                        <ul>
                            <li><a href="#">FAQ</a></li>
                            <li><a href="#">Contactos</a></li>
                            <li><a href="#">Política de Privacidade</a></li>
                            <li><a href="#">Devoluções</a></li>
                        </ul>
                    </div>

                    <div class="col-lg-3 col-md-6">
                        <h5>Parcerias</h5>
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

    // Injeção imediata (antes do DOMContentLoaded) quando possível
    function inject() {
        const headerSlot = document.getElementById('es-header-slot');
        const footerSlot = document.getElementById('es-footer-slot');
        if (headerSlot) headerSlot.outerHTML = buildSvgSprite() + buildHeader();
        if (footerSlot) footerSlot.outerHTML = buildFooter();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();
