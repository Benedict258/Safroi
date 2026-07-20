FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup -g 1001 safroi && adduser -D -u 1001 -G safroi safroi

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/firebase-config.json ./

USER safroi

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/server.cjs"]
