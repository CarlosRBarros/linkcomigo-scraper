const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

// Aplicar stealth plugin
chromium.use(stealth);

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.SCRAPER_API_KEY || 'linkcomigo-scraper-secret-2026';

app.use(cors());
app.use(express.json());

// Middleware de autenticacao
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Health check (sem auth)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Funcao para criar browser com stealth
async function createStealthBrowser() {
    return await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
}

// Funcao para criar contexto com headers realistas
async function createStealthContext(browser) {
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        geolocation: { latitude: -23.5505, longitude: -46.6333 },
        permissions: ['geolocation']
    });

    return context;
}

// Funcao para simular comportamento humano
async function simulateHumanBehavior(page) {
    // Delay aleatorio inicial (1-3s)
    await page.waitForTimeout(Math.random() * 2000 + 1000);

    // Movimentos de mouse aleatorios
    await page.mouse.move(Math.random() * 800 + 200, Math.random() * 600 + 100, { steps: 10 });
    await page.waitForTimeout(300);
    await page.mouse.move(Math.random() * 800 + 200, Math.random() * 600 + 100, { steps: 10 });

    // Rolagem humana (scroll suave)
    await page.evaluate(() => {
        window.scrollBy({ top: window.innerHeight * 0.3, behavior: 'smooth' });
    });
    await page.waitForTimeout(800);

    // Mais um movimento de mouse
    await page.mouse.move(Math.random() * 800 + 200, Math.random() * 600 + 200, { steps: 10 });

    // Mais scroll
    await page.evaluate(() => {
        window.scrollBy({ top: window.innerHeight * 0.2, behavior: 'smooth' });
    });
    await page.waitForTimeout(500);
}

// Endpoint principal de scraping
app.post('/scrape', authMiddleware, async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`[SCRAPER] Processing: ${url}`);

    let browser = null;

    try {
        browser = await createStealthBrowser();
        const context = await createStealthContext(browser);
        const page = await context.newPage();

        // Headers extras pra parecer real
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        });

        // Bloquear recursos desnecessarios (economiza tempo)
        await page.route('**/*', route => {
            const type = route.request().resourceType();
            if (['stylesheet', 'font', 'media'].includes(type)) {
                return route.abort();
            }
            return route.continue();
        });

        // Timeout de 30 segundos
        page.setDefaultTimeout(30000);

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Aguardar carregamento inicial
        await page.waitForTimeout(3000);

        // Simular comportamento humano
        await simulateHumanBehavior(page);

        // Aguardar mais um pouco para SPA carregar
        await page.waitForTimeout(2000);

        // Debug: log do titulo da pagina e URL final
        const pageTitle = await page.title();
        const finalUrl = page.url();
        console.log(`[SCRAPER] Page title: ${pageTitle}`);
        console.log(`[SCRAPER] Final URL: ${finalUrl}`);

        // Extrair metadados
        const metadata = await page.evaluate(() => {
            const getMeta = (name) => {
                const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                return el?.content || '';
            };

            // Tentar pegar titulo do produto
            let title = getMeta('og:title') || getMeta('twitter:title') || document.title || '';

            // AliExpress especifico: tentar multiplos seletores do produto
            const titleSelectors = [
                '[data-pl="product-title"]',
                '.product-title-text',
                '.title--wrap--UUHae_g h1',
                '.pdp-info h1',
                '[class*="ProductTitle"] h1',
                '[class*="product-title"]',
                'h1[class*="title"]',
                'h1'
            ];

            for (const sel of titleSelectors) {
                const el = document.querySelector(sel);
                if (el?.textContent && el.textContent.trim().length > 5) {
                    const text = el.textContent.trim();
                    if (!text.includes('AliExpress') || text.length > 30) {
                        title = text;
                        break;
                    }
                }
            }

            // Imagem
            let image = getMeta('og:image') || getMeta('twitter:image') || '';

            // AliExpress especifico: multiplos seletores de imagem
            const imageSelectors = [
                '.magnifier-image img',
                '[data-pl="product-image"] img',
                '.image-view-item img',
                '.slider--img--K7bnXf3 img',
                '.pdp-info img',
                '[class*="Gallery"] img',
                '[class*="slider"] img',
                '.image-container img',
                'img[src*="alicdn"]'
            ];

            for (const sel of imageSelectors) {
                const el = document.querySelector(sel);
                if (el?.src && el.src.startsWith('http') && !el.src.includes('favicon') && el.src.includes('alicdn')) {
                    image = el.src;
                    break;
                }
            }

            // Descricao
            let description = getMeta('og:description') || getMeta('description') || '';

            // Preco (AliExpress) - multiplos seletores
            const priceSelectors = [
                '[data-pl="product-price"]',
                '.product-price-value',
                '.uniform-banner-box-price',
                '[class*="Price"] span',
                '.es--wrap--erdmPRe',
                '[class*="price"]'
            ];

            let price = '';
            for (const sel of priceSelectors) {
                const el = document.querySelector(sel);
                if (el?.textContent && /[\d,.]/.test(el.textContent)) {
                    price = el.textContent.trim();
                    break;
                }
            }

            return {
                title: title.trim(),
                description: description.trim().slice(0, 300),
                image: image,
                price: price,
                url: window.location.href
            };
        });

        await browser.close();
        browser = null;

        console.log(`[SCRAPER] Success: ${metadata.title?.slice(0, 50)}...`);

        res.json({
            success: true,
            data: metadata
        });

    } catch (error) {
        console.error(`[SCRAPER] Error:`, error.message);

        if (browser) {
            await browser.close();
        }

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint de debug - captura screenshot (com auth)
app.post('/debug', authMiddleware, async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`[DEBUG] Capturing: ${url}`);

    let browser = null;

    try {
        browser = await createStealthBrowser();
        const context = await createStealthContext(browser);
        const page = await context.newPage();

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Upgrade-Insecure-Requests': '1'
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);
        await simulateHumanBehavior(page);

        // Capturar screenshot
        const screenshot = await page.screenshot({ type: 'png', fullPage: false });
        const pageTitle = await page.title();
        const finalUrl = page.url();
        const html = await page.content();

        await browser.close();

        res.json({
            success: true,
            debug: {
                pageTitle,
                finalUrl,
                htmlLength: html.length,
                htmlPreview: html.substring(0, 3000),
                screenshot: screenshot.toString('base64')
            }
        });

    } catch (error) {
        if (browser) await browser.close();
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint de teste (com auth)
app.get('/test', authMiddleware, async (req, res) => {
    const testUrl = 'https://www.aliexpress.com/item/1005006123456789.html';
    res.json({
        message: 'Scraper is working with stealth mode',
        testUrl,
        usage: {
            method: 'POST',
            endpoint: '/scrape',
            body: { url: testUrl },
            headers: { Authorization: 'Bearer YOUR_API_KEY' }
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SCRAPER] Running on port ${PORT} with stealth mode`);
    console.log(`[SCRAPER] Health check: http://localhost:${PORT}/health`);
});
