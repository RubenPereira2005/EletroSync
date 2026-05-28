// Tenta resolver o produto a partir do URL (?p=slug) caso o localStorage não tenha
// um produto correspondente. Permite que partilhar/abrir o link funcione sem ter
// passado pela grid primeiro.
async function resolveProduct() {
    const urlSlug = new URLSearchParams(window.location.search).get('p');
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem('selectedProduct')); } catch {}

    // Match perfeito: localStorage tem produto e o slug bate certo com o URL
    if (stored && stored.name) {
        const storedSlug = window.slugifyProductName ? window.slugifyProductName(stored.name) : '';
        if (!urlSlug || storedSlug === urlSlug) return stored;
    }

    // URL tem slug mas localStorage está vazio ou desfasado: buscar /all e procurar
    if (urlSlug) {
        try {
            const res = await (window.fetchWithTimeout || fetch)('/api/products/all', {}, 10000);
            if (res.ok) {
                const data = await res.json();
                const slugify = window.slugifyProductName || (s => s);
                const match = (data.products || []).find(p => slugify(p.name) === urlSlug);
                if (match) {
                    localStorage.setItem('selectedProduct', JSON.stringify(match));
                    return match;
                }
            }
        } catch {}
    }

    return stored || null;
}

document.addEventListener("DOMContentLoaded", async () => {
    const data = await resolveProduct();
    if (!data) { window.location.href = 'index.html'; return; }

    // ── Metadata ────────────────────────────────────────────────────────────
    const CATEGORY_LABEL = {
        'eletrodomesticos': 'Eletrodomésticos',
        'informatica':      'Informática',
        'smartphones':      'Smartphones e Acessórios',
        'imagem-e-som':     'Imagem e Som',
        'gaming':           'Gaming',
    };

    const STORE_COLORS = {
        'Worten':        { dot: '#e20613', tag: 'worten' },
        'Fnac':          { dot: '#f5a623', tag: 'fnac' },
        'Radio Popular': { dot: '#003d99', tag: 'radiopopular' },
        'Rádio Popular': { dot: '#003d99', tag: 'radiopopular' },
        'PC Diga':       { dot: '#1a7a1a', tag: 'pcdiga' },
    };

    // ── Preencher dados básicos ─────────────────────────────────────────────
    document.getElementById('prodTitle').innerText = data.name;
    document.getElementById('mainImage').src = data.image;
    document.getElementById('mainImage').alt = data.name;
    // Esconder bloco de rating se não vier rating real (Serper nem sempre devolve)
    const ratingEl = document.getElementById('prodRating');
    if (ratingEl) {
        if (data.rating) {
            ratingEl.innerText = data.rating;
        } else {
            const wrapper = ratingEl.closest('.product-rating, .rating, [class*="rating"]') || ratingEl.parentElement;
            if (wrapper) wrapper.style.display = 'none';
        }
    }
    document.getElementById('breadcrumbCat').innerText = CATEGORY_LABEL[data.category] || data.category || '';
    
    if (data.description) {
        document.getElementById('prodDesc').innerText = data.description;
    }

    // ── Tabela de comparação ────────────────────────────────────────────────
    let currentShops = [];
    const verifyingStores = new Set();
    const storeStatus = new Map();
    let justUpdatedStore = null;

    function sortShops(shopsList) {
        return shopsList.slice().sort((a, b) => {
            const aAvail = a.available !== false;
            const bAvail = b.available !== false;
            if (aAvail !== bAvail) {
                return aAvail ? -1 : 1; // em stock primeiro
            }
            return parseFloat(a.price) - parseFloat(b.price); // depois por preço
        });
    }

    function renderComparisonTable(shopsList) {
        // Ordenar lojas usando a nossa ordenação customizada (stock primeiro, depois preço)
        const sortedShops = sortShops(shopsList);
        const bestPrice = sortedShops.length ? parseFloat(sortedShops[0].price) : 0;
        const worstPrice = sortedShops.length ? parseFloat(sortedShops[sortedShops.length - 1].price) : 0;

        document.getElementById('priceBest').textContent = bestPrice.toFixed(2);
        
        // Exibir promoção se existir
        const oldEl = document.getElementById('priceOld');
        const badgeEl = document.getElementById('promoBadge');
        if (data.discount && data.discountPercent) {
            const calculatedOld = bestPrice / (1 - (data.discountPercent / 100));
            oldEl.textContent = calculatedOld.toFixed(2) + '€';
            oldEl.style.display = 'inline';
            
            badgeEl.textContent = '-' + data.discountPercent + '%';
            badgeEl.style.display = 'inline';
        } else {
            oldEl.style.display = 'none';
            badgeEl.style.display = 'none';
        }

        const savingsEl = document.getElementById('priceSavings');
        if (sortedShops.length > 1 && worstPrice > bestPrice) {
            const diff = (worstPrice - bestPrice).toFixed(2);
            savingsEl.innerHTML = `<i class="fa-solid fa-arrow-down"></i> Poupa até <strong>${diff}€</strong> vs. preço mais alto nas outras lojas`;
        } else {
            savingsEl.textContent = '';
        }

        const container = document.getElementById('shopsComparison');

        // Para detetar variantes diferentes entre lojas, normalizamos os títulos.
        function normalizeTitle(t) {
            return String(t || '').toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ').trim();
        }
        const titlesNormalized = sortedShops.map(s => normalizeTitle(s.offerTitle));
        const titlesDiffer = new Set(titlesNormalized.filter(Boolean)).size > 1;

        container.innerHTML = sortedShops.map((shop, index) => {
            const colors = STORE_COLORS[shop.name] || { dot: '#666' };
            const isBest = index === 0 && shop.available !== false;
            const bestBadge = isBest
                ? '<span class="es-badge es-badge-success ms-2"><i class="fa-solid fa-trophy"></i> Melhor preço</span>'
                : '';
            const titleHint = (titlesDiffer && shop.offerTitle)
                ? `<div class="text-muted small mt-1" style="font-size: 11px; line-height: 1.3;" title="Título exato anunciado pela loja">${escapeHtml(shop.offerTitle).slice(0, 90)}</div>`
                : '';
            
            // Determinar o ícone de status
            const status = storeStatus.get(shop.name) || 'verifying';
            let statusHtml = '';
            if (status === 'verifying') {
                statusHtml = `<span class="verification-status ms-2" style="cursor:help;" title="A confirmar preço em tempo real com o site da loja..."><i class="fa-solid fa-circle-notch fa-spin text-muted" style="font-size: 0.85em;"></i></span>`;
            } else if (status === 'updated') {
                statusHtml = `<span class="verification-status ms-2" style="cursor:help;" title="Preço atualizado em tempo real!"><i class="fa-solid fa-circle-check text-success" style="font-size: 0.9em;"></i></span>`;
            } else if (status === 'verified') {
                statusHtml = `<span class="verification-status ms-2" style="cursor:help;" title="Preço confirmado em tempo real"><i class="fa-solid fa-circle-check text-success" style="font-size: 0.9em; opacity: 0.85;"></i></span>`;
            } else if (status === 'fallback') {
                statusHtml = `<span class="verification-status ms-2" style="cursor:help;" title="Não foi possível verificar o preço em tempo real (preço de referência)"><i class="fa-solid fa-circle-xmark" style="font-size: 0.9em; color: #d97706;"></i></span>`;
            }

            const shouldFlash = (justUpdatedStore === shop.name);
            const isOutOfStock = shop.available === false;
            const availabilityHtml = isOutOfStock
                ? `<span class="availability-out" style="color: var(--es-danger); font-weight: 500;"><i class="fa-solid fa-circle-xmark"></i> Sem stock</span>`
                : `<span class="availability-ok"><i class="fa-solid fa-circle-check"></i> Em stock</span>`;
            
            const priceStyle = isOutOfStock ? 'text-decoration: line-through; opacity: 0.5;' : '';

            return `
                <tr class="${isBest ? 'best-row' : ''} ${shouldFlash ? 'price-update-flash' : ''} ${isOutOfStock ? 'out-of-stock-row' : ''}" data-store="${shop.name}">
                    <td>
                        <div class="store-cell">
                            <span class="store-dot" style="background:${colors.dot}"></span>
                            <span style="${isOutOfStock ? 'opacity: 0.6;' : ''}">${shop.name}</span>
                            ${bestBadge}
                        </div>
                        ${titleHint}
                    </td>
                    <td>${availabilityHtml}</td>
                    <td><span class="price-cell" style="font-weight: 600; ${priceStyle}">${parseFloat(shop.price).toFixed(2)}€${statusHtml}</span></td>
                    <td class="text-end">
                        <a href="${shop.link || '#'}" target="_blank" rel="noopener noreferrer" class="es-btn ${isBest ? 'es-btn-primary' : 'es-btn-outline'} es-btn-sm ${isOutOfStock ? 'es-btn-disabled' : ''}" style="${isOutOfStock ? 'opacity: 0.5;' : ''}">
                            Ir à loja <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </a>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function updateBannerStatus() {
        const bannerText = document.getElementById('bannerText');
        const bannerSpinner = document.getElementById('bannerSpinner');
        const bannerBadge = document.getElementById('bannerBadge');
        const statusBanner = document.getElementById('livePriceStatusBanner');
        const legendVerifyingItem = document.getElementById('legendVerifyingItem');

        if (verifyingStores.size > 0) {
            if (bannerText) bannerText.textContent = `A confirmar preços reais em tempo real com as lojas (${verifyingStores.size} restantes)...`;
            if (legendVerifyingItem) {
                legendVerifyingItem.classList.remove('d-none');
                legendVerifyingItem.classList.add('d-flex');
            }
        } else {
            // Todos concluídos!
            if (legendVerifyingItem) {
                legendVerifyingItem.classList.remove('d-flex');
                legendVerifyingItem.classList.add('d-none');
            }
            if (bannerSpinner) {
                bannerSpinner.className = 'fa-solid fa-circle-check text-success';
                bannerSpinner.style.animation = 'none';
            }
            if (bannerText) {
                bannerText.textContent = 'Preços reais verificados em tempo real com as lojas oficiais.';
            }
            if (bannerBadge) {
                bannerBadge.textContent = 'CONFIRMADO';
                bannerBadge.className = 'badge bg-success text-white px-2 py-1';
            }
            // Fade out e colapso total suave
            setTimeout(() => {
                if (statusBanner) {
                    statusBanner.style.transition = 'all 1s ease-in-out';
                    // Remover classes Bootstrap que impedem colapso suave por terem !important
                    statusBanner.classList.remove('d-flex', 'mb-3');
                    statusBanner.style.opacity = '0';
                    statusBanner.style.height = '0';
                    statusBanner.style.paddingTop = '0';
                    statusBanner.style.paddingBottom = '0';
                    statusBanner.style.marginTop = '0';
                    statusBanner.style.marginBottom = '0';
                    statusBanner.style.overflow = 'hidden';
                    statusBanner.style.borderWidth = '0';
                    setTimeout(() => {
                        statusBanner.classList.add('d-none');
                    }, 1000);
                }
            }, 4000);
        }
    }

    // Mostrar loading inicial
    const container = document.getElementById('shopsComparison');
    container.innerHTML = `
        <tr id="loading-row">
            <td colspan="4" class="text-center py-5 text-muted">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.25rem;"></i>
                <div class="mt-2">A pesquisar preços nas lojas parceiras…</div>
            </td>
        </tr>
    `;

    // Preço hero em loading
    document.getElementById('priceBest').textContent = '-';
    document.getElementById('priceCurrency').style.opacity = '0.4';
    const oldEl = document.getElementById('priceOld');
    const badgeEl = document.getElementById('promoBadge');
    if (oldEl) oldEl.style.display = 'none';
    if (badgeEl) badgeEl.style.display = 'none';
    document.getElementById('priceSavings').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A pesquisar…';

    // Desabilitar carrinho até termos o carregamento inicial
    const cartBtnInit = document.getElementById('addToCartBtn');
    if (cartBtnInit) {
        cartBtnInit.disabled = true;
        cartBtnInit.style.opacity = '0.5';
    }

    try {
        // Pedido rápido (fast=true) com timeout de 15 segundos
        const res = await (window.fetchWithTimeout || fetch)(`/api/products/compare?q=${encodeURIComponent(data.name)}&fast=true`, {}, 15000);
        const compareData = await res.json();
        const initialShops = compareData.shops || [];

        // Remover linha de loading
        const loadingEl = document.getElementById('loading-row');
        if (loadingEl) loadingEl.remove();

        if (initialShops.length > 0) {
            // Restaurar opacidade do € e renderizar o inicial
            document.getElementById('priceCurrency').style.opacity = '';
            
            // Inicializar status de todas as lojas para "verifying"
            currentShops = initialShops;
            currentShops.forEach(shop => {
                verifyingStores.add(shop.name);
                storeStatus.set(shop.name, 'verifying');
            });

            // Inserir banner superior de status dinamicamente
            const tableResponsive = document.querySelector('.comparison .table-responsive');
            let statusBanner = document.getElementById('livePriceStatusBanner');
            if (!statusBanner && tableResponsive) {
                statusBanner = document.createElement('div');
                statusBanner.id = 'livePriceStatusBanner';
                statusBanner.className = 'alert alert-info py-2 px-3 mb-3 d-flex align-items-center justify-content-between';
                statusBanner.style.cssText = 'border-radius: 8px; font-size: 13px; background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; font-family: inherit; margin: 15px 0 10px 0;';
                statusBanner.innerHTML = `
                    <div class="d-flex align-items-center gap-2">
                        <i class="fa-solid fa-circle-notch fa-spin text-success" id="bannerSpinner" style="margin-right: 5px;"></i>
                        <span id="bannerText">A confirmar preços reais em tempo real com as lojas (${verifyingStores.size} restantes)...</span>
                    </div>
                    <span class="badge bg-success text-white px-2 py-1" id="bannerBadge" style="font-size: 10px; border-radius: 4px;">VERIFICAÇÃO ATIVA</span>
                `;
                tableResponsive.parentNode.insertBefore(statusBanner, tableResponsive);
            }

            renderComparisonTable(currentShops);

            // Inserir a legenda da tabela de preços se não existir
            let legendRow = document.getElementById('livePriceLegendRow');
            const disclaimer = document.getElementById('priceDisclaimer');
            if (!legendRow && disclaimer) {
                legendRow = document.createElement('div');
                legendRow.id = 'livePriceLegendRow';
                legendRow.className = 'd-flex flex-wrap gap-3 justify-content-start py-2 px-4 border-top';
                legendRow.style.cssText = 'font-size: 11px; background: #fafafa; color: #666; border-color: #eee;';
                legendRow.innerHTML = `
                    <div class="d-flex align-items-center gap-1" style="margin-right: 15px;">
                        <i class="fa-solid fa-circle-check text-success"></i>
                        <span>Preço verificado em tempo real</span>
                    </div>
                    <div class="d-flex align-items-center gap-1" style="margin-right: 15px;">
                        <i class="fa-solid fa-circle-xmark" style="color: #d97706;"></i>
                        <span>Preço de referência (não verificado live)</span>
                    </div>
                    <div id="legendVerifyingItem" class="d-flex align-items-center gap-1">
                        <i class="fa-solid fa-circle-notch fa-spin text-muted"></i>
                        <span>A verificar...</span>
                    </div>
                `;
                disclaimer.parentNode.insertBefore(legendRow, disclaimer);
            }

            // Reativar botão de carrinho com preço inicial do Serper (fallback ativo)
            const cartBtnEnable = document.getElementById('addToCartBtn');
            if (cartBtnEnable) {
                cartBtnEnable.disabled = false;
                cartBtnEnable.style.opacity = '';
            }

            // Guardar dados iniciais no localStorage
            data.shops = currentShops;
            const initialSorted = sortShops(currentShops);
            data.minPrice = initialSorted.length ? initialSorted[0].price : '0.00';
            localStorage.setItem('selectedProduct', JSON.stringify(data));

            // Disparar chamadas assíncronas para atualizar os preços em background
            currentShops.forEach(async (shop) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 65000); // 65s timeout no frontend
                
                try {
                    const liveRes = await fetch(`/api/products/live-price?store=${encodeURIComponent(shop.name)}&link=${encodeURIComponent(shop.link)}`, {
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);
                    
                    if (liveRes.ok) {
                        const liveData = await liveRes.json();
                        if (liveData && liveData.price !== null) {
                            const oldPrice = parseFloat(shop.price);
                            const newPrice = parseFloat(liveData.price);
                            const oldAvailable = shop.available !== false;
                            const newAvailable = liveData.available !== false;

                            shop.available = newAvailable;
                            
                            let didChange = false;
                            if (Math.abs(oldPrice - newPrice) > 0.01) {
                                shop.price = liveData.price;
                                didChange = true;
                            }
                            if (oldAvailable !== newAvailable) {
                                didChange = true;
                            }
                            
                            if (didChange) {
                                console.log(`[UI] Preço/Estoque de ${shop.name} atualizado: ${oldPrice}€ (Disp: ${oldAvailable}) → ${newPrice}€ (Disp: ${newAvailable})`);
                                storeStatus.set(shop.name, 'updated');
                                justUpdatedStore = shop.name;
                                
                                verifyingStores.delete(shop.name);
                                renderComparisonTable(currentShops);

                                // Atualizar localStorage
                                data.shops = currentShops;
                                const sorted = sortShops(currentShops);
                                data.minPrice = sorted.length ? sorted[0].price : '0.00';
                                localStorage.setItem('selectedProduct', JSON.stringify(data));

                                // Remover animação flash após 1.8s
                                setTimeout(() => {
                                    if (justUpdatedStore === shop.name) {
                                        justUpdatedStore = null;
                                        renderComparisonTable(currentShops);
                                    }
                                }, 1800);
                            } else {
                                storeStatus.set(shop.name, 'verified');
                                verifyingStores.delete(shop.name);
                                renderComparisonTable(currentShops);
                            }
                        } else {
                            // Se o preço veio null (falha ou timeout)
                            storeStatus.set(shop.name, 'fallback');
                            verifyingStores.delete(shop.name);
                            renderComparisonTable(currentShops);
                        }
                    } else {
                        storeStatus.set(shop.name, 'fallback');
                        verifyingStores.delete(shop.name);
                        renderComparisonTable(currentShops);
                    }
                } catch (e) {
                    console.error(`Erro ao verificar live-price para ${shop.name}:`, e);
                    storeStatus.set(shop.name, 'fallback');
                    verifyingStores.delete(shop.name);
                    renderComparisonTable(currentShops);
                } finally {
                    clearTimeout(timeoutId);
                    updateBannerStatus();
                }
            });

        } else {
            // Nenhuma loja confirmou ter este modelo exato - esconder bloco de preço
            // e mostrar aviso amarelo
            document.getElementById('priceHeroBlock').style.display = 'none';
            document.getElementById('noShopsWarning').style.display = 'block';
            // Esconder a secção de comparação
            const compSection = document.querySelector('.comparison');
            if (compSection) compSection.style.display = 'none';
            // Desabilitar "Adicionar ao Carrinho" - sem preço fiável
            const cartBtn = document.getElementById('addToCartBtn');
            if (cartBtn) {
                cartBtn.disabled = true;
                cartBtn.title = 'Indisponível: este modelo não foi confirmado nas lojas.';
                cartBtn.style.opacity = '0.5';
                cartBtn.style.cursor = 'not-allowed';
            }
        }
    } catch(e) {
        console.error("Erro a buscar comparação:", e);
        const loadingEl = document.getElementById('loading-row');
        if(loadingEl) loadingEl.remove();
    }

    // Buscar detalhes e especificações (Organic Search)
    try {
        const descRes = await (window.fetchWithTimeout || fetch)(`/api/products/details?q=${encodeURIComponent(data.name)}`);
        if (descRes.ok) {
            const detailsData = await descRes.json();
            
            if (detailsData.description && detailsData.description !== 'Sem descrição detalhada disponível.') {
                document.getElementById('prodDesc').innerText = detailsData.description;
            }
            
            if (detailsData.specs && detailsData.specs.length > 0) {
                const ul = document.getElementById('prodSpecs');
                ul.innerHTML = detailsData.specs.map(s => `<li>${s}</li>`).join('');
                document.getElementById('specsContainer').style.display = 'block';
            }
        }
    } catch(e) {
        console.error("Erro a buscar detalhes:", e);
    }

    // ── Favoritos: estado inicial ───────────────────────────────────────────
    const favBtn = document.getElementById('favBtn');
    const favIcon = favBtn.querySelector('i');

    if (await window.Favorites.isFavorite(data.name)) {
        favIcon.classList.replace('fa-regular', 'fa-solid');
        favBtn.classList.add('active');
        favBtn.style.color = 'var(--es-danger)';
        favBtn.style.borderColor = 'var(--es-danger)';
    }

    favBtn.addEventListener('click', async function () {
        const adding = favIcon.classList.contains('fa-regular');
        
        if (adding && window.Favorites && !window.Favorites.isLoggedIn()) {
            if (window.Favorites.showAuthPopup) window.Favorites.showAuthPopup();
            return;
        }
        
        favIcon.classList.add('heart-beat');
        setTimeout(() => favIcon.classList.remove('heart-beat'), 300);

        if (adding) {
            favIcon.classList.replace('fa-regular', 'fa-solid');
            this.classList.add('active');
            this.style.color = 'var(--es-danger)';
            this.style.borderColor = 'var(--es-danger)';
            await window.Favorites.addFavorite(data);
        } else {
            favIcon.classList.replace('fa-solid', 'fa-regular');
            this.classList.remove('active');
            this.style.color = '';
            this.style.borderColor = '';
            await window.Favorites.removeFavorite(data.name);
        }
    });

    // ── Adicionar ao carrinho ───────────────────────────────────────────────
    const addToCartBtn = document.getElementById('addToCartBtn');
    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', function () {
            window.Cart.add(data, 1);

            const originalHtml = this.innerHTML;
            this.innerHTML = '<i class="fa-solid fa-check"></i> Adicionado!';
            this.classList.remove('es-btn-primary');
            this.classList.add('es-btn-secondary');
            setTimeout(() => {
                this.innerHTML = originalHtml;
                this.classList.remove('es-btn-secondary');
                this.classList.add('es-btn-primary');
            }, 1500);
        });
    }
});
