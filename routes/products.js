const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { resolveProductUrl, fetchLivePrice, isVerifiedProductUrl } = require('./store-scraper');

// =============================================================================
// RATE LIMITING - protege contra abuso e esgotamento de créditos Serper
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
    max: 20,                   // 20 requests/min/IP - suficiente para uso normal
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
const SERPER_IMAGES_URL = 'https://google.serper.dev/images';

// ==========================================
// 1. SISTEMA DE CACHE PERSISTENTE EM DISCO
// ==========================================
// O cache sobrevive a reinícios do servidor. Guarda em cache/serper-cache.json.
// TTL longo (12h) porque preços de produtos não mudam muito frequentemente.
// Para forçar refresh: chamar GET /api/products/refresh ou apagar o ficheiro.
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'serper-cache.json');
// TTLs por tipo de cache:
//   - /all (catálogo): TTL longo (12h) - produtos não mudam muito
//   - /compare (preços): TTL curto (2h) - preços mudam mais frequentemente
//   - /search: TTL médio (4h)
const CACHE_TTL_DEFAULT = 12 * 60 * 60 * 1000;     // 12h
const CACHE_TTL_COMPARE = 2 * 60 * 60 * 1000;      // 2h para preços
const CACHE_TTL_SEARCH  = 4 * 60 * 60 * 1000;      // 4h para pesquisas
const CACHE_TTL_HERO_PNG = 7 * 24 * 60 * 60 * 1000; // 7 dias para PNGs do hero
const SAVE_DEBOUNCE_MS = 3000; // agrupar escritas para reduzir I/O

// Prefixos versionados. Incrementar a versão invalida entradas antigas em massa
// (útil quando o algoritmo de normalização ou estrutura de dados muda).
const CACHE_KEY = {
    all:      'all_products',
    search:   (q, gl) => `search_${q}_${gl}`,
    compare:  (q) => `compare_v2_${q}`,
    heroPng:  (name) => `hero_png_v3::${name}`,
};

function getTTL(key) {
    if (key.startsWith('hero_png_v3::')) return CACHE_TTL_HERO_PNG;
    if (key.startsWith('compare_'))      return CACHE_TTL_COMPARE;
    if (key.startsWith('search_'))       return CACHE_TTL_SEARCH;
    return CACHE_TTL_DEFAULT;
}

let cache = {};

// Tamanho máximo do ficheiro de cache em disco. Se exceder, fazemos reset total
// no arranque - previne degradação após meses de uso (parse JSON gigante = 3-5s).
const CACHE_MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// Carregar cache do disco no arranque
try {
    if (fs.existsSync(CACHE_FILE)) {
        const stat = fs.statSync(CACHE_FILE);
        if (stat.size > CACHE_MAX_FILE_SIZE) {
            console.warn(`[cache] Ficheiro excedeu ${CACHE_MAX_FILE_SIZE} bytes (${stat.size}). A fazer reset.`);
            fs.unlinkSync(CACHE_FILE);
            cache = {};
        } else {
            const raw = fs.readFileSync(CACHE_FILE, 'utf8');
            cache = JSON.parse(raw);
            // Remover entries expiradas logo no arranque (GC)
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
            console.log(`[cache] Carregado do disco: ${remaining} entradas (${expired} expiradas removidas, ${Math.round(stat.size/1024)}KB)`);
        }
    } else {
        console.log('[cache] Sem ficheiro de cache no disco - vai criar novo.');
    }
} catch (e) {
    console.error('[cache] Erro ao carregar cache do disco:', e.message);
    cache = {};
}

let saveTimer = null;
function flushCacheSync() {
    try {
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
    } catch (e) {
        console.error('[cache] Erro ao gravar cache:', e.message);
    }
}
function persistCache() {
    if (saveTimer) return; // já está agendado
    saveTimer = setTimeout(() => {
        saveTimer = null;
        flushCacheSync();
    }, SAVE_DEBOUNCE_MS);
}

// Garante flush da cache em shutdown - evita perder updates pendentes no debounce
// (ex: server restart entre setCache e persistCache real).
['SIGTERM', 'SIGINT'].forEach(sig => {
    process.on(sig, () => {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
            console.log(`[cache] ${sig} recebido - flush sync antes de sair.`);
            flushCacheSync();
        }
        process.exit(0);
    });
});

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

// Hora local PT para logs - facilita debug quando se vê os logs do Render
function nowLisbon() {
    return new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });
}

const REFRESH_FETCH_TIMEOUT_MS = 60_000; // 60s para o /all interno completar

async function refreshAllProducts(port) {
    try {
        console.log(`[auto-refresh] ⏰ A executar refresh agendado às ${nowLisbon()}...`);
        // Limpa só a cache de produtos/preços (URLs ficam - não mudam quase nunca)
        let cleared = 0;
        for (const key of Object.keys(cache)) {
            if (key.startsWith('all_') || key.startsWith('search_') || key.startsWith('compare_')) {
                delete cache[key];
                cleared++;
            }
        }
        persistCache();
        console.log(`[auto-refresh] Cache limpa: ${cleared} entradas removidas. A chamar /all para repopular...`);

        // Re-popula /all via chamada interna com timeout para não bloquear o scheduler
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), REFRESH_FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(`http://localhost:${port}/api/products/all`, { signal: ctrl.signal });
            const data = await res.json();
            console.log(`[auto-refresh] ✅ Refresh concluído com ${data.total || 0} produtos a ${nowLisbon()}.`);
        } finally {
            clearTimeout(timer);
        }
    } catch (e) {
        if (e.name === 'AbortError') {
            console.error(`[auto-refresh] ❌ Timeout (${REFRESH_FETCH_TIMEOUT_MS}ms) - refresh abortado a ${nowLisbon()}.`);
        } else {
            console.error('[auto-refresh] ❌ Erro:', e.message);
        }
    }
}

// Tempo (ms) desde a última refresh oficial. Se o server arrancar logo a seguir
// a uma das horas-target e a cache estiver vazia, vale a pena fazer refresh já
// (em vez de esperar 12h pela próxima).
function msSinceLastRefresh() {
    const now = new Date();
    const candidates = REFRESH_HOURS.map(h => {
        const d = new Date(now);
        d.setHours(h, 0, 0, 0);
        if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
        return d.getTime();
    });
    return now.getTime() - Math.max(...candidates);
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

    // Se o servidor reiniciou DEPOIS de uma hora de refresh há menos de 30 min,
    // e ainda não há cache de produtos, dispara refresh imediato. Caso contrário,
    // ficaríamos sem dados frescos por 12h.
    const sinceLast = msSinceLastRefresh();
    const cacheEmpty = !cache['all_products'];
    if (sinceLast < 30 * 60 * 1000 && cacheEmpty) {
        console.log(`[auto-refresh] Restart próximo de hora de refresh (${Math.round(sinceLast/60000)}min depois). A executar refresh imediato.`);
        setTimeout(tick, 5000); // 5s para o servidor terminar de arrancar
        return;
    }

    const initialDelay = msUntilNextRefresh();
    const hours = (initialDelay / 3600000).toFixed(1);
    console.log(`[auto-refresh] Agendado para correr às ${REFRESH_HOURS.join('h e ')}h UTC. Próximo refresh em ${hours}h.`);
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

// Lojas com scraper de URL - só estes produtos são fiáveis para comparar/abrir
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

// Parse robusto de preço em formato europeu (PT) e americano. Casos cobertos:
//   "10,50"        → 10.5      (decimal vírgula)
//   "10.50"        → 10.5      (decimal ponto)
//   "1.000,50"     → 1000.5    (PT: ponto = milhar, vírgula = decimal)
//   "1,000.50"     → 1000.5    (US: vírgula = milhar, ponto = decimal)
//   "10.500,00"    → 10500     (PT com milhar)
//   "€10,50"       → 10.5      (símbolos removidos)
// A heurística: o ÚLTIMO separador (',' ou '.') é o decimal SE estiver seguido de
// 1 ou 2 dígitos no fim da string. Os outros separadores são milhares.
function parsePrice(priceStr) {
    if (!priceStr) return 0;
    const cleaned = String(priceStr).replace(/[^0-9.,]/g, '');
    if (!cleaned) return 0;

    const lastDot   = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    const lastSep   = Math.max(lastDot, lastComma);

    if (lastSep === -1) {
        // Sem separadores - número inteiro
        return parseFloat(cleaned) || 0;
    }

    const after = cleaned.length - lastSep - 1;
    let normalized;

    if (after === 1 || after === 2) {
        // Último separador é decimal (1 ou 2 casas depois)
        const intPart = cleaned.slice(0, lastSep).replace(/[.,]/g, '');
        const decPart = cleaned.slice(lastSep + 1);
        normalized = `${intPart}.${decPart}`;
    } else {
        // Último separador é milhar (3+ dígitos depois, ou exatamente 3) - sem decimais
        normalized = cleaned.replace(/[.,]/g, '');
    }

    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : 0;
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

// 1 query genérica que devolve TODAS as ofertas que o Google Shopping tem para
// uma query. O productId vem em cada item e permite agrupar ofertas do MESMO
// produto entre lojas (é como o Google identifica a SKU canónica internamente).
async function fetchAllShoppingOffers(query) {
    try {
        const response = await fetch(SERPER_URL, {
            method: 'POST',
            headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, gl: 'pt', hl: 'pt', num: 40 }),
        });
        if (!response.ok) return [];
        const data = await response.json();
        return data.shopping || [];
    } catch (e) {
        console.error(`[fetchAllShoppingOffers] erro: ${e.message}`);
        return [];
    }
}

// Escolhe o productId "dominante" - o que tem mais peso nas ofertas. Pontua
// cada productId por: (a) número de ofertas, (b) bonus se loja é parceira,
// (c) bonus se título contém o modelo da query, (d) bonus se preço é razoável.
// Devolve null se nenhuma oferta tiver productId (caso raro mas existe).
function pickDominantProductId(offers, queryModel) {
    const scores = new Map();
    const sources = new Map(); // productId → Set de stores
    for (const offer of offers) {
        const pid = offer.productId;
        if (!pid) continue;
        let score = scores.get(pid) || 0;
        score += 1;
        if (isStoreVerified(offer.source)) score += 3;
        if (queryModel && offer.title && offer.title.toLowerCase().includes(queryModel.toLowerCase())) score += 2;
        if (offer.price && parsePrice(offer.price) > 1) score += 1;
        scores.set(pid, score);
        if (!sources.has(pid)) sources.set(pid, new Set());
        sources.get(pid).add((offer.source || '').toLowerCase());
    }
    if (scores.size === 0) return null;
    // Empate desempata pelo número de lojas distintas
    let best = null, bestScore = -1, bestSources = 0;
    for (const [pid, score] of scores.entries()) {
        const distinctSrc = sources.get(pid).size;
        if (score > bestScore || (score === bestScore && distinctSrc > bestSources)) {
            bestScore = score;
            bestSources = distinctSrc;
            best = pid;
        }
    }
    return best;
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

// Para um item Serper Shopping, devolve a URL real do produto na loja (se
// existir), ou null. Trata casos de redirect Google e links diretos.
function getDirectStoreUrl(item) {
    const raw = item && item.link;
    if (!raw) return null;
    if (!isGoogleLink(raw)) return raw;
    return extractDirectFromGoogleRedirect(raw);
}

// True se o item tem link verificável que aponta para página de produto numa loja
// parceira. Filtra itens que não conseguimos confirmar (links de pesquisa,
// categoria, Google Shopping product, etc.).
function isItemConfirmedInPartnerStore(item) {
    const url = getDirectStoreUrl(item);
    return isVerifiedProductUrl(url);
}

// Valida que uma string é uma URL bem formada com http/https. Defesa contra
// dados malformados vindos do Serper que pudessem injetar javascript: ou similar.
function isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function getStoreDirectLink(storeName, productName, googleLink) {
    // Se o link já vai direto à loja (não é um redirect do Google), usamos.
    if (googleLink && !isGoogleLink(googleLink) && isSafeUrl(googleLink)) {
        return googleLink;
    }

    // Tenta extrair o URL real do redirect Google (ex: /url?q=https://www.worten.pt/...)
    const extracted = extractDirectFromGoogleRedirect(googleLink);
    if (extracted && isSafeUrl(extracted)) return extracted;
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
        rating: item.rating ? parseFloat(item.rating).toFixed(1) : null,
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

// Número de resultados por categoria pedidos ao Serper Shopping (max útil: ~20).
// Reduzir poupa créditos; aumentar dá mais variedade na grid inicial.
const SERPER_RESULTS_PER_CATEGORY = 10;

// Mutex: se vários pedidos a /all chegam simultaneamente com cache fria, só dispara
// UMA chamada Serper - todos os outros recebem a mesma Promise. Evita thundering
// herd (10 users × 14 queries = 140 créditos por nada).
let allProductsInFlight = null;

async function fetchAllProductsCatalog() {
    console.log(`[Serper] A carregar todo o catálogo base... (A executar ${CATEGORY_QUERIES.length} pesquisas em paralelo)`);
    const allProducts = [];
    const stats = { totalRaw: 0, droppedSource: 0, droppedGeneric: 0, droppedUnverified: 0, kept: 0 };

    const fetchPromises = CATEGORY_QUERIES.map(async (qObj) => {
        try {
            const response = await fetch(SERPER_URL, {
                method: 'POST',
                headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: qObj.query, gl: 'pt', hl: 'pt', num: SERPER_RESULTS_PER_CATEGORY })
            });

            if (!response.ok) return [];

            const data = await response.json();
            const raw = data.shopping || [];
            stats.totalRaw += raw.length;

            return raw
                .filter(item => {
                    if (!isStoreVerified(item.source)) { stats.droppedSource++; return false; }
                    return true;
                })
                // Descartar produtos com títulos demasiado genéricos (ex: "Asus
                // Portátil") - cada loja devolveria um modelo diferente e a
                // comparação ficaria errada.
                .filter(item => {
                    if (!isQuerySpecificEnough(item.title || '')) { stats.droppedGeneric++; return false; }
                    stats.kept++;
                    return true;
                })
                .map(item => {
                    item.assignedSubcategory = qObj.sub;
                    return normalizeProduct(item, qObj.cat);
                });
        } catch (e) {
            return [];
        }
    });

    const results = await Promise.all(fetchPromises);
    results.forEach(items => allProducts.push(...items));

    console.log(`[Serper] Filtros aplicados: ${stats.totalRaw} resultados raw → ${stats.kept} produtos ` +
        `(descartados: ${stats.droppedSource} sem loja parceira, ${stats.droppedGeneric} título genérico)`);

    // Deduplicar por título normalizado
    const seen = new Set();
    const dedupedProducts = [];
    for (const p of allProducts) {
        const key = normalizeText(p.name);
        if (key && !seen.has(key)) {
            seen.add(key);
            dedupedProducts.push(p);
        }
    }

    dedupedProducts.sort(() => 0.5 - Math.random());
    return { products: dedupedProducts, total: dedupedProducts.length };
}

// GET /api/products/all - Pega produtos de todas as categorias para preencher a loja inicial
router.get('/all', lightLimiter, async (req, res) => {
    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY não configurada' });

    const cacheKey = `all_products`;
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        // Se já existe uma chamada em curso, juntar-se a essa em vez de duplicar
        if (allProductsInFlight) {
            const result = await allProductsInFlight;
            return res.json(result);
        }

        allProductsInFlight = fetchAllProductsCatalog()
            .then(result => {
                if (result.products.length > 0) {
                    setCache(cacheKey, result);
                } else {
                    console.error("[Serper] Atenção: Nenhum produto carregado. Verifica a tua API Key!");
                }
                return result;
            })
            .finally(() => { allProductsInFlight = null; });

        const result = await allProductsInFlight;
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/products/hero-images - devolve uma lista curta de produtos com imagens
// PNG (fundo transparente) para a rotação da hero da homepage.
// Usa a cache do /all como fonte de produtos e procura no Serper Images uma versão
// PNG de cada um. Cache forte (7 dias) por produto - estas imagens não mudam.
router.get('/hero-images', lightLimiter, async (req, res) => {
    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY não configurada' });

    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 5, 1), 8);
    const preferred = ['smartphones', 'gaming', 'imagem', 'informatica'];

    // Lista de produtos vem da cache do /all - se ainda não foi populada, devolve vazio
    // (o front-end faz fallback para mostrar a imagem default).
    const allData = getCached('all_products');
    if (!allData || !Array.isArray(allData.products) || allData.products.length === 0) {
        return res.json({ products: [] });
    }

    // Produtos que não queremos ver na rotação da hero (imagens fracas/pouco apelativas).
    // Filtro simples por keyword no nome - case-insensitive.
    const HERO_BLOCKLIST = ['xbox'];

    // Escolhe até `count` produtos: 1 por categoria preferida, depois preenche com restantes
    const picked = [];
    const all = allData.products.filter(p => {
        if (!p || !p.name) return false;
        const lower = p.name.toLowerCase();
        return !HERO_BLOCKLIST.some(kw => lower.includes(kw));
    });
    for (const cat of preferred) {
        if (picked.length >= count) break;
        const found = all.find(p => p.category === cat && !picked.includes(p));
        if (found) picked.push(found);
    }
    for (const p of all) {
        if (picked.length >= count) break;
        if (!picked.includes(p)) picked.push(p);
    }

    // Domínios que servem "PNGs transparentes" mas com o padrão de quadradinhos
    // do fundo de transparência GRAVADO na imagem (preview com watermark visual).
    // Resultam em imagens feias no hero - são para evitar.
    const PNG_SOURCE_BLOCKLIST = [
        'pngtree.com', 'pngwing.com', 'pngegg.com', 'pngfind.com', 'pngitem.com',
        'kindpng.com', 'pngimg.com', 'freepng.com', 'freepnglogos.com', 'pikbest.com',
        'vectorstock.com', 'dreamstime.com', 'shutterstock.com', 'stockphoto.com',
        'pngmart.com', 'transparentpng.com', 'pngarea.com', 'cleanpng.com',
        'seekpng.com', 'pngall.com', 'stickpng.com', 'pngplay.com',
    ];

    function isBadPngSource(url) {
        if (!url) return true;
        const lower = url.toLowerCase();
        if (PNG_SOURCE_BLOCKLIST.some(d => lower.includes(d))) return true;
        // Padrões típicos de URLs de preview/watermark
        if (/\/(preview|thumb|watermark|sample)[-_/]/i.test(lower)) return true;
        return false;
    }

    // Para cada produto, procura uma versão PNG via Serper Images (com cache forte).
    // Se não houver PNG limpo, faz fallback para a imagem original do Google Shopping.
    const results = await Promise.all(picked.map(async (p) => {
        const cacheKey = `hero_png_v3::${normalizeText(p.name)}`;
        const cached = getCached(cacheKey);
        if (cached !== null) {
            // '' significa "já tentámos e não há PNG aceitável" - usar imagem original
            if (cached === '') return p.image ? { ...p } : null;
            return { ...p, image: cached };
        }

        try {
            // Timeout curto (5s) porque hero-images é "nice to have" - se demora,
            // melhor cair para a imagem original do Google Shopping do que bloquear.
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const response = await fetch(SERPER_IMAGES_URL, {
                method: 'POST',
                headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: `${p.name} png transparent background`,
                    gl: 'pt',
                    hl: 'pt',
                    num: 10,
                }),
                signal: ctrl.signal,
            }).finally(() => clearTimeout(timer));

            if (!response.ok) {
                setCache(cacheKey, '');
                return p.image ? { ...p } : null;
            }
            const data = await response.json();
            const images = Array.isArray(data.images) ? data.images : [];

            // Filtrar fontes ruins (que servem PNGs com checkerboard de fundo)
            const acceptable = images.filter(img => img && img.imageUrl && !isBadPngSource(img.imageUrl));

            // Preferir URL com extensão .png explícita; senão a primeira aceitável
            const pngImg = acceptable.find(img => /\.png(\?|#|$)/i.test(img.imageUrl))
                        || acceptable[0];

            if (pngImg) {
                setCache(cacheKey, pngImg.imageUrl);
                return { ...p, image: pngImg.imageUrl };
            }
            // Nenhum resultado aceitável - guardar '' e usar imagem original
            setCache(cacheKey, '');
            return p.image ? { ...p } : null;
        } catch (e) {
            return p.image ? { ...p } : null;
        }
    }));

    const valid = results.filter(Boolean);
    return res.json({ products: valid });
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

// GET /api/products/compare - Compara o MESMO produto em várias lojas portuguesas.
// Estratégia (v3, baseada em productId do Google Shopping):
//   1. 1 query Serper Shopping → devolve ofertas com productId (Google agrupa
//      por GTIN internamente, então productId = mesma SKU canónica entre lojas).
//   2. Encontrar o productId dominante - o que tem mais ofertas das lojas parceiras.
//   3. Filtrar para ofertas desse productId + de lojas parceiras.
//   4. Fallback (sem productId): per-store queries com match por título (v2).
//   5. Validar URL real (não pode ser categoria/pesquisa) + URL contém modelo.
router.get('/compare', heavyLimiter, async (req, res) => {
    const { q } = req.query;

    if (!SERPER_API_KEY) return res.status(500).json({ error: 'SERPER_API_KEY não configurada' });
    if (!q) return res.status(400).json({ error: 'Parâmetro "q" obrigatório' });

    const cacheKey = `compare_v3_${q}`;
    const cachedData = getCached(cacheKey);
    if (cachedData) return res.json(cachedData);

    try {
        console.log(`[compare] A procurar preços para: ${q}`);

        if (!isQuerySpecificEnough(q)) {
            console.log(`[compare] Query "${q}" muito genérica. A devolver vazio.`);
            const result = { shops: [] };
            setCache(cacheKey, result);
            return res.json(result);
        }

        const queryModel = extractModelIdentifier(q);
        if (queryModel) console.log(`[compare] Model identifier: ${queryModel}`);

        // === ESTRATÉGIA PRINCIPAL: productId ===
        const allOffers = await fetchAllShoppingOffers(q);
        console.log(`[compare] ${allOffers.length} ofertas retornadas, ${allOffers.filter(o => o.productId).length} com productId`);

        let shops = [];
        let usedFallback = false;

        const dominantPid = pickDominantProductId(allOffers, queryModel);

        if (dominantPid) {
            console.log(`[compare] productId dominante: ${dominantPid}`);
            const matchingOffers = allOffers.filter(o =>
                o.productId === dominantPid && isStoreVerified(o.source)
            );

            // Dedupe per store: manter só a oferta mais barata por loja
            const bestPerStore = new Map();
            for (const offer of matchingOffers) {
                const price = parsePrice(offer.price);
                if (price <= 0) continue;
                const key = (offer.source || '').toLowerCase();
                const existing = bestPerStore.get(key);
                if (!existing || price < parsePrice(existing.price)) {
                    bestPerStore.set(key, offer);
                }
            }

            shops = Array.from(bestPerStore.values()).map(offer => ({
                name: offer.source,
                price: parsePrice(offer.price).toFixed(2),
                offerTitle: offer.title,
                link: getStoreDirectLink(offer.source, q, offer.link),
                _resolvedUrl: null,
            }));
            console.log(`[compare] productId match deu ${shops.length} lojas`);
        }

        // === FALLBACK: nenhum productId ou productId match deu < 2 lojas ===
        if (shops.length < 2) {
            usedFallback = true;
            console.log(`[compare] Fallback para per-store queries (${shops.length} via productId)`);
            const existingStoreKeys = new Set(shops.map(s => (s.name || '').toLowerCase()));

            const fallbackOffers = await Promise.all(
                TARGET_STORES_FOR_COMPARE.map(s => fetchStoreOffer(q, s))
            );

            TARGET_STORES_FOR_COMPARE.forEach((store, idx) => {
                if (!fallbackOffers[idx]) {
                    console.warn(`[compare] ${store.name}: sem match para "${q}"`);
                }
            });

            for (const offer of fallbackOffers) {
                if (!offer) continue;
                const price = parsePrice(offer.price);
                if (price <= 0) continue;
                const storeKey = (offer.source || '').toLowerCase();
                if (existingStoreKeys.has(storeKey)) continue; // já temos via productId
                shops.push({
                    name: offer.source,
                    price: price.toFixed(2),
                    offerTitle: offer.title,
                    link: getStoreDirectLink(offer.source, q, offer.link),
                    _resolvedUrl: null,
                });
                existingStoreKeys.add(storeKey);
            }
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
            // Mantemos shop.offerTitle - o frontend mostra-o para o user perceber
            // se a loja está a anunciar uma variante diferente (cor/storage/bundle).
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

        // 5) Ordenar pela loja mais barata
        validShops.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

        const strategy = usedFallback ? 'productId+fallback' : (dominantPid ? 'productId' : 'fallback');
        console.log(`[compare] ✅ "${q}" → ${validShops.length} lojas válidas (estratégia: ${strategy})`);

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
