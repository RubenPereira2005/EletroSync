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

    // Ordenar lojas por preço e determinar o melhor preço
    const sortedShops = (data.shops || []).slice().sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    const bestPrice = sortedShops.length ? parseFloat(sortedShops[0].price) : 0;
    const worstPrice = sortedShops.length ? parseFloat(sortedShops[sortedShops.length - 1].price) : 0;

    document.getElementById('priceBest').textContent = bestPrice.toFixed(2);
    const savingsEl = document.getElementById('priceSavings');
    if (sortedShops.length > 1 && worstPrice > bestPrice) {
        const diff = (worstPrice - bestPrice).toFixed(2);
        savingsEl.innerHTML = `<i class="fa-solid fa-arrow-down"></i> Poupa até <strong>${diff}€</strong> vs. preço mais alto`;
    } else {
        savingsEl.textContent = '';
    }

    // ── Tabela de comparação ────────────────────────────────────────────────
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
                    <a href="#" class="es-btn ${isBest ? 'es-btn-primary' : 'es-btn-outline'} es-btn-sm">
                        Ir à loja <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    </a>
                </td>
            </tr>
        `;
    }).join('');

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
