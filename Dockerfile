FROM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NEXTLEEK_STATIC_DIR=/app/static \
    NEXTLEEK_DATABASE_URL=sqlite:////app/data/nextleek.db
COPY backend /app
RUN pip install --no-cache-dir .
COPY --from=frontend /frontend/dist /app/static
EXPOSE 3018
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3018"]
