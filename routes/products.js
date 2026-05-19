const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { resolveProductUrl, fetchLivePrice } = require('./store-scraper');

// =============================================================================
// RATE LIMITING — protege contra abuso e esgotamento de créditos Serper
// =============================================================================
// Limites por IP. Como a cache cobre a maioria dos requests, estes limites são
// generosos para utilizadores normais mas bloqueiam scripts maliciosos.

// Skip rate limit para chamadas internas (auto-refresh chama /all em loopback)
function isInternalCall(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

// Limit "leve" para endpoints que costumam vir da cache (/all, /cache-status)
const lightLimiter = rateLimit({
    windowMs: 60 * 1000,       // 1 minuto
    max: 60,                   // 60 requests/min/IP
    standardHeaders: true,
    legacyHeaders: false,
    skip: isInternalCall,
    message: { error: 'Demasiados pedidos. Aguarda um minuto e tenta de novo.' },
});

// Limit "pesado" para endpoints que podem consumir créditos Serper (/compare, /search, /details)
const heavyLimiter = rateLimit({
    windowMs: 60 * 1000,       // 1 minuto
    max: 20,                   // 20 requests/min/IP — suficiente para uso normal
    standardHeaders: true,
    legacyHeaders: false,
    skip: isInternalCall,
    message: { error: 'Demasiados pedidos à API. Aguarda um minuto e tenta de novo.' },
});

// Limit "muito restrito" para endpoint de refresh manual (só admin deve usar)
const adminLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,  // 1 hora
    max: 10,                   // 10 refreshes/hora/IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Refresh manual limitado a 10 vezes por hora.' },
});

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_URL = 'https://google.serper.dev/shopping';

// ==========================================
// 1. SISTEMA DE CACHE PERSISTENTE EM DISCO
// ==========================================
// O cache sobrevive a reinícios do servidor. Guarda em cache/serper-cache.json.
// TTL longo (12h) porque preços de produtos não mudam muito frequentemente.
// Para forçar refresh: chamar GET /api/products/refresh ou apagar o ficheiro.
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'serper-cache.json');
// TTLs por tipo de cache:
//   - /all (catálogo): TTL longo (12h) — produtos não mudam muito
//   - /compare (preços): TTL curto (2h) — preços mudam mais frequentemente
//   - /search: TTL médio (4h)
const CACHE_TTL_DEFAULT = 12 * 60 * 60 * 1000; // 12h
const CACHE_TTL_COMPARE = 2 * 60 * 60 * 1000;  // 2h para preços
const CACHE_TTL_SEARCH  = 4 * 60 * 60 * 1000;  // 4h para pesquisas
const SAVE_DEBOUNCE_MS = 3000; // agrupar escritas para reduzir I/O

function getTTL(key) {
    if (key.startsWith('compare_')) return CACHE_TTL_COMPARE;
    if (key.startsWith('search_'))  return CACHE_TTL_SEARCH;
    return CACHE_TTL_DEFAULT;
}

let cache = {};

// Carregar cache do disco no arranque
try {
    if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        cache = JSON.parse(raw);
        // Remover entries expiradas logo no arranque
        const now = Date.now();
        let expired = 0;
        for (const key of Object.keys(cache)) {
            const ttl = getTTL(key);
            if (!cache[key] || (now - cache[key].timestamp) >= ttl) {
                delete cache[key];
                expired++;
            }
        }
        const remaining = Object.keys(cache).length;
        console.log(`[cache] Carregado do disco: ${remaining} entradas (${expired} expiradas removidas)`);
    } else {
        console.log('[cache] Sem ficheiro de cache no disco — vai criar novo.');
    }
} catch (e) {
    console.error('[cache] Erro ao carregar cache do disco:', e.message);
    cache = {};
}

let saveTimer = null;
function persistCache() {
    if (saveTimer) return; // já está agendado
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
        } catch (e) {
            console.error('[cache] Erro ao gravar cache:', e.message);
        }
    }, SAVE_DEBOUNCE_MS);
}

function getCached(key) {
    const ttl = getTTL(key);
    if (cache[key] && (Date.now() - cache[key].timestamp < ttl)) {
        return cache[key].data;
    }
    return null;
}

function setCache(key, data) {
    cache[key] = { data, timestamp: Date.now() };
    persistCache();
}

function clearCache() {
    cache = {};
    try {
        if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    } catch (e) {
        console.error('[cache] Erro ao limpar ficheiro:', e.message);
    }
}

// ==========================================
// AUTO-REFRESH AGENDADO (2x por dia: 6h e 18h)
// ==========================================
// Limpa a cache do /all e re-popula. Garante que os preços ficam frescos
// sem ser preciso reiniciar o servidor ou esperar pelo TTL natural.

const REFRESH_HOURS = [6, 18]; // 6h da manhã e 18h da tarde

function msUntilNextRefresh() {
    const now = new Date();
    const candidates = REFRESH_HOURS.map(h => {
        const d = new Date(now);
        d.setHours(h, 0, 0, 0);
        if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
        return d.getTime();
    });
    return Math.min(...candidates) - now.getTime();
}

async function refreshAllProducts(port) {
    const startedAt = new Date().toISOString();
    try {
        console.log(`[auto-refresh] ⏰ A executar refresh agendado às ${startedAt}...`);
        // Limpa só a cache de produtos/preços (URLs ficam — não mudam quase nunca)
        let cleared = 0;
        for (const key of Object.keys(cache)) {
            if (key.startsWith('all_') || key.startsWith('search_') || key.startsWith('compare_')) {
                delete cache[key];
                cleared++;
            }
        }
        persistCache();
        console.log(`[auto-refresh] Cache limpa: ${cleared} entradas removidas. A chamar /all para repopular...`);
        // Re-popula /all via chamada interna
        const res = await fetch(`http://localhost:${port}/api/products/all`);
        const data = await res.json();
        console.log(`[auto-refresh] ✅ Refresh concluído com ${data.total || 0} produtos a ${new Date().toISOString()}.`);
    } catch (e) {
        console.error('[auto-refresh] ❌ Erro:', e.message);
    }
}

function scheduleAutoRefresh(port) {
    function tick() {
        refreshAllProducts(port).finally(() => {
            const delay = msUntilNextRefresh();
            const hours = (delay / 3600000).toFixed(1);
            console.log(`[auto-refresh] Próximo refresh em ${hours}h`);
            setTimeout(tick, delay);
        });
    }
    const initialDelay = msUntilNextRefresh();
    const hours = (initialDelay / 3600000).toFixed(1);
    console.log(`[auto-refresh] Agendado para correr às ${REFRESH_HOURS.join('h e ')}h. Próximo refresh em ${hours}h.`);
    setTimeout(tick, initialDelay);
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

// Lojas com scraper de URL — só estes produtos são fiáveis para comparar/abrir
const VERIFIED_STORES_REGEX = /worten|fnac|radio popular|radiopopular|rádio popular|pc diga|pcdiga/i;

function isStoreVerified(storeName) {
    return !!storeName && VERIFIED_STORES_REGEX.test(storeName);
}

// ==========================================
// LOJAS-ALVO PARA COMPARAÇÃO + helpers
// ==========================================
// Cada compare faz 1 query Serper Shopping POR loja para garantir preço correto
// (em vez de uma query agregada que mistura variantes de produtos diferentes)
const TARGET_STORES_FOR_COMPARE = [
    { name: 'Worten',        match: /worten/i },
    { name: 'FNAC',          match: /fnac/i },
    { name: 'Radio Popular', match: /radio popular|radiopopular/i },
    { name: 'PCDiga',        match: /pcdiga|pc diga/i },
];

function normalizeText(s) {
    return String(s || '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(s) {
    return normalizeText(s).split(' ').filter(t => t.length >= 2);
}

// Extrai um "model identifier" (SKU/código) de um texto.
// Ex: "Frigorífico Americano Bosch KAD93AIDP" → "KAD93AIDP"
//     "Aspirador Xiaomi S40 Pro 15000Pa"     → "S40"
// Heurística: tokens com letras+dígitos, ≥3 chars, ignorando unidades (mAh, Pa, GB...)
function extractModelIdentifier(text) {
    const UNIT_REGEX = /^\d+(?:[.,]\d+)?(pa|mah|wh|gb|mb|tb|kb|kg|g|cm|mm|m|w|kw|hz|khz|mhz|ghz|fps|ms|nm|ml|l|k|p|fhd|uhd|hd|in)$/i;
    const candidates = String(text || '').split(/\s+/).filter(t =>
        t.length >= 3
        && /[a-zA-Z]/.test(t)
        && /\d/.test(t)
        && !UNIT_REGEX.test(t)
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
}

// 100% match: todos os tokens da query devem aparecer no título.
// Se a query tem um model identifier, o título também tem que conter exatamente esse modelo.
function titleMatchesQuery(title, query) {
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return false;
    const tTokens = new Set(tokenize(title));
    if (!qTokens.every(t => tTokens.has(t))) return false;

    // Verificação extra: se há modelo na query, o título tem que ter o MESMO modelo
    const qModel = extractModelIdentifier(query);
    if (qModel) {
        const tModel = extractModelIdentifier(title);
        if (!tModel || tModel.toLowerCase() !== qModel.toLowerCase()) {
            return false;
        }
    }
    return true;
}

// Verifica se um URL contém referência ao model identifier (no path/slug).
function urlMatchesModel(url, modelId) {
    if (!modelId) return true;
    if (!url) return false;
    // Normaliza: remove hifens e underscores para comparar (KAD-93-AIDP === KAD93AIDP)
    const cleanUrl = String(url).toLowerCase().replace(/[-_]/g, '');
    const cleanModel = String(modelId).toLowerCase().replace(/[-_]/g, '');
    return cleanUrl.includes(cleanModel);
}

// Marcas conhecidas (case-insensitive, normalizadas)
const KNOWN_BRANDS = [
    'samsung','lg','bosch','xiaomi','apple','sony','huawei','oneplus','google',
    'philips','dyson','dreame','roborock','irobot','redmi','poco',
    'nintendo','playstation','microsoft','xbox','dell','hp','asus',
    'lenovo','acer','msi','razer','logitech','corsair','hyperx','jbl','bose',
    'sennheiser','beats','marshall','tcl','hisense','panasonic','toshiba',
    'whirlpool','beko','miele','siemens','candy','indesit','liebherr','daewoo',
    'haier','electrolux','aeg','smeg','gigabyte','intel','amd','nvidia',
    'macbook','iphone','ipad','airpods','galaxy','pixel',
    'pioneer','denon','yamaha','marantz','ninebot','garmin','fitbit','realme',
    'oppo','vivo','motorola','nokia','tp-link','linksys','netgear','ubiquiti',
    'kindle','echo','nest','steam','razer','asrock','sapphire','seagate','wd',
    'kingston','samsung','crucial','sandisk','transcend','adata'
];

// Tokens genéricos (descritores que NÃO identificam um produto específico).
// Querys com SÓ tokens genéricos + 1 marca são insuficientes.
const GENERIC_TOKENS = new Set([
    // Tipos de produto
    'aspirador','aspiradores','robo','robot','robotico','silencioso','recarregavel',
    'portatil','portateis','computador','computadores','laptop','desktop','pc',
    'smartphone','telemovel','telemoveis','tablet','consola','console','consolas',
    'monitor','monitores','televisao','televisao','tv','smart','soundbar','soundbars',
    'coluna','colunas','auscultadores','fones','headphones','headphone','phones',
    'rato','ratos','teclado','teclados','cabo','cabos','suporte','suportes',
    'pilha','pilhas','carregador','carregadores','adaptador','adaptadores',
    'frigorifico','frigorificos','combinado','maquina','maquinas','lavar','lavadora',
    'loica','loicas','forno','fornos','fogao','fogoes','micro','ondas','microondas',
    'torradeira','torradeiras','exaustor','batedeira','liquidificador','varinha',
    'fritadeira','fritadeiras','air','fryer',
    // Descritores
    'preto','branco','cinza','inox','prateado','dourado','azul','vermelho','verde',
    'rosa','amarelo','laranja','castanho','metalico','metalica',
    'novo','nova','premium','profissional','gaming','ultra','mini','slim','fino',
    'grande','pequeno','medio','original','oficial','wireless','bluetooth','wifi',
    // Conectores
    'com','sem','para','em','de','da','do','das','dos','os','as','no','na','nos','nas',
    'a','o','e','ou','que','pelo','pela','um','uma','uns','umas'
]);

// Determina se uma query é "suficientemente específica" para comparação fiável.
// Critério: precisa de identificador único (modelo) OU (marca + ≥2 tokens não-genéricos).
function isQuerySpecificEnough(query) {
    // 1. Se tem model identifier (KAD93AIDP, S40, M2) → sempre suficiente
    if (extractModelIdentifier(query)) return true;

    // 2. Sem modelo, precisa de marca conhecida E pelo menos 2 tokens não-genéricos
    const norm = normalizeText(query);
    const hasBrand = KNOWN_BRANDS.some(brand => norm.includes(brand));
    if (!hasBrand) return false;

    const tokens = norm.split(' ').filter(Boolean);
    const nonGeneric = tokens.filter(t => !GENERIC_TOKENS.has(t));
    return nonGeneric.length >= 2;
}

function parsePrice(priceStr) {
    if (!priceStr) return 0;
    const cleaned = String(priceStr).replace(/[^0-9.,]/g, '');
    // Trata vírgula como decimal (formato europeu)
    const normalized = cleaned.includes(',') && !cleaned.includes('.')
        ? cleaned.replace(',', '.')
        : cleaned.replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized) || 0;
}

// Faz query Serper Shopping específica para uma loja e devolve o primeiro item que
// bata com o source da loja e cujo título contenha 100% dos tokens da query.
async function fetchStoreOffer(query, store) {
    try {
        const response = await fetch(SERPER_URL, {
            method: 'POST',
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: `${query} ${store.name}`, gl: 'pt', hl: 'pt', num: 20 }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        const matches = (data.shopping || []).filter(item =>
            store.match.test(item.source || '') &&
            titleMatchesQuery(item.title || '', query)
        );
        return matches[0] || null;
    } catch (e) {
        console.error(`[fetchStoreOffer] ${store.name}: ${e.message}`);
        return null;
    }
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

function isGoogleLink(link) {
    if (!link) return true;
    return /google\.[a-z.]+\/(search|shopping|aclk|url|imgres)/i.test(link)
        || /googleadservices\.com/i.test(link)
        || /googleusercontent\.com/i.test(link);
}

// Extrai o URL real do parâmetro 'q', 'url' ou 'adurl' de um redirect Google
function extractDirectFromGoogleRedirect(link) {
    if (!link) return null;
    try {
        const u = new URL(link);
        // Tenta vários parâmetros conhecidos do Google
        const candidates = ['q', 'url', 'adurl', 'mu', 'continue'];
        for (const param of candidates) {
            const v = u.searchParams.get(param);
            if (v && /^https?:\/\//i.test(v) && !isGoogleLink(v)) {
                return v;
            }
        }
    } catch {}
    return null;
}

function getStoreDirectLink(storeName, productName, googleLink) {
    // Se o link já vai direto à loja (não é um redirect do Google), usamos.
    if (googleLink && !isGoogleLink(googleLink)) {
        return googleLink;
    }

    // Tenta extrair o URL real do redirect Google (ex: /url?q=https://www.worten.pt/...)
    const extracted = extractDirectFromGoogleRedirect(googleLink);
    if (extracted) return extracted;
    // Caso contrário, geramos um link de pesquisa direto na loja.
    // URLs verificados / fallback para homepage se a loja não tem search público fiável.
    const storeSearchUrls = {
        'worten':        'https://www.worten.pt/pesquisa?q=',
        'fnac':          'https://www.fnac.pt/SearchResult/ResultList.aspx?Search=',
        'radio popular': 'https://www.radiopopular.pt/pesquisa?q=',
        'rádio popular': 'https://www.radiopopular.pt/pesquisa?q=',
        'mediamarkt':    'https://www.mediamarkt.pt/pt/search.html?query=',
        'pc diga':       'https://www.pcdiga.com/catalogsearch/result/?q=',
        'pcdiga':        'https://www.pcdiga.com/catalogsearch/result/?q=',
        'amazon':        'https://www.amazon.es/s?k=',
        'amazon.es':     'https://www.amazon.es/s?k=',
        'amazon.pt':     'https://www.amazon.es/s?k=',
        'el corte':      'https://www.elcorteingles.pt/search/?s=',
        'el corte inglés': 'https://www.elcorteingles.pt/search/?s=',
        'staples':       'https://www.staples.pt/search.html?q=',
        'pccomponentes': 'https://www.pccomponentes.pt/buscar?query=',
    };

    // Lojas com search público quebrado/inexistente → enviar para a homepage
    const storeHomepageOnly = {
        'darty':       'https://www.darty.pt/',
        'auchan':      'https://www.auchan.pt/',
        'continente':  'https://www.continente.pt/',
        'novo atalho': 'https://www.novoatalho.pt/',
    };

    const key = (storeName || '').toLowerCase().trim();

    // 1. Lojas com search funcional → pesquisa direta com o nome do produto
    let url = storeSearchUrls[key];
    if (!url) {
        for (const k of Object.keys(storeSearchUrls)) {
            if (key.includes(k)) { url = storeSearchUrls[k]; break; }
        }
    }
    if (url) return url + encodeURIComponent(productName);

    // 2. Lojas com search quebrado → homepage
    let home = storeHomepageOnly[key];
    if (!home) {
        for (const k of Object.keys(storeHomepageOnly)) {
            if (key.includes(k)) { home = storeHomepageOnly[k]; break; }
        }
    }
    if (home) return home;

    // 3. Último recurso: o link do Google (melhor do que nada)
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
router.get('/search', heavyLimiter, async (req, res) => {
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
            .filter(item => isStoreVerified(item.source))
            .filter(item => isQuerySpecificEnough(item.title || ''))
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
router.get('/all', lightLimiter, async (req, res) => {
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
                    .filter(item => isStoreVerified(item.source))
                    // FILTRO CRÍTICO: descartar produtos com títulos demasiado
                    // genéricos (ex: "Asus Portátil", "Frigorífico Bosch") porque
                    // não permitem comparação fiável entre lojas — cada loja
                    // devolverá um modelo diferente.
                    .filter(item => isQuerySpecificEnough(item.title || ''))
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

        // Deduplicar por título normalizado (mesmo produto pode vir de várias lojas)
        const seen = new Set();
        const dedupedProducts = [];
        for (const p of allProducts) {
            const key = normalizeText(p.name);
            if (key && !seen.has(key)) {
                seen.add(key);
                dedupedProducts.push(p);
            }
        }

        // Misturar array aleatoriamente
        dedupedProducts.sort(() => 0.5 - Math.random());

        const result = { products: dedupedProducts, total: dedupedProducts.length };

        // SÓ GUARDAR NA CACHE SE CONSEGUIU CARREGAR PRODUTOS (Para evitar cache de erros)
        if (dedupedProducts.length > 0) {
            setCache(cacheKey, result);
        } else {
            console.error("[Serper] Atenção: Nenhum produto carregado. Verifica a tua API Key!");
        }
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/products/refresh - Força refresh manual da cache (limpa tudo).
// Útil quando quiseres atualizar preços fora do TTL natural de 12h.
// Próxima chamada a /all ou /compare vai consumir créditos Serper.
router.get('/refresh', adminLimiter, (req, res) => {
    const entriesCleared = Object.keys(cache).length;
    clearCache();
    console.log(`[cache] Refresh manual: ${entriesCleared} entradas apagadas.`);
    return res.json({ ok: true, entriesCleared });
});

// GET /api/products/cache-status - Diagnóstico: ver quanto está em cache e idade.
router.get('/cache-status', lightLimiter, (req, res) => {
    const now = Date.now();
    const entries = Object.entries(cache).map(([key, val]) => {
        const ttl = getTTL(key);
        return {
            key: key.slice(0, 60),
            ttlHours: ttl / (60 * 60 * 1000),
            ageMinutes: Math.round((now - val.timestamp) / 60000),
            expiresInMinutes: Math.max(0, Math.round((val.timestamp + ttl - now) / 60000)),
        };
    });
    return res.json({
        total: entries.length,
        ttls: {
            default: `${CACHE_TTL_DEFAULT / 3600000}h`,
            compare: `${CACHE_TTL_COMPARE / 3600000}h`,
            search:  `${CACHE_TTL_SEARCH / 3600000}h`,
        },
        cacheFile: CACHE_FILE,
        entries: entries.slice(0, 30),
    });
});

// GET /api/products/compare - Compara o MESMO produto em várias lojas portuguesas
// Estratégia: 1 query Serper Shopping específica POR loja (`{produto} {loja}`) com
// filtro estrito de título (100% dos tokens devem aparecer) para evitar variantes
// diferentes serem confundidas com o produto correto.
router.get('/compare', heavyLimiter, async (req, res) => {
    const { q } = req.query;

    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY não configurada' });
    if (!q) return res.status(400).json({ error: 'Parâmetro "q" obrigatório' });

    const cacheKey = `compare_v2_${q}`;
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        console.log(`[compare] A procurar preços para: ${q}`);

        // Recusar queries demasiado genéricas — devolver vazio para o frontend mostrar aviso
        if (!isQuerySpecificEnough(q)) {
            console.log(`[compare] Query "${q}" muito genérica (sem modelo nem marca). A devolver vazio.`);
            const result = { shops: [] };
            setCache(cacheKey, result);
            return res.json(result);
        }

        const queryModel = extractModelIdentifier(q);
        if (queryModel) console.log(`[compare] Model identifier detectado: ${queryModel}`);

        // 1) Fetch ofertas das 4 lojas-alvo em paralelo, com query loja-específica
        const offers = await Promise.all(
            TARGET_STORES_FOR_COMPARE.map(s => fetchStoreOffer(q, s))
        );

        const shops = [];
        for (const offer of offers) {
            if (!offer) continue;
            const price = parsePrice(offer.price);
            if (price <= 0) continue;
            shops.push({
                name: offer.source,
                price: price.toFixed(2),
                offerTitle: offer.title,
                link: getStoreDirectLink(offer.source, q, offer.link),
                _resolvedUrl: null,
            });
        }

        // 2) Resolver URLs diretos via Serper Site Search em paralelo
        await Promise.all(shops.map(async (shop) => {
            try {
                const directUrl = await resolveProductUrl(shop.name, q);
                if (directUrl) shop._resolvedUrl = directUrl;
            } catch (e) {
                // ignora
            }
        }));

        // 3) Validação de coerência:
        //    - Tem que haver URL DIRETO resolvido (não fallback para search/homepage)
        //    - Se a query tem modelo, o URL tem que conter esse modelo
        //    Caso contrário, descartamos a oferta (lista vazia > dados incoerentes).
        const validShops = [];
        for (const shop of shops) {
            const url = shop._resolvedUrl;

            if (!url) {
                console.log(`[compare] Descartado ${shop.name}: sem URL de produto real`);
                continue;
            }

            if (queryModel && !urlMatchesModel(url, queryModel)) {
                console.log(`[compare] Descartado ${shop.name}: URL ${url} não bate com modelo ${queryModel}`);
                continue;
            }

            shop.link = url;
            delete shop._resolvedUrl;
            delete shop.offerTitle;
            validShops.push(shop);
        }

        // 4) Para lojas que permitem (Worten, Radio Popular), buscar preço REAL
        //    na própria página da loja e sobrepor o preço do Serper (que pode ter atraso).
        //    FNAC e PCDiga estão bloqueados por anti-bot, mantemos o preço do Serper.
        await Promise.all(validShops.map(async (shop) => {
            try {
                const livePrice = await fetchLivePrice(shop.name, shop.link);
                if (livePrice !== null && livePrice > 0) {
                    const oldPrice = shop.price;
                    shop.price = livePrice.toFixed(2);
                    if (oldPrice !== shop.price) {
                        console.log(`[compare] ${shop.name}: preço atualizado ${oldPrice}€ → ${shop.price}€ (página da loja)`);
                    }
                }
            } catch (e) {
                // mantém preço do Serper
            }
        }));

        // 4) Ordenar pela loja mais barata
        validShops.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

        const result = { shops: validShops };

        if (validShops.length > 0) {
            setCache(cacheKey, result);
        }

        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/products/details - Procura descrições e especificações orgânicas
router.get('/details', heavyLimiter, async (req, res) => {
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

// Export router + função para arrancar o auto-refresh (chamada pelo server.js)
module.exports = router;
module.exports.scheduleAutoRefresh = scheduleAutoRefresh;
