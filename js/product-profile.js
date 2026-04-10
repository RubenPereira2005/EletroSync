/**
 * product-profile.js — carrega dinamicamente um produto a partir de ?id=
 */

(function () {
  'use strict';

  const STORE_LABEL = {
    worten:       'Worten',
    fnac:         'Fnac',
    radiopopular: 'Rádio Popular',
    pcdiga:       'PC Diga',
  };

  const STORE_SEARCH = {
    worten:       name => `https://www.worten.pt/pesquisa?q=${encodeURIComponent(name)}`,
    fnac:         name => `https://www.fnac.pt/SearchResult/ResultList.aspx?Search=${encodeURIComponent(name)}`,
    radiopopular: name => `https://www.radiopopular.pt/pesquisa?q=${encodeURIComponent(name)}`,
    pcdiga:       name => `https://www.pcdiga.com/catalogsearch/result/?q=${encodeURIComponent(name)}`,
  };

  const CATEGORY_IMG = {
    'eletrodomesticos': 'images/frigo.png',
    'informatica':      'images/pctorre.png',
    'smartphones':      'images/airpods.png',
    'imagem-e-som':     'images/tele.png',
    'gaming':           'images/comando.png',
  };

  const CATEGORY_LABEL = {
    'eletrodomesticos': 'Eletrodomésticos',
    'informatica':      'Informática',
    'smartphones':      'Smartphones e Acessórios',
    'imagem-e-som':     'Imagem e Som',
    'gaming':           'Gaming',
  };

  const CATEGORY_DESC = {
    'eletrodomesticos': 'eletrodoméstico',
    'informatica':      'produto de informática',
    'smartphones':      'smartphone / acessório',
    'imagem-e-som':     'produto de imagem e som',
    'gaming':           'produto de gaming',
  };

  function storeSearchUrl(p) {
    const builder = STORE_SEARCH[p.store];
    return builder ? builder(p.name) : '#';
  }

  function buildStars(rating) {
    const full  = Math.floor(rating);
    const half  = rating % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    let html = '';
    const solid   = '<svg width="18" height="18"><use xlink:href="#star-solid"></use></svg>';
    const outline = '<svg width="18" height="18"><use xlink:href="#star-outline"></use></svg>';
    for (let i = 0; i < full;  i++) html += solid;
    if (half) html += `<svg width="18" height="18" style="opacity:.5"><use xlink:href="#star-solid"></use></svg>`;
    for (let i = 0; i < empty; i++) html += outline;
    return html;
  }

  function setImage(src, fallback) {
    const mainImg = document.getElementById('mainProductImage');
    if (!mainImg) return;
    mainImg.src = src;
    mainImg.onerror = function () { this.onerror = null; this.src = fallback; };
  }

  function buildDescription(p, storeName) {
    const catDesc = CATEGORY_DESC[p.category] || 'produto';
    const discount = p.originalPrice
      ? ` Poupas ${(p.originalPrice - p.price).toFixed(2)}€ em relação ao preço original de ${p.originalPrice.toFixed(2)}€.`
      : '';
    return `<p>${p.name} é um ${catDesc} disponível na ${storeName} pelo preço de <strong>${p.price.toFixed(2)}€</strong>.${discount}</p>`
         + `<p>Clica em <em>Ver na ${storeName}</em> para consultar todos os detalhes, especificações técnicas e disponibilidade de stock diretamente na loja.</p>`;
  }

  function populate(p) {
    const storeName = STORE_LABEL[p.store] || p.store;
    const catLabel  = CATEGORY_LABEL[p.category] || p.category;
    const fallback  = CATEGORY_IMG[p.category] || 'images/frigo.png';
    const rawImg    = p.image || '';
    const imgSrc    = rawImg.startsWith('http')
      ? `/api/img?url=${encodeURIComponent(rawImg)}`
      : (rawImg || fallback);

    setImage(imgSrc, fallback);

    setText('pp-name', p.name);
    setText('pp-breadcrumb-name', p.name);
    document.title = `${p.name} — EletroSync`;

    const priceEl = document.getElementById('pp-price');
    if (priceEl) {
      priceEl.innerHTML = p.originalPrice
        ? `<strong>${p.price.toFixed(2)}€</strong> <del class="text-muted fs-5">${p.originalPrice.toFixed(2)}€</del>`
        : `<strong>${p.price.toFixed(2)}€</strong>`;
    }

    const starsEl = document.getElementById('pp-stars');
    if (starsEl) starsEl.innerHTML = buildStars(p.rating);

    setText('pp-store', storeName);
    setText('pp-category', catLabel);
    const catLink = document.getElementById('pp-breadcrumb-cat');
    if (catLink) catLink.textContent = catLabel;

    const descEl = document.getElementById('pp-description');
    if (descEl) descEl.innerHTML = buildDescription(p, storeName);

    const storeLink = document.getElementById('pp-store-link');
    if (storeLink) {
      storeLink.href = storeSearchUrl(p);
      storeLink.textContent = `Ver na ${storeName} →`;
    }

    return { storeName, fallback, storeLink, descEl, imgSrc };
  }

  async function tryRealProductUrl(p, ctx) {
    try {
      const res  = await fetch(`/api/product-url?id=${encodeURIComponent(p.id)}`);
      const data = await res.json();
      if (data.url && ctx.storeLink) {
        ctx.storeLink.href = data.url;
      }
    } catch (e) {
      // Silently ignore — the search URL fallback is already set
    }
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return;

    try {
      const res  = await fetch('/api/products');
      const data = await res.json();
      const product = (data.products || []).find(p => p.id === id);
      if (product) {
        const ctx = populate(product);
        tryRealProductUrl(product, ctx);
      }
    } catch (e) {
      console.error('[product-profile.js] Erro:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
