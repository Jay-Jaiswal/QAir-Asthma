# QAir risk model API

This FastAPI service loads `model/respira_random_forest.pkl` with joblib and
exposes the trained Random Forest through `POST /predict`. The model contract is
the three engineered features below, in this exact order:

- `pm2_5_24h_mean`
- `nitrogen_dioxide_24h_mean`
- `ozone_8h_max`

The service rejects extra fields, non-finite values, missing class `1`, and a
model whose feature names do not match the contract. Risk levels are engineering
thresholds, not medical advice:

- `< 0.50`: low
- `0.50-0.79`: medium
- `>= 0.80`: high

## Run locally

From the repository root:

```text
python -m venv .venv
.venv\Scripts\activate
pip install -r risk-model-api\requirements.txt
uvicorn app:app --app-dir risk-model-api --host 0.0.0.0 --port 8000
```

Set `RISK_MODEL_PATH` to use a model at a different location. The mobile app
must set `EXPO_PUBLIC_RISK_MODEL_API_URL` to the reachable `/predict` URL.

Example request:

```json
{
  "pm2_5_24h_mean": 60.2,
  "nitrogen_dioxide_24h_mean": 16.54,
  "ozone_8h_max": 129.5
}
```

The development endpoint intentionally has no authentication. Put it behind
authentication and HTTPS before production deployment; do not expose the model
file.

## Deploy with Render

The repository includes [`render.yaml`](../render.yaml) and
[`Dockerfile`](./Dockerfile). Create a Render Web Service from this repository
and choose the included Blueprint configuration. Render will build the image,
copy the model file, expose `/health`, and provide an HTTPS service URL.

The mobile URL is the Render URL plus `/predict`, for example:

```text
https://qair-risk-model-api.onrender.com/predict
```

The API currently has no authentication. Add authentication and rate limiting
before making it available publicly.
