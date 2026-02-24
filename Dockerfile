# Dockerfile para ARM64 (Ubuntu) com Playwright
FROM mcr.microsoft.com/playwright:v1.42.0-jammy

WORKDIR /app

# Copiar arquivos do projeto
COPY package*.json ./
RUN npm install --production

COPY . .

# Porta padrão
EXPOSE 3001

# Variáveis de ambiente padrão
ENV PORT=3001
ENV NODE_ENV=production

# Comando para iniciar
CMD ["node", "index.js"]
