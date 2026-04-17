document.addEventListener("DOMContentLoaded", () => {
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

    // --- LOGICA DE VERIFICAÇÃO INICIAL DOS FAVORITOS ---
    const favBtn = document.getElementById('favBtn');
    const icon = favBtn.querySelector('i');
    let favorites = JSON.parse(localStorage.getItem('myFavorites')) || [];

    // Se o produto já estiver nos favoritos, ativa o estado visual
    if (favorites.some(p => p.name === data.name)) {
        icon.classList.replace('fa-regular', 'fa-solid');
        favBtn.classList.add('active');
    }
    // --------------------------------------------------

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

    // Evento de Clique para Adicionar/Remover
    favBtn.addEventListener('click', function() {
        // Recarregar a lista atualizada para garantir que não sobrescrevemos dados
        let currentFavorites = JSON.parse(localStorage.getItem('myFavorites')) || [];
        
        if (icon.classList.contains('fa-regular')) {
            // ADICIONAR
            icon.classList.replace('fa-regular', 'fa-solid');
            this.classList.add('active');
            
            if (!currentFavorites.some(p => p.name === data.name)) {
                currentFavorites.push(data);
                localStorage.setItem('myFavorites', JSON.stringify(currentFavorites));
            }
        } else {
            // REMOVER
            icon.classList.replace('fa-solid', 'fa-regular');
            this.classList.remove('active');
            
            currentFavorites = currentFavorites.filter(p => p.name !== data.name);
            localStorage.setItem('myFavorites', JSON.stringify(currentFavorites));
        }
    });
});