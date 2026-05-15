const express = require('express');
const router = express.Router();

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_URL = 'https://google.serper.dev/shopping';

// ==========================================
// 1. SISTEMA DE CACHE (Em memória)
// ==========================================
// Isto vai guardar os resultados das pesquisas durante 24h
// Assim, mesmo que a página seja atualizada 100 vezes, só gasta 1 crédito!
// Cache ativada novamente para não pesquisar sempre que mudas de página!
// Vamos usar um TTL longo para que a pesquisa pesada seja feita apenas 1 vez por sessão.
const cache = {};
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 horas

function getCached(key) {
    if (cache[key] && (Date.now() - cache[key].timestamp < CACHE_TTL)) {
        return cache[key].data;
    }
    return null;
}

function setCache(key, data) {
    cache[key] = { data, timestamp: Date.now() };
}

// ==========================================
// 2. CONFIGURAÇÕES
// ==========================================

// Apenas lojas de confiança a operar em Portugal
const ALLOWED_STORES = [
    'worten', 'fnac', 'radio popular', 'rádio popular', 'darty',
    'pc diga', 'pcdiga', 'amazon', 'el corte', 'auchan',
    'continente', 'castro', 'pccomponentes', 'globaldata', 'novo atalho', 'staples'
];

function isStoreAllowed(storeName) {
    if (!storeName) return false;
    const nameLower = storeName.toLowerCase();
    return ALLOWED_STORES.some(allowed => nameLower.includes(allowed));
}
// Mapeamento exato de cada pesquisa para a sua Categoria e Subcategoria
const CATEGORY_QUERIES = [
    { cat: 'eletrodomesticos', sub: 'Cozinha', query: 'frigorífico bosch' },
    { cat: 'eletrodomesticos', sub: 'Lavandaria', query: 'máquina lavar roupa' },
    { cat: 'eletrodomesticos', sub: 'Limpeza', query: 'aspirador robot' },
    { cat: 'informatica', sub: 'Portáteis', query: 'portátil asus' },
    { cat: 'informatica', sub: 'Computadores fixos', query: 'pc desktop gaming' },
    { cat: 'informatica', sub: 'Periféricos', query: 'rato logitech' },
    { cat: 'smartphones', sub: 'Smartphones', query: 'iphone 15' },
    { cat: 'smartphones', sub: 'Smartphones', query: 'samsung galaxy' },
    { cat: 'smartphones', sub: 'Wearables', query: 'apple watch' },
    { cat: 'gaming', sub: 'Consolas', query: 'playstation 5' },
    { cat: 'gaming', sub: 'Comandos', query: 'comando xbox' },
    { cat: 'imagem', sub: 'TVs', query: 'smart tv samsung 4k' },
    { cat: 'imagem', sub: 'Barras de som', query: 'soundbar lg' },
    { cat: 'outros', sub: 'Cabos', query: 'cabo hdmi 2.1' }
];

function getStoreDirectLink(storeName, productName, googleLink) {
    // Se o link for direto (não google), usamos.
    if (googleLink && !googleLink.includes('google.com/search')) {
        return googleLink;
    }
    // Se a Google escondeu o link (oshop), geramos o link de pesquisa direto na loja
    const storeSearchUrls = {
        'worten': 'https://www.worten.pt/search?query=',
        'fnac': 'https://www.fnac.pt/SearchResult/ResultList.aspx?Search=',
        'radio popular': 'https://www.radiopopular.pt/pesquisa/',
        'rádio popular': 'https://www.radiopopular.pt/pesquisa/',
        'mediamarkt': 'https://mediamarkt.pt/search?q=',
        'pc diga': 'https://www.pcdiga.com/search?query=',
        'amazon': 'https://www.amazon.es/s?k=',
    };

    const url = storeSearchUrls[storeName.toLowerCase()];
    if (url) {
        return url + encodeURIComponent(productName);
    }
    return googleLink || '#';
}

function normalizeProduct(item, category) {
    const priceRaw = item.price || '0';
    const priceNum = parseFloat(priceRaw.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;

    const storeName = item.source || 'Loja Online';

    const shops = [{
        name: storeName,
        price: priceNum.toFixed(2),
        link: getStoreDirectLink(storeName, item.title, item.link)
    }];

    // Extrair desconto real: Procurar se a API fornece oldPrice ou se há menção de desconto no título/descrição
    let hasDiscount = false;
    let discountPercent = 0;
    let oldPrice = null;

    // 1. Tentar ler oldPrice diretamente (se a API alguma vez fornecer)
    if (item.oldPrice) {
        const oldRaw = parseFloat(item.oldPrice.replace(/[^0-9.,]/g, '').replace(',', '.'));
        if (oldRaw > priceNum) {
            hasDiscount = true;
            oldPrice = oldRaw;
            discountPercent = Math.round(((oldRaw - priceNum) / oldRaw) * 100);
        }
    }

    // 2. Tentar encontrar indicações de texto ("-20%", "Desconto de 15%", "Promoção 25%")
    if (!hasDiscount && priceNum > 0) {
        const textToSearch = `${item.title} ${item.snippet || ''} ${item.description || ''}`.toLowerCase();
        const promoRegex = /(?:promoção|desconto|poupança).{0,10}?(\d{1,2})%|-(\d{1,2})%/i;
        const match = textToSearch.match(promoRegex);

        if (match) {
            discountPercent = parseInt(match[1] || match[2], 10);
            if (discountPercent > 0 && discountPercent < 90) {
                hasDiscount = true;
                oldPrice = priceNum / (1 - (discountPercent / 100));
            }
        }
    }

    return {
        id: item.productId || `${item.title}-${Date.now()}`,
        name: item.title || 'Produto sem nome',
        image: item.imageUrl || '',
        category: category,
        subcategory: item.assignedSubcategory || 'Geral', // Usa a subcategoria atribuída ou 'Geral'
        rating: item.rating ? parseFloat(item.rating).toFixed(1) : (4 + Math.random()).toFixed(1),
        description: item.snippet || item.description || `Compara preços deste produto nas lojas parceiras e compra onde for mais barato. Abaixo encontras todas as lojas que têm este produto em stock, ordenadas pelo preço mais baixo.`,
        discount: hasDiscount,
        discountPercent: discountPercent,
        oldPrice: oldPrice ? oldPrice.toFixed(2) : null,
        eventX: false,
        shops: shops,
        minPrice: shops[0].price,
        source: 'serper'
    };
}

// ==========================================
// 3. ROTAS DA API
// ==========================================

// GET /api/products/search - Pesquisa direta no Google Shopping
router.get('/search', async (req, res) => {
    const { q, cat = 'todos', gl = 'pt', hl = 'pt' } = req.query;

    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY não configurada' });
    if (!q) return res.status(400).json({ error: 'Parâmetro "q" obrigatório' });

    // Tentar ir buscar à Cache primeiro
    const cacheKey = `search_${q}_${gl}`;
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        console.log(`[Serper] A fazer pesquisa real no Google por: ${q} (1 crédito)`);
        const response = await fetch(SERPER_URL, {
            method: 'POST',
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q, gl, hl, num: 20 })
        });

        if (!response.ok) return res.status(response.status).json({ error: `Serper error: ${response.status}` });

        const data = await response.json();
        const products = (data.shopping || [])
            .filter(item => isStoreAllowed(item.source))
            .map(item => normalizeProduct(item, cat));

        const result = { products, total: products.length, query: q };

        // Guardar na Cache!
        setCache(cacheKey, result);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/products/all - Pega produtos de todas as categorias para preencher a loja inicial
router.get('/all', async (req, res) => {
    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY não configurada' });

    // Tentar ir buscar à Cache!
    const cacheKey = `all_products`;
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        console.log(`[Serper] A carregar todo o catálogo base... (A executar ${CATEGORY_QUERIES.length} pesquisas em paralelo)`);
        const allProducts = [];

        // Fazer as pesquisas em paralelo para ser muito rápido!
        const fetchPromises = CATEGORY_QUERIES.map(async (qObj) => {
            try {
                const response = await fetch(SERPER_URL, {
                    method: 'POST',
                    headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: qObj.query, gl: 'pt', hl: 'pt', num: 10 }) // max 10 por tag
                });

                if (!response.ok) return [];

                const data = await response.json();
                return (data.shopping || [])
                    .filter(item => isStoreAllowed(item.source))
                    .map(item => {
                        // Injetar a subcategoria correta ANTES de normalizar
                        item.assignedSubcategory = qObj.sub;
                        return normalizeProduct(item, qObj.cat);
                    });
            } catch (e) {
                return [];
            }
        });

        // Esperar por todas as pesquisas
        const results = await Promise.all(fetchPromises);

        // Juntar tudo num único array
        results.forEach(items => allProducts.push(...items));

        // Misturar array aleatoriamente
        allProducts.sort(() => 0.5 - Math.random());

        const result = { products: allProducts, total: allProducts.length };

        // SÓ GUARDAR NA CACHE SE CONSEGUIU CARREGAR PRODUTOS (Para evitar cache de erros)
        if (allProducts.length > 0) {
            setCache(cacheKey, result);
        } else {
            console.error("[Serper] Atenção: Nenhum produto carregado. Verifica a tua API Key!");
        }
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/products/compare - Procura várias ofertas para o mesmo produto no Google Shopping
router.get('/compare', async (req, res) => {
    const { q, gl = 'pt', hl = 'pt' } = req.query;

    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY não configurada' });
    if (!q) return res.status(400).json({ error: 'Parâmetro "q" obrigatório' });

    const cacheKey = `compare_${q}_${gl}`;
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        console.log(`[Serper] A procurar preços REAIS noutras lojas para: ${q}`);
        const response = await fetch(SERPER_URL, {
            method: 'POST',
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q, gl, hl, num: 20 })
        });

        if (!response.ok) return res.status(response.status).json({ error: `Serper error: ${response.status}` });

        const data = await response.json();

        const shops = [];
        const seenStores = new Set();

        (data.shopping || []).forEach(item => {
            const storeName = item.source || 'Loja Online';

            // Queremos apenas o melhor preço de cada loja aprovada
            if (isStoreAllowed(storeName) && !seenStores.has(storeName)) {
                seenStores.add(storeName);

                const priceRaw = item.price || '0';
                const priceNum = parseFloat(priceRaw.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;

                if (priceNum > 0) {
                    shops.push({
                        name: storeName,
                        price: priceNum.toFixed(2),
                        link: getStoreDirectLink(storeName, q, item.link)
                    });
                }
            }
        });

        // Ordenar as lojas da mais barata para a mais cara
        shops.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

        const result = { shops };

        // Cachear este resultado para poupar pesquisas!
        if (shops.length > 0) {
            setCache(cacheKey, result);
        }

        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/products/details - Procura descrições e especificações orgânicas
router.get('/details', async (req, res) => {
    const { q } = req.query;
    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY em falta' });
    if (!q) return res.status(400).json({ error: 'Falta parâmetro q' });

    const cacheKey = `details_${q}`;
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        console.log(`[Serper] A procurar especificações reais para: ${q}`);
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: `${q} características especificações técnicas`, gl: 'pt', hl: 'pt', num: 3 })
        });

        if (!response.ok) return res.status(500).json({ error: 'Erro no Serper' });

        const data = await response.json();
        let description = '';
        let specs = [];

        // Tentar extrair do Answer Box (Featured Snippet) ou Knowledge Graph
        if (data.answerBox && data.answerBox.snippet) {
            description = data.answerBox.snippet;
        } else if (data.knowledgeGraph && data.knowledgeGraph.description) {
            description = data.knowledgeGraph.description;
        } else if (data.organic && data.organic.length > 0) {
            description = data.organic[0].snippet;
        }

        // Tentar extrair lista de características
        if (data.answerBox && data.answerBox.list) {
            specs = data.answerBox.list;
        } else if (data.organic && data.organic.length > 1) {
            // Dividir o snippet em pontos para criar uma lista artificial de specs
            specs = data.organic[1].snippet.split(/[\.·-]/)
                .map(s => s.trim())
                .filter(s => s.length > 10 && s.length < 100);
        }

        if (description) {
            description = description.replace(/[\n\r]/g, ' ').replace(/\s{2,}/g, ' ');
        }

        const result = {
            description: description || null,
            specs: specs.slice(0, 5) || [] // Máximo 5 características
        };

        setCache(cacheKey, result);
        return res.json(result);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

module.exports = router;
