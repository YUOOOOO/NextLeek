# syntax=docker/dockerfile:1
# NextLeek 多目标镜像：frontend / server / strategy-api / data-api
# 用法：docker compose up --build

# ---------- 前端静态资源 ----------
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY frontend frontend
# 空字符串 = 浏览器同域请求 /api（由 nginx 反代）
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build -w frontend

FROM nginx:1.27-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80

# ---------- Express BFF ----------
FROM node:22-bookworm-slim AS server-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY server server
RUN npm run build -w server

FROM node:22-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev
COPY --from=server-build /app/server/dist /app/server/dist
WORKDIR /app/server
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]

# ---------- 研究 / 信号引擎 ----------
FROM python:3.12-slim-bookworm AS strategy-api
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY strategy-api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY strategy-api /app
ENV PYTHONUNBUFFERED=1
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001"]

# ---------- AkShare 行情薄层 ----------
FROM python:3.12-slim-bookworm AS data-api
WORKDIR /app
COPY data-api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY data-api /app
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
