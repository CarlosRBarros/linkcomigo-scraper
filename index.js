const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.SCRAPER_API_KEY || 'linkcomigo-scraper-secret-2026';

app.use(cors());
app.use(express.json());

// Middleware de autenticação
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

// Endpoint principal de scraping
app.post('/scrape', authMiddleware, async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`[SCRAPER] Processing: ${url}`);

    let browser = null;

    try {
        // Usar channel 'chrome' para melhor compatibilidade anti-bot
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-size=1920,1080'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            locale: 'pt-BR',
            timezoneId: 'America/Sao_Paulo',
            geolocation: { latitude: -23.5505, longitude: -46.6333 },
            permissions: ['geolocation']
        });

        const page = await context.newPage();

        // Mascarar detecção de webdriver/automation
        await page.addInitScript(() => {
            // Remover propriedades que denunciam automação
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });

            // Simular chrome runtime
            window.chrome = { runtime: {} };

            // Override permissions query
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        });

        // Timeout de 30 segundos
        page.setDefaultTimeout(30000);

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Aguardar o conteúdo carregar (SPAs como AliExpress precisam de mais tempo)
        await page.waitForTimeout(8000);

        // Scroll para forçar lazy loading de imagens
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.waitForTimeout(2000);

        // Debug: log do título da página e URL final
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

            // Tentar pegar título do produto
            let title = getMeta('og:title') || getMeta('twitter:title') || document.title || '';

            // AliExpress específico: tentar múltiplos seletores do produto
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
                    // Ignorar títulos genéricos
                    if (!text.includes('AliExpress') || text.length > 30) {
                        title = text;
                        break;
                    }
                }
            }

            // Imagem
            let image = getMeta('og:image') || getMeta('twitter:image') || '';

            // AliExpress específico: múltiplos seletores de imagem
            const imageSelectors = [
                '.magnifier-image img',
                '[data-pl="product-image"] img',
                '.image-view-item img',
                '.slider--img--K7bnXf3 img',
                '.pdp-info img',
                '[class*="Gallery"] img',
                '[class*="slider"] img',
                '.image-container img'
            ];

            for (const sel of imageSelectors) {
                const el = document.querySelector(sel);
                if (el?.src && el.src.startsWith('http') && !el.src.includes('favicon')) {
                    image = el.src;
                    break;
                }
            }

            // Descrição
            let description = getMeta('og:description') || getMeta('description') || '';

            // Preço (AliExpress) - múltiplos seletores
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

// Endpoint de teste (com auth)
app.get('/test', authMiddleware, async (req, res) => {
    const testUrl = 'https://www.aliexpress.com/item/1005006123456789.html';
    res.json({
        message: 'Scraper is working',
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
    console.log(`[SCRAPER] Running on port ${PORT}`);
    console.log(`[SCRAPER] Health check: http://localhost:${PORT}/health`);
});
