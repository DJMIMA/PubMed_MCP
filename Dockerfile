# ── Stage 1: ビルド ───────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# 依存関係を先にコピーしてレイヤーキャッシュを活用
COPY package*.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./
RUN npm run build

# ── Stage 2: 実行イメージ ─────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# dumb-init: SIGTERM を正しくアプリへ転送し、Cloud Run のグレースフルシャットダウンを実現
RUN apt-get update \
    && apt-get install -y --no-install-recommends dumb-init \
    && rm -rf /var/lib/apt/lists/*

# 本番依存のみインストール
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ビルド済み成果物をコピー
COPY --from=builder /app/dist ./dist

# root 以外のユーザーで実行（セキュリティベストプラクティス）
USER 1000:1000

# Cloud Run はデフォルトで 8080 番ポートを使用する
EXPOSE 8080
ENV PORT=8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
