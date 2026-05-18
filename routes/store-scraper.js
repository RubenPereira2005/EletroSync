/**
 * store-scraper.js — descobre o URL direto do produto numa loja específica.
 *
 * Em vez de fazer scraping do HTML (que não funciona para lojas SPA como
 * Worten/Rádio Popular), usamos o Google via Serper com queries do tipo
 *   `site:worten.pt iphone 15`
 * que devolvem URLs orgânicos indexados pelo Google — sempre válidos.
 *
 * Cada loja tem um padrão de URL que identifica páginas de produto reais
 * (vs páginas de categoria, blog, etc.) para filtrar resultados.
 */

const fs = require('fs');
const path = require('path');

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_SEARCH_URL = 'https://google.serper.dev/search';

// Cache persistente em disco com TTL adaptativo:
//   - URLs (chave sem prefixo): 7 dias — raramente mudam
//   - "price::" prefixo: 2 horas — preços mudam mais frequentemente
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'store-urls.json');
const TTL_URLS  = 7 * 24 * 60 * 60 * 1000; // 7 dias
const TTL_PRICE = 2 * 60 * 60 * 1000;      // 2 horas
const SAVE_DEBOUNCE_MS = 3000;

function getTTL(key) {
    return key.startsWith('price::') ? TTL_PRICE : TTL_URLS;
}

let cache = {};

try {
    if (fs.existsSync(CACHE_FILE)) {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        const now = Date.now();
        let expired = 0;
        for (const key of Object.keys(cache)) {
            const ttl = getTTL(key);
            if (!cache[key] || (now - cache[key].timestamp) >= ttl) {
                delete cache[key];
                expired++;
            }
        }
        console.log(`[store-scraper cache] Carregado ${Object.keys(cache).length} entradas (${expired} expiradas)`);
    }
} catch (e) {
    console.error('[store-scraper cache] Erro ao carregar:', e.message);
    cache = {};
}

let saveTimer = null;
function persistCache() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
        } catch (e) {
            console.error('[store-scraper cache] Erro ao gravar:', e.message);
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

// =============================================================================
// CONFIGURAÇÃO POR LOJA
// =============================================================================

const STORES = {
    'worten': {
        site: 'worten.pt',
        // Páginas de produto contêm /produtos/ no path
        isProductUrl: (url) => /worten\.pt\/produtos\//i.test(url),
    },
    'fnac': {
        site: 'fnac.pt',
        // Produtos Fnac começam com /aNNNNN (ex: /a11254244)
        isProductUrl: (url) => /fnac\.pt\/[^/]+\/a\d+/i.test(url) || /fnac\.pt\/a\d+/i.test(url),
    },
    'radio popular': {
        site: 'radiopopular.pt',
        // Produtos contêm /produto/ no path
        isProductUrl: (url) => /radiopopular\.pt\/produto\//i.test(url),
    },
    'pc diga': {
        site: 'pcdiga.com',
        // Produtos contêm vários segmentos com "-" e ID numérico no fim
        // Excluir páginas /blog/ e categorias curtas
        isProductUrl: (url) => /pcdiga\.com\/[^/]+\/[^/]+\/.+\d+$/i.test(url) && !/\/blog\//i.test(url),
    },
};

// Aliases para variantes do nome da loja
const STORE_ALIASES = {
    'rádio popular': 'radio popular',
    'radiopopular':  'radio popular',
    'pcdiga':        'pc diga',
};

function resolveStoreKey(storeName) {
    if (!storeName) return null;
    const lower = String(storeName).toLowerCase().trim();
    if (STORES[lower]) return lower;
    if (STORE_ALIASES[lower]) return STORE_ALIASES[lower];
    // Match parcial (ex: "Worten.pt" → "worten")
    for (const k of Object.keys(STORES)) {
        if (lower.includes(k)) return k;
    }
    for (const [alias, target] of Object.entries(STORE_ALIASES)) {
        if (lower.includes(alias)) return target;
    }
    return null;
}

// Remove parâmetros de tracking comuns (?srsltid=..., utm_*)
function cleanUrl(url) {
    try {
        const u = new URL(url);
        const trackingParams = ['srsltid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
        trackingParams.forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch {
        return url;
    }
}

// =============================================================================
// CHAMADA SERPER
// =============================================================================

async function serperSiteSearch(site, query) {
    if (!SERPER_API_KEY) throw new Error('SERPER_API_KEY em falta');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);

    try {
        const res = await fetch(SERPER_SEARCH_URL, {
            method: 'POST',
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                q: `site:${site} ${query}`,
                gl: 'pt',
                hl: 'pt',
                num: 10,
            }),
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
        const data = await res.json();
        return data.organic || [];
    } finally {
        clearTimeout(timer);
    }
}

// =============================================================================
// API PÚBLICA
// =============================================================================

/**
 * Tenta obter o URL direto do produto na loja `storeName` para o nome `query`.
 * Devolve null se a loja não é suportada ou se nenhum resultado bater certo.
 */
async function resolveProductUrl(storeName, query) {
    if (!storeName || !query) return null;

    const key = resolveStoreKey(storeName);
    if (!key) return null;
    const store = STORES[key];

    const cacheKey = `${key}::${query}`;
    const cached = getCached(cacheKey);
    if (cached !== null) return cached;

    try {
        const organic = await serperSiteSearch(store.site, query);

        // SÓ aceitar resultados que pareçam URL de produto real
        // (sem fallback: melhor devolver null do que um URL de categoria/pesquisa)
        for (const result of organic) {
            const link = result.link;
            if (link && store.isProductUrl(link)) {
                const clean = cleanUrl(link);
                setCache(cacheKey, clean);
                return clean;
            }
        }

        setCache(cacheKey, null);
        return null;
    } catch (e) {
        console.error(`[store-scraper] ${storeName} "${query}" → ${e.message}`);
        return null;
    }
}

// =============================================================================
// EXTRAÇÃO DE PREÇO REAL DA PÁGINA DA LOJA
// =============================================================================
// Para Worten e Rádio Popular conseguimos fetchar a página HTML e extrair o
// preço atualizado do JSON-LD ou meta-tags. Para FNAC e PCDiga estão bloqueados
// por Cloudflare/anti-bot, devolvemos null.

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PRICE_TIMEOUT_MS = 5000;

async function fetchHtml(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PRICE_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
                'Upgrade-Insecure-Requests': '1',
            },
            signal: ctrl.signal,
            redirect: 'follow',
        });
        if (!res.ok) return null;
        return await res.text();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function extractPriceFromHtml(html) {
    if (!html) return null;
    // Tentativa 1: JSON-LD com Product schema: "price":"VALUE" ou "price":VALUE
    const m1 = html.match(/"price"\s*:\s*"?([0-9]+(?:[.,][0-9]{1,2})?)"?/);
    if (m1) {
        const n = parseFloat(m1[1].replace(',', '.'));
        if (!isNaN(n) && n > 1) return n;
    }
    // Tentativa 2: meta property="product:price:amount"
    const m2 = html.match(/product:price:amount["'][^>]*content=["']([0-9.,]+)/);
    if (m2) {
        const n = parseFloat(m2[1].replace(',', '.'));
        if (!isNaN(n) && n > 1) return n;
    }
    // Tentativa 3: itemprop="price" content="VALUE"
    const m3 = html.match(/itemprop=["']price["'][^>]*content=["']([0-9.,]+)/);
    if (m3) {
        const n = parseFloat(m3[1].replace(',', '.'));
        if (!isNaN(n) && n > 1) return n;
    }
    return null;
}

// Lojas que ainda permitem fetch HTML direto (sem Cloudflare ou anti-bot):
// - Worten, FNAC, PCDiga estão atrás de Cloudflare → bloqueiam server-side fetch
// - Rádio Popular ainda permite acesso direto
const PRICE_FETCH_SUPPORTED = new Set(['radio popular']);

async function fetchLivePrice(storeName, productUrl) {
    if (!storeName || !productUrl) return null;
    const key = resolveStoreKey(storeName);
    if (!key || !PRICE_FETCH_SUPPORTED.has(key)) return null;

    const cacheKey = `price::${productUrl}`;
    const cached = getCached(cacheKey);
    if (cached !== null) return cached;

    try {
        const html = await fetchHtml(productUrl);
        const price = extractPriceFromHtml(html);
        if (price !== null) {
            setCache(cacheKey, price);
        }
        return price;
    } catch (e) {
        console.error(`[live-price] ${storeName} → ${e.message}`);
        return null;
    }
}

module.exports = { resolveProductUrl, fetchLivePrice };
