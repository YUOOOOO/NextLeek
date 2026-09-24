# 前端 dist + 手机端 dist 打进后端镜像, 单容器对外 3018。
# 国内网络: --build-arg USE_CN_MIRROR=1 (默认开)
ARG USE_CN_MIRROR=1
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG PYPI_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PYPI_FALLBACK=https://mirrors.aliyun.com/pypi/simple

# === 电脑端 ===
FROM node:22-alpine AS frontend
ARG USE_CN_MIRROR=1
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /build
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry "$NPM_REGISTRY"; fi
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# === 手机端 ===
FROM node:22-alpine AS mobile
ARG USE_CN_MIRROR=1
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /build/mobile
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry "$NPM_REGISTRY"; fi
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci
COPY frontend /build/frontend
COPY mobile /build/mobile
RUN npm run build


# === 运行时 ===
FROM python:3.11-slim AS runtime
ARG USE_CN_MIRROR=1
ARG PYPI_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PYPI_FALLBACK=https://mirrors.aliyun.com/pypi/simple
WORKDIR /app

RUN if [ "$USE_CN_MIRROR" = "1" ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list 2>/dev/null || true; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends tzdata curl \
    && rm -rf /var/lib/apt/lists/*

RUN if [ "$USE_CN_MIRROR" = "1" ]; then \
      pip install --no-cache-dir uv -i "$PYPI_INDEX" || \
      pip install --no-cache-dir uv -i "$PYPI_FALLBACK" || \
      pip install --no-cache-dir uv; \
    else \
      pip install --no-cache-dir uv; \
    fi

COPY backend/pyproject.toml backend/uv.lock ./
COPY backend/app ./app
RUN if [ "$USE_CN_MIRROR" = "1" ]; then \
      export UV_DEFAULT_INDEX="$PYPI_INDEX" UV_EXTRA_INDEX_URL="$PYPI_FALLBACK"; \
    fi; \
    uv sync --frozen --no-dev

COPY tiers.yaml /app/tiers.yaml
COPY --from=frontend /build/dist /app/static
COPY --from=mobile /build/mobile/dist /app/static/m
RUN mkdir -p /app/data

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app \
    TZ=Asia/Shanghai \
    DATA_DIR=/app/data \
    TIERS_YAML=/app/tiers.yaml \
    NEXTLEEK_STATIC_DIR=/app/static \
    NEXTLEEK_DATABASE_URL=sqlite:////app/data/nextleek.db \
    TICKFLOW_ENV_FILE=/app/.env \
    UV_DEFAULT_INDEX=${PYPI_INDEX} \
    UV_EXTRA_INDEX_URL=${PYPI_FALLBACK}

EXPOSE 3018
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3018/health >/dev/null || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3018"]
