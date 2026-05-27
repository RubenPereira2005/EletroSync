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

// Aqui vamos guardar os produtos carregados da API
let products = [];

// 1. Mover o mapeamento para FORA do loop
const subMapping = {
    eletrodomesticos: ["Cozinha", "Lavandaria", "Limpeza", "Climatização", "Cuidado pessoal"],
    informatica: ["Portáteis", "Computadores fixos", "Monitores", "Impressoras", "Periféricos"],
    smartphones: ["Smartphones", "Capas e películas", "Carregadores", "Wearables"],
    gaming: ["Consolas", "Jogos", "Comandos", "Cadeiras"],
    imagem: ["TVs", "Barras de som", "Colunas", "Auscultadores"],
    outros: ["Cabos", "Pilhas"]
};

function renderProduct(p) {
    const fallbackImg = FALLBACK_IMG[p.category] || 'images/airpods.png';
    const shopCount = (p.shops || []).length;
    const discountBadge = p.discount
        ? `<span class="product-discount-badge">-${p.discountPercent}%</span>`
        : "";

    let priceHtml = `
      <div>
        <span class="product-price-label">Desde</span>
        <span class="product-price">${parseFloat(p.minPrice).toFixed(2)}€</span>
      </div>
    `;

    if (p.discount && p.oldPrice) {
        priceHtml = `
          <div>
            <span class="product-price-label">Desde</span>
            <div class="d-flex align-items-center gap-2">
                <span class="product-price">${parseFloat(p.minPrice).toFixed(2)}€</span>
                <span class="text-muted text-decoration-line-through" style="font-size:0.85rem;">${p.oldPrice}€</span>
            </div>
          </div>
        `;
    }

    return `
      <div class="col">
        <div class="product-item" data-product-name="${escapeAttr(p.name)}">
          ${discountBadge}
          <button class="product-fav-btn floating-fav" data-product="${escapeAttr(p.name)}" title="Adicionar aos favoritos" aria-label="Favorito">
            <i class="fa-regular fa-heart"></i>
          </button>
          <figure>
            <img src="${p.image}" alt="${escapeAttr(p.name)}" loading="lazy"
                 onerror="this.onerror=null;this.src='${fallbackImg}';">
          </figure>

          <div class="product-info">
            <h3 class="product-title">${p.name}</h3>

            <div class="product-meta">
              ${p.rating ? `<span class="product-rating"><i class="fa-solid fa-star"></i> ${p.rating}</span>` : ''}
              <span class="product-shops-count text-primary" style="cursor: help;" title="Clica para ver preços noutras lojas">
                <i class="fa-solid fa-magnifying-glass-chart"></i> Comparar preços
              </span>
            </div>

            <div class="product-price-row">
              ${priceHtml}
              <span class="product-cta" title="Ver detalhes" aria-hidden="true">
                <i class="fa-solid fa-arrow-right"></i>
              </span>
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

async function initFavoritesUI() {
    try {
        if (!window.Favorites) return;
        const favs = await window.Favorites.getFavorites();
        const favNames = favs.map(f => f.name);
        
        document.querySelectorAll('.product-fav-btn').forEach(btn => {
            const pname = btn.getAttribute('data-product');
            if (favNames.includes(pname)) {
                btn.classList.add('active');
                const icon = btn.querySelector('i');
                icon.classList.replace('fa-regular', 'fa-solid');
            } else {
                btn.classList.remove('active');
                const icon = btn.querySelector('i');
                icon.classList.replace('fa-solid', 'fa-regular');
            }
        });
    } catch (e) { console.error(e); }
}

function emptyStateHtml(opts = {}) {
    const title = opts.title || 'Sem produtos para mostrar';
    const sub   = opts.sub   || 'Tenta ajustar os filtros ou volta mais tarde.';
    const icon  = opts.icon  || 'fa-box-open';
    const cta   = opts.cta   || '';
    return `
        <div class="col-12">
            <div class="text-center py-5">
                <i class="fa-solid ${icon} text-muted mb-3" style="font-size: 2.5rem;"></i>
                <h5 class="text-muted mb-1">${title}</h5>
                <p class="text-muted small mb-3">${sub}</p>
                ${cta}
            </div>
        </div>
    `;
}

// Estado de paginação por container (ex: { 'grid-all': 1, 'grid-gaming': 2 })
const paginationState = {};
const PAGE_SIZE = 16;

function renderPagination(containerId, totalItems) {
    // Procura um container de paginação ao lado do grid (criado dinamicamente)
    const gridEl = document.getElementById(containerId);
    if (!gridEl) return;
    let pagEl = document.getElementById(`pagination-${containerId}`);
    if (!pagEl) {
        pagEl = document.createElement('nav');
        pagEl.id = `pagination-${containerId}`;
        pagEl.className = 'es-pagination';
        pagEl.setAttribute('aria-label', 'Paginação de produtos');
        gridEl.parentNode.insertBefore(pagEl, gridEl.nextSibling);
    }

    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const current = paginationState[containerId] || 1;

    if (totalPages <= 1) { pagEl.innerHTML = ''; return; }

    // Mostra até 5 botões de página em volta do atual, com prev/next
    const buttons = [];
    function pageBtn(p, label, disabled, active) {
        return `<button type="button" class="es-page-btn ${active ? 'active' : ''}" data-page="${p}" ${disabled ? 'disabled' : ''} aria-current="${active ? 'page' : 'false'}">${label}</button>`;
    }

    buttons.push(pageBtn(current - 1, '‹', current === 1, false));

    let start = Math.max(1, current - 2);
    let end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);

    if (start > 1) {
        buttons.push(pageBtn(1, '1', false, false));
        if (start > 2) buttons.push('<span class="es-page-ellipsis">…</span>');
    }
    for (let p = start; p <= end; p++) {
        buttons.push(pageBtn(p, String(p), false, p === current));
    }
    if (end < totalPages) {
        if (end < totalPages - 1) buttons.push('<span class="es-page-ellipsis">…</span>');
        buttons.push(pageBtn(totalPages, String(totalPages), false, false));
    }

    buttons.push(pageBtn(current + 1, '›', current === totalPages, false));

    pagEl.innerHTML = buttons.join('');
}

function renderTo(containerId, list, emptyOpts) {
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
            initFavoritesUI();
        }, 100);
    } else {
        container.className = "row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xl-4 g-3 pt-4 pb-5";
        container.removeAttribute('aria-busy');

        if (!list || list.length === 0) {
            container.innerHTML = emptyStateHtml(emptyOpts);
            // Limpar paginação se não há resultados
            const pagEl = document.getElementById(`pagination-${containerId}`);
            if (pagEl) pagEl.innerHTML = '';
            return;
        }

        // Aplicar paginação
        const page = paginationState[containerId] || 1;
        const startIdx = (page - 1) * PAGE_SIZE;
        const visible = list.slice(startIdx, startIdx + PAGE_SIZE);

        container.innerHTML = visible.map(renderProduct).join("");
        setTimeout(initFavoritesUI, 50);
        renderPagination(containerId, list.length);
    }
}

// Click handler global para os botões de paginação
document.addEventListener('click', function (e) {
    const btn = e.target.closest('.es-page-btn');
    if (!btn || btn.disabled) return;
    const page = parseInt(btn.dataset.page, 10);
    if (!Number.isFinite(page) || page < 1) return;

    const pagEl = btn.closest('[id^="pagination-"]');
    if (!pagEl) return;
    const containerId = pagEl.id.replace('pagination-', '');
    paginationState[containerId] = page;

    // Re-renderizar com a página nova - usar a lista atual filtrada
    // (chamamos applyAllFilters que já tem a lógica completa)
    if (typeof applyAllFilters === 'function') {
        applyAllFilters();
        // Scroll para o topo do grid
        const gridEl = document.getElementById(containerId);
        if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
});

// Sempre que se mudam filtros (sort, store, categoria), voltar à página 1
function resetPagination(containerId) {
    paginationState[containerId] = 1;
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

  renderTo(`grid-${categoryKey}`, sortProducts(filtered), {
    icon: 'fa-filter-circle-xmark',
    title: 'Sem produtos nesta categoria com os filtros atuais',
    sub: 'Aumenta o intervalo de preço ou desativa filtros para ver mais resultados.',
  });
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
    let catKey = categoryTarget;

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

    // Cada valor do filtro tem uma regex que apanha qualquer variante do nome da loja
    // (FNAC, Fnac, fnac.pt, etc.) - é mais robusto que comparação exata por string.
    const storePatterns = {
        worten:       /worten/i,
        fnac:         /fnac/i,
        radiopopular: /r[aá]dio\s*popular|radiopopular/i,
        pcdiga:       /pc\s*diga|pcdiga/i,
    };
    const selectedStoreValues = Array.from(document.querySelectorAll('.store-filter:checked')).map(cb => cb.value);

    // 4. Filtragem Cruzada
    const filtered = products.filter(p => {
        const matchCategory = (categoryTarget === "all") || (p.category === catKey);
        const matchSub = (!activeSub || activeSub === "null") ? true : (p.subcategory === activeSub);
        const matchPrice = parseFloat(p.minPrice) <= maxPrice;

        const matchStore = selectedStoreValues.length === 0
            ? true
            : selectedStoreValues.some(v => {
                const pat = storePatterns[v];
                if (!pat) return false;
                return (p.shops || []).some(s => pat.test(s.name || ''));
            });

        return matchCategory && matchSub && matchPrice && matchStore;
    });

    renderTo(`grid-${categoryTarget}`, sortProducts(filtered), {
        icon: 'fa-filter-circle-xmark',
        title: 'Nenhum produto bate certo com estes filtros',
        sub: 'Tenta aumentar o preço máximo, escolher outras lojas ou limpar a subcategoria.',
    });
}

function filterBySub(cat, sub, btnElement) {
    // Apenas gere o visual dos botões
    const buttons = document.querySelectorAll('#sub-filter-container .btn-sub');
    buttons.forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');

    // Atualizar breadcrumb com a subcategoria selecionada
    updateBreadcrumbAndTitle({ category: cat, sub: sub === 'null' ? null : sub });

    // Chama a filtragem mestre passando a subcategoria clicada
    applyAllFilters(sub);
}

// Ordenação: aplica o sort escolhido ao array de produtos (cópia, não muta)
function sortProducts(list) {
    const sel = document.getElementById('sort-select');
    const mode = sel ? sel.value : 'relevance';
    if (!mode || mode === 'relevance') return list;
    const sorted = [...list];
    switch (mode) {
        case 'price-asc':
            sorted.sort((a, b) => parseFloat(a.minPrice || 0) - parseFloat(b.minPrice || 0));
            break;
        case 'price-desc':
            sorted.sort((a, b) => parseFloat(b.minPrice || 0) - parseFloat(a.minPrice || 0));
            break;
        case 'name-asc':
            sorted.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'));
            break;
    }
    return sorted;
}

// Filtros: reagir a mudanças nos controlos (sem botão "Aplicar")
// Sempre que um filtro muda, voltamos à página 1 (caso contrário ficamos a olhar
// para uma página vazia quando o conjunto filtrado é menor que a página atual).
function resetAllPagination() {
    Object.keys(paginationState).forEach(k => { paginationState[k] = 1; });
}
document.querySelectorAll('.store-filter').forEach(cb => cb.addEventListener('change', () => { resetAllPagination(); applyAllFilters(); }));
const priceInput = document.getElementById('filter-price') || document.querySelector('.form-range');
if (priceInput) priceInput.addEventListener('input', () => { resetAllPagination(); applyAllFilters(); });
const sortSelect = document.getElementById('sort-select');
if (sortSelect) sortSelect.addEventListener('change', () => { resetAllPagination(); applyAllFilters(); });
// Botão "Aplicar" legacy (se existir na página antiga)
const applyBtn = document.querySelector(".filter-sidebar .btn-primary");
if (applyBtn) applyBtn.addEventListener("click", () => applyAllFilters());

function showLoadingInGrids() {
    // Skeleton card: imagem + título + preço, todos com animação shimmer
    const skeletonCard = `
        <div class="col">
            <div class="product-skeleton" aria-hidden="true">
                <div class="product-skeleton-img"></div>
                <div class="product-skeleton-line product-skeleton-line-lg"></div>
                <div class="product-skeleton-line product-skeleton-line-sm"></div>
                <div class="product-skeleton-line product-skeleton-line-price"></div>
            </div>
        </div>
    `;
    const skeletonHtml = Array.from({ length: 8 }, () => skeletonCard).join('');

    document.querySelectorAll('[id^="grid-"]').forEach(el => {
        el.className = 'row row-cols-1 row-cols-sm-2 row-cols-lg-3 row-cols-xl-4 g-3 pt-4 pb-5';
        el.setAttribute('aria-busy', 'true');
        el.innerHTML = skeletonHtml;
    });
}

// Labels amigáveis das categorias (chave → texto para humano)
const CATEGORY_LABELS = {
    eletrodomesticos: 'Eletrodomésticos',
    informatica:      'Informática',
    smartphones:      'Smartphones',
    gaming:           'Gaming',
    imagem:           'Imagem e Som',
    outros:           'Outros',
};

function updateBreadcrumbAndTitle({ category, sub, query } = {}) {
    const list  = document.getElementById('breadcrumbList');
    const title = document.getElementById('pageHeaderTitle');
    const subEl = document.getElementById('pageHeaderSub');
    if (!list || !title) return;

    const crumbs = [{ label: 'Início', href: 'index.html' }];

    if (query) {
        crumbs.push({ label: `Pesquisa: "${query}"` });
        title.textContent = `Resultados para "${query}"`;
        if (subEl) subEl.textContent = 'Compara os melhores resultados nas lojas portuguesas.';
    } else if (category && CATEGORY_LABELS[category]) {
        crumbs.push({ label: CATEGORY_LABELS[category], href: `product.html?cat=${category}` });
        if (sub) {
            crumbs[crumbs.length - 1] = { label: CATEGORY_LABELS[category], href: `product.html?cat=${category}` };
            crumbs.push({ label: sub });
            title.textContent = `${CATEGORY_LABELS[category]} · ${sub}`;
        } else {
            title.textContent = CATEGORY_LABELS[category];
        }
        if (subEl) subEl.textContent = `Compara preços de ${CATEGORY_LABELS[category].toLowerCase()} nas melhores lojas.`;
    } else {
        crumbs.push({ label: 'Todos os produtos' });
        title.textContent = 'Todos os produtos';
        if (subEl) subEl.textContent = 'Compara preços em tempo real nas melhores lojas portuguesas.';
    }

    list.innerHTML = crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        const safe = String(c.label).replace(/[<>"]/g, '');
        if (isLast || !c.href) return `<li aria-current="page">${safe}</li>`;
        return `<li><a href="${c.href}">${safe}</a></li>`;
    }).join('');
}

document.addEventListener("DOMContentLoaded", async () => {
    // 0. CARREGAR PRODUTOS DA API SERPER
    showLoadingInGrids();

    // Breadcrumb inicial conforme parâmetros da URL
    const initialParams = new URLSearchParams(window.location.search);
    updateBreadcrumbAndTitle({
        category: initialParams.get('cat'),
        sub: initialParams.get('sub'),
        query: initialParams.get('query'),
    });
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const searchQuery = urlParams.get('query');

        let endpoint = '/api/products/all';
        if (searchQuery) {
            endpoint = `/api/products/search?q=${encodeURIComponent(searchQuery)}`;
        }

        const res = await (window.fetchWithTimeout || fetch)(endpoint);
        const data = await res.json();
        products = data.products || [];
    } catch (err) {
        console.error("Erro ao carregar produtos:", err);
        products = [];
    }

    // Se não veio nada, mostrar estado de erro
    if (products.length === 0) {
        document.querySelectorAll('[id^="grid-"]').forEach(el => {
            el.innerHTML = `
                <div class="col-12">
                    <div class="text-center py-5">
                        <i class="fa-solid fa-circle-exclamation text-muted mb-3" style="font-size: 2.5rem;"></i>
                        <h5 class="text-muted">Não conseguimos carregar os produtos agora</h5>
                        <p class="text-muted small">Tenta atualizar a página dentro de alguns segundos.</p>
                    </div>
                </div>
            `;
        });
        return;
    }

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
        // Como a pesquisa já foi feita no Google Shopping, todos os produtos retornados são o resultado
        const resultados = products;

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
            renderTo("grid-all", sortProducts(resultados));
            const title = document.querySelector("#nav-all .section-title");
            if(title) title.innerText = `Resultados para: "${searchQuery}"`;
        } else {
            const safeQuery = String(searchQuery).replace(/[<>"]/g, '');
            renderTo("grid-all", [], {
                icon: 'fa-magnifying-glass',
                title: `Sem resultados para "${safeQuery}"`,
                sub: 'Tenta uma pesquisa mais curta ou com termos diferentes. Por exemplo: a marca ou o modelo.',
                cta: '<a href="product.html" class="es-btn es-btn-secondary">Ver todos os produtos</a>',
            });
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
        renderTo("grid-all", sortProducts(products));
        renderSubFilters('all');
    }
});

// --- Corrigir o evento de clique nas Tabs ---
document.querySelectorAll("#nav-tab .nav-link").forEach(tab => {
  tab.addEventListener("shown.bs.tab", (event) => {
    // Pegar o ID da categoria destino (ex: nav-gaming -> gaming)
    const targetId = event.target.getAttribute('data-bs-target').replace('#nav-', '');

    // 0. Atualizar breadcrumb
    updateBreadcrumbAndTitle({ category: targetId === 'all' ? null : targetId });

    // 1. Limpar e renderizar novos sub-filtros
    renderSubFilters(targetId);

    // 2. Renderizar os produtos da categoria
    if (targetId === 'all') {
        renderTo("grid-all", sortProducts(products));
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
    // Ignorar cliques em botões interativos dentro do card (favoritos, etc.)
    if (e.target.closest('.product-fav-btn, .btn-wishlist, a[href]:not([href="#"])')) return;

    const card = e.target.closest('.product-item, .transition-hover');
    if (!card) return;

    // Identificar produto pelo data attribute (mais fiável do que innerText)
    const productName = card.getAttribute('data-product-name')
        || card.querySelector('.product-title, h3')?.innerText;
    if (!productName) return;

    const productData = products.find(p => p.name === productName);
    if (productData) {
        localStorage.setItem('selectedProduct', JSON.stringify(productData));
        const slug = window.slugifyProductName ? window.slugifyProductName(productData.name) : '';
        window.location.href = slug ? `single-product.html?p=${slug}` : 'single-product.html';
    }
});

// Listener para o botão de favorito nos cards
document.addEventListener('click', async function(e) {
    const favBtn = e.target.closest('.product-fav-btn');
    if (favBtn) {
        e.preventDefault();
        e.stopPropagation();
        
        const productName = favBtn.getAttribute('data-product');
        const icon = favBtn.querySelector('i');
        const isAdding = icon.classList.contains('fa-regular');
        
        if (isAdding && window.Favorites && !window.Favorites.isLoggedIn()) {
            if (window.Favorites.showAuthPopup) window.Favorites.showAuthPopup();
            return;
        }

        // Pequena animação
        icon.classList.add('heart-beat');
        setTimeout(() => icon.classList.remove('heart-beat'), 300);

        if (isAdding) {
            icon.classList.replace('fa-regular', 'fa-solid');
            favBtn.classList.add('active');
            
            // Procurar dados do produto
            const productData = products.find(p => p.name === productName);
            if (productData && window.Favorites) {
                await window.Favorites.addFavorite(productData);
            }
        } else {
            icon.classList.replace('fa-solid', 'fa-regular');
            favBtn.classList.remove('active');
            if (window.Favorites) {
                await window.Favorites.removeFavorite(productName);
            }
        }
    }
});