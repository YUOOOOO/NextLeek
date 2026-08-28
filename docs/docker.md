# Docker

根目录 `Dockerfile` 是多目标镜像：`frontend` / `server` / `strategy-api` / `data-api`。

```bash
docker compose up --build
```

打开：http://localhost:8080

Tushare 密钥不要写进镜像，用环境变量或仓库根目录 `.env`（已 gitignore）：

```
TUSHARE_PROMAX_KEY=...
TUSHARE_PROVIDER=auto
```

数据落在 named volume：`strategy-data`（parquet 湖 / live 历史）、`strategy-cache`、`strategy-results`。
