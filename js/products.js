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

// 2. Gerar 24 produtos aleatórios respeitando a categoria
const products = Array.from({ length: 24 }, () => {
  const cat = categories[Math.floor(Math.random() * categories.length)];
  const items = catalog[cat];
  const selected = items[Math.floor(Math.random() * items.length)];

  return {
    name: selected.name,
    image: selected.image,
    category: cat,
    price: (Math.random() * 1200 + 50).toFixed(2),
    rating: (Math.random() * 1 + 4).toFixed(1),
    discount: Math.random() > 0.7
  };
});

// 3. Funções de Renderização
function renderProduct(p) {
  return `
    <div class="col">
      <div class="product-item h-100 border p-3 position-relative">
        ${p.discount ? `<span class="badge bg-success position-absolute m-2" style="top:0; left:0; z-index:10;">-30%</span>` : ""}
        <a href="#" class="btn-wishlist position-absolute m-2" style="top:0; right:0; z-index:10;">
          <svg width="20" height="20"><use xlink:href="#heart"></use></svg>
        </a>
        <figure class="text-center">
          <img src="${p.image}" class="img-fluid mb-3" style="max-height: 150px; object-fit: contain;">
        </figure>
        <h3 class="fs-6 text-dark">${p.name}</h3>
        <span class="qty d-block small text-muted">1 Unidade</span>
        <div class="d-flex align-items-center gap-1 my-2">
           <svg width="16" height="16" class="text-primary"><use xlink:href="#star-solid"></use></svg>
           <span class="small">${p.rating}</span>
        </div>
        <span class="price d-block fw-bold text-primary">${p.price}€</span>
      </div>
    </div>
  `;
}

function renderTo(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Garante as classes de grid do Bootstrap
  container.className = "row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 row-cols-xl-5 g-4 pt-4";
  container.innerHTML = list.length > 0 ? list.map(renderProduct).join("") : '<p class="col-12 text-center">Nenhum produto encontrado.</p>';
}

function renderCategory(categoryKey) {
  const rangeInput = document.querySelector(".form-range");
  const maxPrice = rangeInput ? parseFloat(rangeInput.value) : 2000;
  
  const filtered = products.filter(p => {
    const matchCategory = p.category.toLowerCase() === categoryKey.toLowerCase();
    const matchPrice = parseFloat(p.price) <= maxPrice;
    return matchCategory && matchPrice;
  });

  renderTo(`grid-${categoryKey}`, filtered);
}

// 4. Eventos
// Clique nas Tabs (Abas)
document.querySelectorAll("#nav-tab .nav-link").forEach(tab => {
  tab.addEventListener("shown.bs.tab", (e) => {
    const target = e.target.getAttribute("data-bs-target");
    const category = target.replace("#nav-", "");
    
    if (category === "all") {
       renderTo("grid-all", products);
    } else {
       // Mapeamento especial se os IDs forem diferentes das chaves do catálogo
       let catKey = category;
       if (category === "jogos") catKey = "gaming";
       if (category === "outros") catKey = "outros"; // Garante que lê 'outros'
       
       renderCategory(catKey);
    }
  });
});

// Botão Aplicar Filtros
document.querySelector(".filter-sidebar .btn-primary").addEventListener("click", () => {
  const activeTab = document.querySelector(".nav-link.active");
  const category = activeTab.getAttribute("data-bs-target").replace("#nav-", "");
  const maxPrice = parseFloat(document.querySelector(".form-range").value);

  if (category === "all") {
    const filtered = products.filter(p => parseFloat(p.price) <= maxPrice);
    renderTo("grid-all", filtered);
  } else {
    const catKey = (category === "jogos") ? "gaming" : category;
    renderCategory(catKey);
  }
});

// Inicialização
window.addEventListener("DOMContentLoaded", () => {
  renderTo("grid-all", products);
});