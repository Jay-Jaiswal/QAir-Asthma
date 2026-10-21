FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY risk-model-api/requirements.txt /app/risk-model-api/requirements.txt
RUN pip install --no-cache-dir -r /app/risk-model-api/requirements.txt

COPY risk-model-api /app/risk-model-api
COPY model /app/model

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app:app --app-dir /app/risk-model-api --host 0.0.0.0 --port ${PORT}"]
