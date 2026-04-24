document.addEventListener("DOMContentLoaded", async () => {
    const data = JSON.parse(localStorage.getItem('selectedProduct'));

    if (!data) {
        window.location.href = 'index.html';
        return;
    }

    // Preencher dados básicos
    document.getElementById('prodTitle').innerText = data.name;
    document.getElementById('mainImage').src = data.image;
    document.getElementById('prodRating').innerText = data.rating;
    document.getElementById('breadcrumbCat').innerText = data.category;

    // ── Estado inicial do botão de favoritos ───────────────────────────────
    const favBtn = document.getElementById('favBtn');
    const icon = favBtn.querySelector('i');

    if (await window.Favorites.isFavorite(data.name)) {
        icon.classList.replace('fa-regular', 'fa-solid');
        favBtn.classList.add('active');
    }

    // Ordenar lojas pelo preço
    const sortedShops = data.shops.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    const container = document.getElementById('shopsComparison');
    container.innerHTML = sortedShops.map((shop, index) => `
        <tr class="${index === 0 ? 'table-success-light' : ''}">
            <td class="ps-4">
                <span class="store-logo-name fs-6">${shop.name}</span>
                ${index === 0 ? '<br><span class="badge bg-success" style="font-size: 10px;">Melhor Preço</span>' : ''}
            </td>
            <td>
                <span class="text-success small"><i class="fa-solid fa-check-circle me-1"></i> Em stock</span>
            </td>
            <td>
                <span class="fs-5 fw-bold text-primary">${shop.price}€</span>
            </td>
            <td class="pe-4 text-end">
                <a href="#" class="btn btn-dark btn-sm rounded-5 px-3">
                    Ver Loja <i class="fa-solid fa-external-link ms-1" style="font-size: 10px;"></i>
                </a>
            </td>
        </tr>
    `).join('');

    // ── Clique: adicionar/remover dos favoritos ────────────────────────────
    favBtn.addEventListener('click', async function () {
        const adding = icon.classList.contains('fa-regular');

        // Atualiza UI imediatamente (optimistic update)
        if (adding) {
            icon.classList.replace('fa-regular', 'fa-solid');
            this.classList.add('active');
            await window.Favorites.addFavorite(data);
        } else {
            icon.classList.replace('fa-solid', 'fa-regular');
            this.classList.remove('active');
            await window.Favorites.removeFavorite(data.name);
        }
    });

    // ── Clique: adicionar ao carrinho ───────────────────────────────────────
    const addToCartBtn = document.getElementById('addToCartBtn');
    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', function () {
            window.Cart.add(data, 1);

            // Feedback visual no botão
            const originalHtml = this.innerHTML;
            this.innerHTML = '<i class="fa-solid fa-check me-2"></i>Adicionado!';
            this.classList.remove('btn-primary');
            this.classList.add('btn-success');

            setTimeout(() => {
                this.innerHTML = originalHtml;
                this.classList.remove('btn-success');
                this.classList.add('btn-primary');
            }, 1500);
        });
    }
});
