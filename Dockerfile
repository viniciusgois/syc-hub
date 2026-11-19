# SYC Hub: um serviço só (a API também entrega as telas do frontend) + PostgreSQL à parte.
# Construído pelo Dokploy a partir do GitHub. Ao subir, aplica as migrações novas do banco (nunca o seed).

# ---------- build ----------
FROM node:22.22.0-alpine3.22 AS build
RUN apk add --no-cache openssl
WORKDIR /app

# Dependências primeiro (cache: só reinstala quando os package*.json mudam)
COPY backend/package.json backend/package-lock.json backend/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm ci --prefix backend --include=dev && npm ci --prefix frontend --include=dev

COPY . .

# Commit no ar (lido pelo /api/health). O Dokploy clona o repositório e deixa a pasta .git no contexto do build.
RUN c=""; \
    if [ -f .git/HEAD ]; then \
      h=$(cat .git/HEAD); \
      case "$h" in \
        "ref: "*) r=${h#ref: }; c=$(cat ".git/$r" 2>/dev/null || grep " $r\$" .git/packed-refs 2>/dev/null | cut -d' ' -f1) ;; \
        *) c=$h ;; \
      esac; \
    fi; \
    echo "${c:-desconhecido}" > /app/commit && echo "commit: $(cat /app/commit)"

# Front sem VITE_API_URL: chama /api no mesmo domínio
RUN npm run build --prefix backend && npm run build --prefix frontend \
 && npm prune --prefix backend --omit=dev \
 && npx --prefix backend prisma generate --schema backend/prisma/schema.prisma

# ---------- execução ----------
FROM node:22.22.0-alpine3.22
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production \
    SERVE_FRONTEND=true \
    FRONTEND_DIST=/app/frontend/dist \
    PORT=3000
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/frontend/dist /app/frontend/dist
COPY --from=build /app/commit /app/commit

USER node
EXPOSE 3000
# O Swarm só troca para a versão nova depois que ela responde aqui (e volta para a anterior se não responder)
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/server.js"]
