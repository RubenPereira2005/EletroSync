/**
 * store-scraper.js - descobre o URL direto do produto numa loja específica.
 *
 * Em vez de fazer scraping do HTML (que não funciona para lojas SPA como
 * Worten/Rádio Popular), usamos o Google via Serper com queries do tipo
 *   `site:worten.pt iphone 15`
 * que devolvem URLs orgânicos indexados pelo Google - sempre válidos.
 *
 * Cada loja tem um padrão de URL que identifica páginas de produto reais
 * (vs páginas de categoria, blog, etc.) para filtrar resultados.
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;

// Cache persistente em disco com TTL adaptativo:
//   - URLs (chave sem prefixo): 7 dias - raramente mudam
//   - "price::" prefixo: 2 horas - preços mudam mais frequentemente
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
        // Produtos Fnac: slug obrigatório com pelo menos 2 letras antes do /aNNNNN
        // (ex: /smartphone-apple-iphone-15/a11254244). Sem o slug, /a1, /a99 e
        // outros URLs curtos eram falsamente aceites como produto.
        isProductUrl: (url) => /fnac\.pt\/[a-z0-9][a-z0-9-]{2,}\/a\d{4,}/i.test(url),
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
// Se tivermos a ScraperAPI_KEY configurada, conseguimos contornar a proteção
// de Cloudflare / anti-bot para Worten, FNAC e PCDiga fazendo o fetch das páginas
// através da ScraperAPI. Sem ela, apenas a Rádio Popular funciona por fetch direto.

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Determina se a loja é suportada para live scraping de preços
function isPriceFetchSupported(storeKey) {
    if (SCRAPERAPI_KEY) {
        // Com ScraperAPI, suportamos todas as lojas configuradas
        return storeKey && STORES[storeKey] !== undefined;
    }
    // Sem ScraperAPI, apenas a Rádio Popular aceita ligação direta sem Cloudflare
    return storeKey === 'radio popular';
}

async function fetchHtml(url) {
    const hasScraperApi = !!SCRAPERAPI_KEY;
    // ScraperAPI pode demorar a rodar os proxies residenciais, aumentamos para 60s.
    const timeoutMs = hasScraperApi ? 60000 : 5000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let fetchUrl = url;
    if (hasScraperApi) {
        // Se for a FNAC, usamos proxies residenciais europeus (premium=true & country_code=eu)
        // para contornar o bloqueio da Cloudflare de forma muito mais fiável e rápida.
        const isFnac = url.includes('fnac.pt');
        const extraParams = isFnac ? '&premium=true&country_code=eu' : '';
        fetchUrl = `http://api.scraperapi.com/?api_key=${encodeURIComponent(SCRAPERAPI_KEY)}&url=${encodeURIComponent(url)}${extraParams}`;
        console.log(`[live-price] A carregar via ScraperAPI (Params: ${extraParams || 'standard'}): ${url}`);
    } else {
        console.log(`[live-price] A carregar diretamente: ${url}`);
    }

    try {
        // Com ScraperAPI limpamos os headers para deixar o proxy gerir o user-agent
        const headers = hasScraperApi ? {} : {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
            'Upgrade-Insecure-Requests': '1',
        };

        const res = await fetch(fetchUrl, {
            headers,
            signal: ctrl.signal,
            redirect: 'follow',
        });
        if (!res.ok) {
            console.error(`[live-price] Falha no fetch (HTTP ${res.status}): ${url}`);
            return null;
        }
        return await res.text();
    } catch (err) {
        console.error(`[live-price] Erro no fetch / timeout: ${err.message} para ${url}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function extractPriceFromHtml(html) {
    if (!html) return null;

    // Tentativa 0: meta itemprop="price" content="VALUE" (evita apanhar divs de produtos recomendados)
    const mMeta = html.match(/<meta[^>]+itemprop=["']price["'][^>]+content=["']([0-9.,]+)/i)
               || html.match(/<meta[^>]+content=["']([0-9.,]+)["'][^>]+itemprop=["']price["']/i);
    if (mMeta) {
        const n = parseFloat(mMeta[1].replace(',', '.'));
        if (!isNaN(n) && n > 1) return n;
    }

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

function getCleanProductHtml(html) {
    if (!html) return '';
    try {
        const $ = cheerio.load(html);
        
        // Remove common non-product-content elements
        $('script, style, iframe, header, footer, noscript, nav').remove();
        
        // Remove carousels / recommendations / similar products (cross-selling)
        $('[class*="carousel"], [class*="slider"], [class*="recommend"], [class*="sugest"], [class*="similar"], [class*="relacionados"]').remove();
        $('[id*="carousel"], [id*="slider"], [id*="recommend"], [id*="sugest"], [id*="similar"], [id*="relacionados"]').remove();
        
        // Remove reviews / opinions / comments / Q&A
        $('[class*="review"], [class*="opinion"], [class*="comentar"], [class*="avaliacao"], [class*="rating"], [class*="perguntas"]').remove();
        $('[id*="review"], [id*="opinion"], [id*="comentar"], [id*="avaliacao"], [id*="rating"], [id*="perguntas"]').remove();

        // Remove store pickup / click & collect elements (to avoid false out-of-stock from store-only unavailability)
        $('[class*="pickup"], [class*="levantamento"], [class*="clickcollect"]').remove();
        $('[id*="pickup"], [id*="levantamento"], [id*="clickcollect"]').remove();

        return $.html();
    } catch (e) {
        console.error('[getCleanProductHtml] erro com cheerio:', e.message);
        // Fallback para limpeza simples via string/regex
        let clean = html;
        const headerEnd = clean.toLowerCase().indexOf('</header>');
        if (headerEnd !== -1) clean = clean.slice(headerEnd);
        const footerStart = clean.toLowerCase().indexOf('<footer');
        if (footerStart !== -1) clean = clean.slice(0, footerStart);
        clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        return clean;
    }
}

function checkAvailabilityFromHtml(storeKey, html) {
    if (!html) return true;

    // 1. Limpar o HTML para focar apenas na área de produto (excluindo header, footer, scripts e carrosséis)
    const cleanHtml = getCleanProductHtml(html);
    const htmlLower = cleanHtml.toLowerCase();

    // 2. Verificação Standard Schema.org OutOfStock / OutOfStore
    if (/schema\.org\/OutOfStock/i.test(htmlLower) || /schema\.org\/OutOfStore/i.test(htmlLower) || /schema\.org\/InStoreOnly/i.test(htmlLower)) {
        return false;
    }

    // 3. Verificação de tags específicas do Open Graph de stock
    if (/<meta[^>]+property=["']og:availability["'][^>]+content=["'](instock|oos|out of stock|esgotado|indisponivel)["']/i.test(cleanHtml)) {
        const match = cleanHtml.match(/<meta[^>]+property=["']og:availability["'][^>]+content=["']([^"']+)["']/i);
        if (match) {
            const status = match[1].toLowerCase();
            if (status.includes('out') || status.includes('oos') || status.includes('esgotado') || status.includes('indisponivel')) {
                return false;
            }
        }
    }

    // 4. Fallbacks textuais específicos para cada loja na secção limpa (Negativos primeiro!)
    if (storeKey === 'fnac') {
        if (htmlLower.includes('produto indisponível') || 
            htmlLower.includes('indisponível online') || 
            htmlLower.includes('esgotado temporariamente') ||
            htmlLower.includes('este produto já não se encontra disponível') ||
            htmlLower.includes('indisponivel online') ||
            htmlLower.includes('stock esgotado') ||
            htmlLower.includes('esgotado em fnac.pt') ||
            htmlLower.includes('indisponível em loja') ||
            htmlLower.includes('indisponivel em loja') ||
            htmlLower.includes('produto esgotado') ||
            htmlLower.includes('artigo indisponível') ||
            htmlLower.includes('artigo indisponivel')) {
            return false;
        }
    } else if (storeKey === 'worten') {
        if (htmlLower.includes('sem stock') || 
            htmlLower.includes('indisponível para entrega') || 
            htmlLower.includes('temporariamente indisponível') ||
            htmlLower.includes('indisponivel para entrega') ||
            htmlLower.includes('temporariamente indisponivel') ||
            htmlLower.includes('produto esgotado') ||
            htmlLower.includes('esgotado') ||
            htmlLower.includes('artigo indisponível') ||
            htmlLower.includes('artigo indisponivel')) {
            return false;
        }
    } else if (storeKey === 'pc diga') {
        if (htmlLower.includes('esgotado') || 
            htmlLower.includes('sem stock') || 
            htmlLower.includes('artigo indisponível') ||
            htmlLower.includes('artigo indisponivel') ||
            htmlLower.includes('indisponivel')) {
            return false;
        }
    } else if (storeKey === 'radio popular') {
        if (htmlLower.includes('produto indisponível') || 
            htmlLower.includes('produto indisponivel') || 
            htmlLower.includes('artigo indisponível') ||
            htmlLower.includes('artigo indisponivel') ||
            htmlLower.includes('sem stock') ||
            htmlLower.includes('esgotado') ||
            htmlLower.includes('temporariamente indisponível') ||
            htmlLower.includes('temporariamente indisponivel')) {
            return false;
        }
    }

    // 5. Confirmação Positiva do Botão de Compra (Se não deu negativo, confirma que botão existe)
    if (storeKey === 'radio popular' && htmlLower.includes('adicionar ao carrinho')) {
        return true;
    }
    if (storeKey === 'worten' && htmlLower.includes('adicionar ao carrinho')) {
        return true;
    }
    if (storeKey === 'fnac' && htmlLower.includes('adicionar ao cesto')) {
        return true;
    }

    return true;
}

async function fetchLivePrice(storeName, productUrl) {
    if (!storeName || !productUrl) return { price: null, available: true };
    const key = resolveStoreKey(storeName);
    if (!key || !isPriceFetchSupported(key)) return { price: null, available: true };

    const cacheKey = `price_v2::${productUrl}`;
    const cached = getCached(cacheKey);
    if (cached !== null) return cached;

    try {
        const html = await fetchHtml(productUrl);
        const price = extractPriceFromHtml(html);
        const available = checkAvailabilityFromHtml(key, html);
        const result = { price, available };
        if (price !== null) {
            setCache(cacheKey, result);
        }
        return result;
    } catch (e) {
        console.error(`[live-price] ${storeName} → ${e.message}`);
        return { price: null, available: true };
    }
}

// Verifica se uma URL é uma página de produto real numa das lojas parceiras.
// Útil para filtrar resultados Serper sem custo extra: se a Serper devolveu
// um link que NÃO bate com o padrão de produto (ex: página de categoria,
// pesquisa, blog), descartamos antes de mostrar ao utilizador.
function isVerifiedProductUrl(url) {
    if (!url || typeof url !== 'string') return false;
    for (const store of Object.values(STORES)) {
        try { if (store.isProductUrl(url)) return true; } catch {}
    }
    return false;
}

module.exports = { resolveProductUrl, fetchLivePrice, isVerifiedProductUrl };
