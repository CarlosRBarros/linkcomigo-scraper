# LinkComigo Scraper Service

Serviço de scraping com Playwright para extrair metadados de páginas SPA (AliExpress, Shopee, etc).

## Deploy no Oracle Cloud + Easypanel

### Passo 1: Preparar o Repositório

1. Crie um repositório no GitHub (ex: `linkcomigo-scraper`)
2. Faça push APENAS da pasta `scraper/`:
   ```bash
   cd scraper
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/SEU_USER/linkcomigo-scraper.git
   git push -u origin main
   ```

### Passo 2: Deploy no Easypanel

1. Acesse seu Easypanel (ex: https://panel.seu-ip.nip.io)
2. **Create Project** → Nome: `scraper`
3. **Add Service** → **App**
4. Configure:
   - **Source**: GitHub
   - **Repository**: `SEU_USER/linkcomigo-scraper`
   - **Branch**: `main`
   - **Build**: Dockerfile
   - **Dockerfile Path**: `Dockerfile`

5. **Environment Variables**:
   ```
   PORT=3001
   SCRAPER_API_KEY=SUA_CHAVE_SECRETA_AQUI
   NODE_ENV=production
   ```

6. **Resources** (importante para ARM64 + Playwright):
   - Memory Limit: `4096 MB`
   - Memory Reservation: `1024 MB`

7. **Advanced** → Docker Options:
   - Shared Memory Size: `2g`

8. **Domains**:
   - Crie um domínio (ex: `scraper.seu-dominio.com`)
   - OU use o IP + porta: `http://IP_DA_VPS:3001`

9. Clique **Deploy**

### Passo 3: Configurar no Firebase

Após o deploy, pegue a URL do scraper e configure no Firebase Functions:

```bash
# No diretório api/
# Edite o .env e adicione:
SCRAPER_URL=https://scraper.seu-dominio.com
SCRAPER_API_KEY=SUA_CHAVE_SECRETA_AQUI
```

Depois faça deploy:
```bash
firebase deploy --only functions
```

### Oracle Cloud Free Tier - Notas

- Instância ARM (Ampere A1) funciona perfeitamente
- 24GB RAM é mais que suficiente
- Playwright ARM64 é suportado nativamente
- Firewall: libere a porta 3001 nas Security Lists

## Endpoints

### Health Check
```
GET /health
```
Resposta: `{ "status": "ok", "timestamp": "..." }`

### Scrape URL
```
POST /scrape
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "url": "https://www.aliexpress.com/item/123456.html"
}
```

Resposta:
```json
{
  "success": true,
  "data": {
    "title": "Nome do Produto",
    "description": "Descrição...",
    "image": "https://...",
    "price": "R$ 99,90",
    "url": "https://..."
  }
}
```

## Integração com Firebase

Após o deploy, atualize a variável no Firebase Functions:

```bash
# No diretório api/
echo "SCRAPER_URL=https://seu-dominio.com" >> .env
echo "SCRAPER_API_KEY=linkcomigo-scraper-secret-2026" >> .env
```

## Teste Local

```bash
npm install
npm start

# Em outro terminal:
curl http://localhost:3001/health
```

## Segurança

- **IMPORTANTE**: Troque a `SCRAPER_API_KEY` para uma chave forte!
- O endpoint `/scrape` requer autenticação
- Apenas `/health` é público

## Troubleshooting

### Erro "Browser not found"
O container precisa de memória compartilhada. No Easypanel, configure `shm_size: 2gb`.

### Timeout em sites
Aumente o timeout no código (padrão: 30s) ou verifique se o site está bloqueando.

### ARM64
A imagem `mcr.microsoft.com/playwright:v1.42.0-jammy` suporta ARM64 nativamente.
