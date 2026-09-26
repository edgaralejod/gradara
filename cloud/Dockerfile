# Gradara AI gateway (Cloud Run). Build from the repository root:
#   docker build -f cloud/Dockerfile -t gradara-gateway .
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY cloud/requirements.txt cloud/requirements.txt
RUN pip install --no-cache-dir -r cloud/requirements.txt && useradd --create-home --uid 10001 gateway
# Only the dependency-light provider layer is shared with the desktop service.
COPY server/__init__.py server/__init__.py
COPY server/llm/__init__.py server/llm/providers.py server/llm/schema.py server/llm/
COPY cloud/gateway cloud/gateway
USER gateway
WORKDIR /app/cloud
# --no-access-log: uvicorn access lines include query strings; the app logs its own privacy-safe line.
CMD ["sh", "-c", "exec uvicorn --factory gateway.app:main --host 0.0.0.0 --port ${PORT} --no-access-log --proxy-headers --forwarded-allow-ips='*'"]
