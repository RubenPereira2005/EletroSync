// 1. Organização por categoria (Nomes batem com as Imagens)
// Fallback por categoria para imagens em falta
const FALLBACK_IMG = {
  eletrodomesticos: 'images/frigo.png',
  informatica:      'images/pctorre.png',
  smartphones:      'images/airpods.png',
  gaming:           'images/comando.png',
  imagem:           'images/tv.png',
  outros:           'images/airpods.png',
};

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
    { name: "MacBook Air M2", image: "images/pctorre.png" },
    { name: "Monitor Curvo 27\"", image: "images/tv.png" }
  ],
  smartphones: [
    { name: "iPhone 15 Pro Max", image: "images/tele.png" },
    { name: "OnePlus Nord 3", image: "images/tele.png" },
    { name: "AirPods Pro (2ª Ger)", image: "images/airpods.png" }
  ],
  gaming: [
    { name: "Consola PlayStation 5", image: "images/comando.png" },
    { name: "PC Gaming High-End", image: "images/pctorre.png" }
  ],
  imagem: [
    { name: "Smart TV LG OLED 65\"", image: "images/tv.png" },
    { name: "Soundbar Surround 5.1", image: "images/tv.png" }
  ],
  outros: [
    { name: "Cabo HDMI 2.1 High Speed", image: "images/airpod.png" },
    { name: "Suporte de Parede para TV", image: "images/tele.png" },
    { name: "Pilha Alcalina AA (Pack 4)", image: "images/airpod.png" }
  ]
};

const categories = Object.keys(catalog);
const storesList = ["Worten", "Fnac", "Radio Popular", "PC Diga"];

// 1. Mover o mapeamento para FORA do loop
const subMapping = {
    eletrodomesticos: ["Cozinha", "Lavandaria", "Limpeza", "Climatização", "Cuidado pessoal"],
    informatica: ["Portáteis", "Computadores fixos", "Monitores", "Impressoras", "Periféricos"],
    smartphones: ["Smartphones", "Capas e películas", "Carregadores", "Wearables"],
    gaming: ["Consolas", "Jogos", "Comandos", "Cadeiras"],
    imagem: ["TVs", "Barras de som", "Colunas", "Auscultadores"],
    outros: ["Cabos", "Pilhas"]
};

const products = Array.from({ length: 100 }, () => { 
    const cat = categories[Math.floor(Math.random() * categories.length)];
    const items = catalog[cat];
    const selected = items[Math.floor(Math.random() * items.length)];

    // Agora o possiveisSubs funciona porque o subMapping já existe acima
    const possiveisSubs = subMapping[cat] || ["Geral"];
    const subSorteada = possiveisSubs[Math.floor(Math.random() * possiveisSubs.length)];

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
        subcategory: subSorteada, 
        rating: (Math.random() * 1 + 4).toFixed(1),
        discount: Math.random() > 0.7, 
        eventX: Math.random() > 0.8,    
        shops: productShops,
        minPrice: minPrice.toFixed(2)
    };
});

function renderProduct(p) {
    const fallbackImg = FALLBACK_IMG[p.category] || 'images/airpods.png';
    const shopCount = (p.shops || []).length;
    const discountBadge = p.discount
        ? `<span class="product-discount-badge">-30%</span>`
        : "";

    return `
      <div class="col">
        <div class="product-item">
          ${discountBadge}
          <figure>
            <img src="${p.image}" alt="${escapeAttr(p.name)}" loading="lazy"
                 onerror="this.onerror=null;this.src='${fallbackImg}';">
          </figure>

          <div class="product-info">
            <h3 class="product-title">${p.name}</h3>

            <div class="product-meta">
              <span class="product-rating">
                <i class="fa-solid fa-star"></i> ${p.rating}
              </span>
              <span class="product-shops-count">
                <i class="fa-solid fa-store"></i> ${shopCount} ${shopCount === 1 ? 'loja' : 'lojas'}
              </span>
            </div>

            <div class="product-price-row">
              <div>
                <span class="product-price-label">Desde</span>
                <span class="product-price">${p.minPrice}€</span>
              </div>
              <button class="product-cta" title="Ver detalhes" aria-label="Ver detalhes">
                <i class="fa-solid fa-arrow-right"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
let swiperInstance; // Variável global para guardar o carrossel

function renderTo(containerId, list) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (containerId === 'carousel-novidades') {
        container.innerHTML = list.map(p => `
            <div class="swiper-slide">
                ${renderProduct(p)}
            </div>
        `).join("");
        
        // Pequeno delay para garantir que o HTML foi renderizado antes do Swiper agir
        setTimeout(() => {
            initSwiper();
        }, 100); 
    } else {
        container.className = "row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xl-4 g-3 pt-4 pb-5";
        container.innerHTML = list.map(renderProduct).join("");
    }
}

function initSwiper() {
    // Se já existir um swiper, destrói para criar um novo (evita bugs)
    if (swiperInstance) swiperInstance.destroy();

    swiperInstance = new Swiper(".all-novidades-carousel", {
        slidesPerView: 1,
        spaceBetween: 20,
        navigation: {
            nextEl: ".all-novidades-next",
            prevEl: ".all-novidades-prev",
        },
        breakpoints: {
            640: { slidesPerView: 2 },
            1024: { slidesPerView: 4 },
            1400: { slidesPerView: 5 }
        }
    });
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

function renderSubFilters(categoryKey) {
    const container = document.getElementById('sub-filter-container');
    
    // Se a categoria for 'all' ou 'Todos', escondemos a barra e saímos da função
    if (!categoryKey || categoryKey === 'all' || categoryKey === 'Todos') {
        container.style.display = 'none';
        container.innerHTML = ''; // Limpa os botões anteriores
        return;
    }

    const subs = subMapping[categoryKey] || [];
    
    // Se não houver subcategorias para esta categoria, também escondemos
    if (subs.length === 0) {
        container.style.display = 'none';
        return;
    }

    // Caso contrário, mostramos e geramos os botões
    container.style.display = 'flex';
    container.innerHTML = `
        <button class="btn-sub active" onclick="filterBySub('${categoryKey}', null, this)">Tudo em ${categoryKey}</button>
        ${subs.map(sub => `
            <button class="btn-sub" onclick="filterBySub('${categoryKey}', '${sub}', this)">${sub}</button>
        `).join('')}
    `;
}
// Função Mestra que lê TODOS os estados (Sidebar + Subcategoria + Categoria)
function applyAllFilters(forcedSub = undefined) {
    // 1. Identificar Categoria Ativa
    const activeTab = document.querySelector(".nav-link.active");
    const categoryTarget = activeTab.getAttribute("data-bs-target").replace("#nav-", "");
    let catKey = (categoryTarget === "jogos") ? "gaming" : categoryTarget;

    // 2. Identificar Subcategoria Ativa
    // Se passarmos forcedSub (clique no botão), usamos esse. 
    // Senão, procuramos o botão que tem a classe 'active' no container de subs.
    let activeSub = forcedSub;
    if (forcedSub === undefined) {
        const activeSubBtn = document.querySelector("#sub-filter-container .btn-sub.active");
        activeSub = (activeSubBtn && !activeSubBtn.textContent.includes("Tudo em")) ? activeSubBtn.textContent.trim() : null;
    }

    // 3. Pegar valores da Sidebar (com defaults se os filtros não existirem)
    const rangeEl = document.getElementById('filter-price') || document.querySelector(".form-range");
    const maxPrice = rangeEl ? parseFloat(rangeEl.value) : Infinity;

    const storeMap = { worten: 'Worten', fnac: 'Fnac', radiopopular: 'Radio Popular', pcdiga: 'PC Diga' };
    const selectedStoreValues = Array.from(document.querySelectorAll('.store-filter:checked')).map(cb => cb.value);
    const selectedStores = selectedStoreValues.map(v => storeMap[v] || v);

    const promoChecked = false;
    const eventXChecked = false;

    // 4. Filtragem Cruzada
    const filtered = products.filter(p => {
        const matchCategory = (categoryTarget === "all") || (p.category === catKey);
        const matchSub = (!activeSub || activeSub === "null") ? true : (p.subcategory === activeSub);
        const matchPrice = parseFloat(p.minPrice) <= maxPrice;
        const matchPromo = promoChecked ? p.discount === true : true;
        const matchEvent = eventXChecked ? p.eventX === true : true;
        
        const productStoreNames = p.shops.map(s => s.name);
        const matchStore = selectedStores.length > 0 
            ? selectedStores.some(store => productStoreNames.includes(store)) 
            : true;

        return matchCategory && matchSub && matchPrice && matchPromo && matchEvent && matchStore;
    });

    renderTo(`grid-${categoryTarget}`, filtered);
}

function filterBySub(cat, sub, btnElement) {
    // Apenas gere o visual dos botões
    const buttons = document.querySelectorAll('#sub-filter-container .btn-sub');
    buttons.forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');

    // Chama a filtragem mestre passando a subcategoria clicada
    applyAllFilters(sub);
}

// Filtros: reagir a mudanças nos controlos (sem botão "Aplicar")
document.querySelectorAll('.store-filter').forEach(cb => cb.addEventListener('change', () => applyAllFilters()));
const priceInput = document.getElementById('filter-price') || document.querySelector('.form-range');
if (priceInput) priceInput.addEventListener('input', () => applyAllFilters());
// Botão "Aplicar" legacy (se existir na página antiga)
const applyBtn = document.querySelector(".filter-sidebar .btn-primary");
if (applyBtn) applyBtn.addEventListener("click", () => applyAllFilters());

document.addEventListener("DOMContentLoaded", () => {
    // 1. Carregamos o Carrossel (independente da página/pesquisa)
    const novidades = products.slice(0, 15);
    renderTo("carousel-novidades", novidades);

    // 2. Pegamos os parâmetros da URL
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = urlParams.get('query');
    const catAlvo = urlParams.get('cat');
    const subAlvo = urlParams.get('sub');

    // --- PRIORIDADE 1: PESQUISA ---
    if (searchQuery) {
        const termo = searchQuery.toLowerCase().trim();
        const resultados = products.filter(p => p.name.toLowerCase().includes(termo));

        // 1. ESCONDER O CARROSSEL DE NOVIDADES (Para não veres a PS5, etc.)
        const carouselSection = document.querySelector('.py-4.overflow-hidden.border-bottom');
        if (carouselSection) {
            carouselSection.style.display = 'none'; 
        }

        // 2. Ativar a Tab "Todos"
        const tabAllEl = document.querySelector('#nav-all-tab');
        if (tabAllEl) {
            bootstrap.Tab.getOrCreateInstance(tabAllEl).show();
        }

        // 3. Limpar e Renderizar
        document.querySelectorAll('.tab-pane .row').forEach(grid => grid.innerHTML = '');
        
        if (resultados.length > 0) {
            renderTo("grid-all", resultados);
            const title = document.querySelector("#nav-all .section-title");
            if(title) title.innerText = `Resultados para: "${searchQuery}"`;
        } else {
            document.getElementById("grid-all").innerHTML = `<div class="col-12 text-center py-5"><p>Sem resultados para "${searchQuery}"</p></div>`;
        }
        
        renderSubFilters('all');
        return; 
    }

    // --- PRIORIDADE 2: CATEGORIA VINDA DE FORA ---
    if (catAlvo && catAlvo !== 'all') {
        const tabEl = document.querySelector(`[data-bs-target="#nav-${catAlvo}"]`);
        if (tabEl) {
            bootstrap.Tab.getOrCreateInstance(tabEl).show();
        }
        
        renderSubFilters(catAlvo);
        renderCategory(catAlvo);

        if (subAlvo) {
            setTimeout(() => {
                const btn = Array.from(document.querySelectorAll('#sub-filter-container button'))
                                 .find(b => b.innerText === subAlvo);
                if (btn) filterBySub(catAlvo, subAlvo, btn);
            }, 250);
        }
    } 
    // --- PRIORIDADE 3: CARREGAMENTO NORMAL (PÁGINA INICIAL) ---
    else {
        renderTo("grid-all", products);
        renderSubFilters('all');
    }
});

// --- Corrigir o evento de clique nas Tabs ---
document.querySelectorAll("#nav-tab .nav-link").forEach(tab => {
  tab.addEventListener("shown.bs.tab", (event) => {
    // Pegar o ID da categoria destino (ex: nav-gaming -> gaming)
    const targetId = event.target.getAttribute('data-bs-target').replace('#nav-', '');
    
    // 1. Limpar e renderizar novos sub-filtros
    renderSubFilters(targetId);
    
    // 2. Renderizar os produtos da categoria
    if (targetId === 'all') {
        renderTo("grid-all", products);
    } else {
        renderCategory(targetId);
    }

    // 3. (Opcional) Simular clique no filtro de preço se o tiveres
    const filterBtn = document.querySelector(".filter-sidebar .btn-primary");
    if (filterBtn) filterBtn.click();
    // Dentro do tab.addEventListener("shown.bs.tab", ...)
    // Substitui o filterBtn.click() por:
    applyAllFilters();
  });
});

document.addEventListener('click', function(e) {
    // Ignorar cliques em botões/inputs/links internos do card (wishlist, etc.)
    if (e.target.closest('.btn-wishlist, button, a[href]:not([href="#"])')) return;

    const card = e.target.closest('.product-item, .transition-hover');
    if (!card) return;

    const titleEl = card.querySelector('.product-title, h3');
    if (!titleEl) return;
    const productName = titleEl.innerText;
    const productData = products.find(p => p.name === productName);
    if (productData) {
        localStorage.setItem('selectedProduct', JSON.stringify(productData));
        window.location.href = 'single-product.html';
    }
});