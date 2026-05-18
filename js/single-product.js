document.addEventListener("DOMContentLoaded", async () => {
    const data = JSON.parse(localStorage.getItem('selectedProduct'));
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
    document.getElementById('prodRating').innerText = data.rating;
    document.getElementById('breadcrumbCat').innerText = CATEGORY_LABEL[data.category] || data.category || '';
    
    if (data.description) {
        document.getElementById('prodDesc').innerText = data.description;
    }

    // ── Tabela de comparação ────────────────────────────────────────────────
    function renderComparisonTable(shopsList) {
        // Ordenar lojas por preço e determinar o melhor preço
        const sortedShops = shopsList.slice().sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
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
        container.innerHTML = sortedShops.map((shop, index) => {
            const colors = STORE_COLORS[shop.name] || { dot: '#666' };
            const isBest = index === 0;
            const bestBadge = isBest
                ? '<span class="es-badge es-badge-success ms-2"><i class="fa-solid fa-trophy"></i> Melhor preço</span>'
                : '';
            return `
                <tr class="${isBest ? 'best-row' : ''}">
                    <td>
                        <div class="store-cell">
                            <span class="store-dot" style="background:${colors.dot}"></span>
                            <span>${shop.name}</span>
                            ${bestBadge}
                        </div>
                    </td>
                    <td><span class="availability-ok"><i class="fa-solid fa-circle-check"></i>Em stock</span></td>
                    <td><span class="price-cell">${parseFloat(shop.price).toFixed(2)}€</span></td>
                    <td class="text-end">
                        <a href="${shop.link || '#'}" target="_blank" rel="noopener noreferrer" class="es-btn ${isBest ? 'es-btn-primary' : 'es-btn-outline'} es-btn-sm">
                            Ir à loja <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </a>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Mostrar loading (NÃO renderizar a oferta original — pode ter preço impreciso
    // da agregação Serper Shopping; esperamos pelas ofertas validadas do /compare)
    const container = document.getElementById('shopsComparison');
    container.innerHTML = `
        <tr id="loading-row">
            <td colspan="4" class="text-center py-5 text-muted">
                <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.25rem;"></i>
                <div class="mt-2">A confirmar preços nas lojas portuguesas…</div>
            </td>
        </tr>
    `;

    // Preço hero em loading
    document.getElementById('priceBest').textContent = '—';
    document.getElementById('priceCurrency').style.opacity = '0.4';
    const oldEl = document.getElementById('priceOld');
    const badgeEl = document.getElementById('promoBadge');
    if (oldEl) oldEl.style.display = 'none';
    if (badgeEl) badgeEl.style.display = 'none';
    document.getElementById('priceSavings').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> A confirmar nas lojas…';

    // Desabilitar carrinho até termos preço fiável
    const cartBtnInit = document.getElementById('addToCartBtn');
    if (cartBtnInit) {
        cartBtnInit.disabled = true;
        cartBtnInit.style.opacity = '0.5';
    }

    // Buscar preços reais das outras lojas via API (apenas ofertas validadas)
    try {
        const res = await fetch(`/api/products/compare?q=${encodeURIComponent(data.name)}`);
        const compareData = await res.json();
        const validatedShops = compareData.shops || [];

        // Remover linha de loading
        const loadingEl = document.getElementById('loading-row');
        if (loadingEl) loadingEl.remove();

        if (validatedShops.length > 0) {
            // Restaurar opacidade do € e renderizar
            document.getElementById('priceCurrency').style.opacity = '';
            renderComparisonTable(validatedShops);
            data.shops = validatedShops;
            data.minPrice = validatedShops.slice().sort((a,b) => parseFloat(a.price) - parseFloat(b.price))[0].price;
            localStorage.setItem('selectedProduct', JSON.stringify(data));
            // Reativar botão de carrinho
            const cartBtnEnable = document.getElementById('addToCartBtn');
            if (cartBtnEnable) {
                cartBtnEnable.disabled = false;
                cartBtnEnable.style.opacity = '';
            }
        } else {
            // Nenhuma loja confirmou ter este modelo exato — esconder bloco de preço
            // e mostrar aviso amarelo
            document.getElementById('priceHeroBlock').style.display = 'none';
            document.getElementById('noShopsWarning').style.display = 'block';
            // Esconder a secção de comparação
            const compSection = document.querySelector('.comparison');
            if (compSection) compSection.style.display = 'none';
            // Desabilitar "Adicionar ao Carrinho" — sem preço fiável
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
        const descRes = await fetch(`/api/products/details?q=${encodeURIComponent(data.name)}`);
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
