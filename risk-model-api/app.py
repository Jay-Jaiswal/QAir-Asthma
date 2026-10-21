from pathlib import Path
import os
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field


FEATURE_NAMES = (
    "pm2_5_24h_mean",
    "nitrogen_dioxide_24h_mean",
    "ozone_8h_max",
)
MODEL_PATH = Path(
    os.getenv(
        "RISK_MODEL_PATH",
        str(Path(__file__).resolve().parent.parent / "model" / "respira_random_forest.pkl"),
    )
)


class ModelFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pm2_5_24h_mean: float = Field(..., description="24-hour arithmetic mean of PM2.5")
    nitrogen_dioxide_24h_mean: float = Field(..., description="24-hour arithmetic mean of NO2")
    ozone_8h_max: float = Field(..., description="Maximum rolling 8-hour ozone mean")


class PredictionResponse(ModelFeatures):
    prediction: int
    risk_probability: float
    risk_level: str


app = FastAPI(title="QAir Risk Model API", version="1.0.0")
_model: Any = None


def load_model() -> Any:
    global _model
    if _model is None:
        if not MODEL_PATH.is_file():
            raise RuntimeError(f"Model file not found: {MODEL_PATH}")
        _model = joblib.load(MODEL_PATH)
        if not hasattr(_model, "predict") or not hasattr(_model, "predict_proba"):
            raise RuntimeError("Configured model must provide predict and predict_proba")
        if list(getattr(_model, "feature_names_in_", ())) != list(FEATURE_NAMES):
            raise RuntimeError("Model feature names/order do not match the API contract")
    return _model


def risk_level(probability: float) -> str:
    if probability >= 0.8:
        return "high"
    if probability >= 0.5:
        return "medium"
    return "low"


@app.get("/health")
def health() -> dict[str, str]:
    try:
        load_model()
    except Exception as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {"status": "ok"}


@app.post("/predict", response_model=PredictionResponse)
def predict(features: ModelFeatures) -> PredictionResponse:
    values = [getattr(features, name) for name in FEATURE_NAMES]
    if not all(np.isfinite(values)):
        raise HTTPException(status_code=422, detail="All feature values must be finite")

    try:
        model = load_model()
        row = pd.DataFrame([values], columns=FEATURE_NAMES)
        prediction = int(model.predict(row)[0])
        classes = list(model.classes_)
        if 1 not in classes:
            raise RuntimeError("Model does not contain required class 1")
        probability = float(model.predict_proba(row)[0][classes.index(1)])
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Prediction unavailable: {error}") from error

    return PredictionResponse(
        **features.model_dump(),
        prediction=prediction,
        risk_probability=probability,
        risk_level=risk_level(probability),
    )
