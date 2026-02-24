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
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            locale: 'pt-BR'
        });

        const page = await context.newPage();

        // Timeout de 30 segundos
        page.setDefaultTimeout(30000);

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Aguardar o conteúdo carregar (SPAs como AliExpress)
        await page.waitForTimeout(3000);

        // Extrair metadados
        const metadata = await page.evaluate(() => {
            const getMeta = (name) => {
                const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                return el?.content || '';
            };

            // Tentar pegar título do produto
            let title = getMeta('og:title') || getMeta('twitter:title') || document.title || '';

            // AliExpress específico: tentar seletores do produto
            const aliTitle = document.querySelector('[data-pl="product-title"]')?.textContent
                || document.querySelector('.product-title-text')?.textContent
                || document.querySelector('h1')?.textContent;

            if (aliTitle) title = aliTitle.trim();

            // Imagem
            let image = getMeta('og:image') || getMeta('twitter:image') || '';

            // AliExpress específico: imagem do produto
            const aliImage = document.querySelector('.magnifier-image img')?.src
                || document.querySelector('[data-pl="product-image"] img')?.src
                || document.querySelector('.image-view-item img')?.src;

            if (aliImage) image = aliImage;

            // Descrição
            let description = getMeta('og:description') || getMeta('description') || '';

            // Preço (AliExpress)
            const priceEl = document.querySelector('[data-pl="product-price"]')
                || document.querySelector('.product-price-value')
                || document.querySelector('.uniform-banner-box-price');
            const price = priceEl?.textContent?.trim() || '';

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
