import axios from 'axios';
import { fetchModelFeatures, ModelFeatures } from './environmentalDataAPI';
import { RiskAssessment } from './riskAssessment';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ModelPrediction = {
  prediction: 0 | 1;
  risk_probability: number;
  risk_level?: RiskLevel;
  features: ModelFeatures;
};

const MODEL_API_URL = process.env.EXPO_PUBLIC_RISK_MODEL_API_URL;

export const riskLevelFromProbability = (probability: number): RiskLevel => {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('Risk probability must be between 0 and 1');
  }
  if (probability >= 0.8) return 'high';
  if (probability >= 0.5) return 'medium';
  return 'low';
};

const validatePrediction = (value: unknown, features: ModelFeatures): ModelPrediction => {
  if (!value || typeof value !== 'object') throw new Error('Model API returned an invalid response');
  const response = value as Record<string, unknown>;
  const prediction = response.prediction;
  const probability = response.risk_probability;
  if ((prediction !== 0 && prediction !== 1) || typeof probability !== 'number') {
    throw new Error('Model API response is missing prediction fields');
  }
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('Model API returned an invalid risk probability');
  }
  return {
    prediction,
    risk_probability: probability,
    risk_level: riskLevelFromProbability(probability),
    features,
  };
};

export const predictRisk = async (features: ModelFeatures): Promise<ModelPrediction> => {
  if (!MODEL_API_URL) {
    throw new Error('EXPO_PUBLIC_RISK_MODEL_API_URL is not configured');
  }
  const response = await axios.post(MODEL_API_URL, features, { timeout: 10000 });
  return validatePrediction(response.data, features);
};

export const predictRiskAtLocation = async (
  latitude: number,
  longitude: number
): Promise<ModelPrediction> => predictRisk(await fetchModelFeatures(latitude, longitude));

export const toRiskAssessment = (prediction: ModelPrediction): RiskAssessment => {
  const riskLevel = prediction.risk_level || riskLevelFromProbability(prediction.risk_probability);
  const probabilityPercent = Math.round(prediction.risk_probability * 100);
  const { pm2_5_24h_mean, nitrogen_dioxide_24h_mean, ozone_8h_max } = prediction.features;

  return {
    isRisky: riskLevel !== 'low',
    riskLevel,
    matchedTriggers: [],
    similarityScore: probabilityPercent,
    riskProbability: prediction.risk_probability,
    modelFeatures: prediction.features,
    riskFactors: [
      `Model probability: ${probabilityPercent}%`,
      `PM2.5 24-hour mean: ${pm2_5_24h_mean.toFixed(2)}`,
      `NO2 24-hour mean: ${nitrogen_dioxide_24h_mean.toFixed(2)}`,
      `Ozone 8-hour maximum: ${ozone_8h_max.toFixed(2)}`,
    ],
    recommendations:
      riskLevel === 'high'
        ? ['Keep your inhaler accessible and consider limiting outdoor activity.']
        : riskLevel === 'medium'
          ? ['Be prepared and monitor your symptoms. Keep your rescue inhaler accessible.']
          : ['Continue monitoring your symptoms and local conditions.'],
  };
};
