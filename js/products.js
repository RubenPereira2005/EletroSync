// 1. Organização por categoria (Nomes batem com as Imagens)
const catalog = {
  eletrodomesticos: [
    { name: "Frigorífico Combinado Samsung", image: "images/frigo.png" },
    { name: "Frigorífico Side-by-Side LG", image: "images/frigo1.png" },
    { name: "Micro-ondas Digital 25L", image: "images/micro.png" },
    { name: "Fogão a Gás de 4 Bocas", image: "images/fugao.png" },
    { name: "Forno de Encastrar Elétrico", image: "images/forni.png" },
    { name: "Máquina de Lavar Roupa 9kg", image: "images/lava.png" },
    { name: "Máquina de Lavar Loiça Bosch", image: "images/loiça.png" },
    { name: "Torradeira Inox 2 Fatias", image: "images/torras1.png" }
  ],
  informatica: [
    { name: "Desktop Gaming PC Torre", image: "images/pctorre.png" },
    { name: "MacBook Air M2", image: "images/macbook.png" },
    { name: "Monitor Curvo 27\"", image: "images/tv.png" }
  ],
  smartphones: [
    { name: "iPhone 15 Pro Max", image: "images/tele.png" },
    { name: "OnePlus Nord 3", image: "images/tele.png" },
    { name: "AirPods Pro (2ª Ger)", image: "images/airpods.png" }
  ],
  gaming: [
    { name: "Consola PlayStation 5", image: "images/ps5.png" },
    { name: "PC Gaming High-End", image: "images/pctorre.png" }
  ],
  imagem: [
    { name: "Smart TV LG OLED 65\"", image: "images/tv.png" },
    { name: "Soundbar Surround 5.1", image: "images/tv.png" }
  ],
  outros: [
    { name: "Cabo HDMI 2.1 High Speed", image: "images/cabo.png" },
    { name: "Suporte de Parede para TV", image: "images/suporte.png" },
    { name: "Pilha Alcalina AA (Pack 4)", image: "images/pilhas.png" }
  ]
};

const categories = Object.keys(catalog);

const storesList = ["Worten", "Fnac", "Radio Popular", "PC Diga"];

const products = Array.from({ length: 40 }, () => { // Aumentei para 40 para teres mais resultados ao filtrar
    const cat = categories[Math.floor(Math.random() * categories.length)];
    const items = catalog[cat];
    const selected = items[Math.floor(Math.random() * items.length)];

    const numShops = Math.floor(Math.random() * 4) + 1;
    const shuffledStores = [...storesList].sort(() => 0.5 - Math.random());
    const productShops = shuffledStores.slice(0, numShops).map(store => ({
        name: store,
        price: (Math.random() * 1200 + 50).toFixed(2)
    }));

    const minPrice = Math.min(...productShops.map(s => parseFloat(s.price)));

    return {
        name: selected.name,
        image: selected.image,
        category: cat,
        rating: (Math.random() * 1 + 4).toFixed(1),
        discount: Math.random() > 0.7, // Promoção
        eventX: Math.random() > 0.8,    // Evento X (novo campo)
        shops: productShops,
        minPrice: minPrice.toFixed(2)
    };
});

function renderProduct(p) {
  // Criar badges das lojas
  const storeBadges = p.shops.map(s => 
    `<span class="badge bg-light text-dark border me-1" style="font-size: 10px;">${s.name}</span>`
  ).join("");

  return `
    <div class="col">
      <div class="product-item transition-hover p-3 shadow-sm">
        ${p.discount ? `<span class="badge bg-success position-absolute m-2" style="top:0; left:0; z-index:10;">-30%</span>` : ""}
        
        <figure class="text-center">
          <img src="${p.image}" class="img-fluid mb-3 product-image" style="max-height: 120px; object-fit: contain;">
        </figure>
        
        <div class="product-content">
            <h3 class="fs-6 text-dark mb-1" style="min-height: 38px; line-height: 1.2;">${p.name}</h3>
            
            <div class="d-flex align-items-center gap-1 mb-2">
               <i class="fa-solid fa-star premium-star"></i>
               <span class="small fw-bold">${p.rating}</span>
            </div>

            <div class="mb-2 d-flex flex-wrap">
                ${storeBadges}
            </div>
            
            <span class="price fw-bold text-primary fs-6">desde ${p.minPrice}€</span>
        </div>
      </div>
    </div>
  `;
}

function renderTo(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // g-4 adiciona o "gutter" (espaço) necessário para o hover não sobrepor o card do lado
  container.className = "row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 row-cols-xl-5 g-4 pt-4 pb-5";
  container.innerHTML = list.length > 0 ? list.map(renderProduct).join("") : '<p class="col-12 text-center">Nenhum produto encontrado.</p>';
}

function renderCategory(categoryKey) {
  const rangeInput = document.querySelector(".form-range");
  const maxPrice = rangeInput ? parseFloat(rangeInput.value) : 2000;
  
  const filtered = products.filter(p => {
    // IMPORTANTE: p.category tem de bater exatamente com a chave do catálogo
    const matchCategory = p.category.toLowerCase() === categoryKey.toLowerCase();
    // IMPORTANTE: Usar p.minPrice em vez de p.price
    const matchPrice = parseFloat(p.minPrice) <= maxPrice;
    
    return matchCategory && matchPrice;
  });

  renderTo(`grid-${categoryKey}`, filtered);
}

// 4. Eventos
// Clique nas Tabs (Abas)
// Clique nas Tabs (Abas) - Agora dispara o filtro completo
document.querySelectorAll("#nav-tab .nav-link").forEach(tab => {
  tab.addEventListener("shown.bs.tab", () => {
    // Em vez de inventar uma lógica nova, chamamos o clique do botão aplicar
    // Isso garante que se mudares de categoria, os filtros de preço/loja continuam a valer
    document.querySelector(".filter-sidebar .btn-primary").click();
  });
});

// Função unificada de Filtros
document.querySelector(".filter-sidebar .btn-primary").addEventListener("click", () => {
    // 1. Categoria ativa
    const activeTab = document.querySelector(".nav-link.active");
    const categoryTarget = activeTab.getAttribute("data-bs-target").replace("#nav-", "");
    let catKey = (categoryTarget === "jogos") ? "gaming" : categoryTarget;

    // 2. Preço
    const maxPrice = parseFloat(document.querySelector(".form-range").value);

    // 3. Capturar estados das Checkboxes de "Categorias" (Promoção e Evento)
    const categoryCheckboxes = Array.from(document.querySelectorAll('.filter-group:nth-child(3) .filter-option'));
    
    // Procura a checkbox que tem o texto "Promoção"
    const promoChecked = categoryCheckboxes.some(opt => 
        opt.textContent.includes("Promoção") && opt.querySelector('input').checked
    );
    
    // Procura a checkbox que tem o texto "Evento X"
    const eventXChecked = categoryCheckboxes.some(opt => 
        opt.textContent.includes("Evento X") && opt.querySelector('input').checked
    );

    // 4. Lojas Selecionadas
    const selectedStores = Array.from(document.querySelectorAll('.filter-group:nth-child(4) input[type="checkbox"]:checked'))
        .map(cb => cb.parentElement.textContent.trim());

    // 5. Filtragem Final
    const filtered = products.filter(p => {
        const matchCategory = (categoryTarget === "all") || (p.category === catKey);
        const matchPrice = parseFloat(p.minPrice) <= maxPrice;
        
        // Se a checkbox "Promoção" estiver ligada, só mostra se p.discount for true
        const matchPromo = promoChecked ? p.discount === true : true;
        
        // Se a checkbox "Evento X" estiver ligada, só mostra se p.eventX for true
        const matchEvent = eventXChecked ? p.eventX === true : true;

        const productStoreNames = p.shops.map(s => s.name);
        const matchStore = selectedStores.length > 0 
            ? selectedStores.some(store => productStoreNames.includes(store)) 
            : true;

        return matchCategory && matchPrice && matchPromo && matchEvent && matchStore;
    });

    renderTo(`grid-${categoryTarget}`, filtered);
});

// Inicialização
window.addEventListener("DOMContentLoaded", () => {
  renderTo("grid-all", products);
});

document.addEventListener('click', function(e) {
    const card = e.target.closest('.transition-hover');
    
    if (card) {
        // 1. Pegar o nome do produto do card que foi clicado
        const productName = card.querySelector('h3').innerText;
        
        // 2. Encontrar o objeto completo do produto na nossa lista 'products'
        const productData = products.find(p => p.name === productName);
        
        if (productData) {
            // 3. Guardar no localStorage para a outra página ler
            localStorage.setItem('selectedProduct', JSON.stringify(productData));
            
            // 4. Navegar para a página de detalhes
            window.location.href = 'single-product.html';
        }
    }
});