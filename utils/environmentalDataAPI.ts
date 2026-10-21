// Environmental Data API Service
// Fetches real-time AQI, weather, and pollen data from public APIs

import axios from 'axios';

// API Keys - You need to get these from respective services
// OpenWeather: https://openweathermap.org/api
// Ambee: https://www.getambee.com/
const OPENWEATHER_API_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_API_KEY || 'YOUR_OPENWEATHER_KEY';
const AMBEE_API_KEY = process.env.EXPO_PUBLIC_AMBEE_API_KEY || 'YOUR_AMBEE_KEY';

export type EnvironmentalData = {
  latitude: number;
  longitude: number;
  aqi: number;
  pm25: number;
  pm10: number;
  temperature: number;
  humidity: number;
  pollenCount: number;
  pollenLevel: 'low' | 'medium' | 'high' | 'very_high';
  timestamp: string;
};

export type ModelFeatures = {
  pm2_5_24h_mean: number;
  nitrogen_dioxide_24h_mean: number;
  ozone_8h_max: number;
};

type OpenMeteoHourlyResponse = {
  hourly?: {
    time?: string[];
    pm2_5?: (number | null)[];
    nitrogen_dioxide?: (number | null)[];
    ozone?: (number | null)[];
  };
};

const hasFiniteValues = (values: (number | null)[]): values is number[] =>
  values.length > 0 && values.every((value) => typeof value === 'number' && Number.isFinite(value));

/**
 * Build the daily features used by the trained model.
 * The model was trained without imputation, so incomplete windows are rejected.
 */
export const buildModelFeatures = (
  pm25: (number | null)[],
  nitrogenDioxide: (number | null)[],
  ozone: (number | null)[]
): ModelFeatures => {
  if (pm25.length !== 24 || nitrogenDioxide.length !== 24 || ozone.length !== 24) {
    throw new Error('Exactly 24 hourly pollution values are required');
  }
  if (!hasFiniteValues(pm25) || !hasFiniteValues(nitrogenDioxide) || !hasFiniteValues(ozone)) {
    throw new Error('Hourly pollution data contains missing or invalid values');
  }

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ozoneMeans = Array.from({ length: ozone.length - 7 }, (_, start) =>
    mean(ozone.slice(start, start + 8))
  );

  return {
    pm2_5_24h_mean: mean(pm25),
    nitrogen_dioxide_24h_mean: mean(nitrogenDioxide),
    ozone_8h_max: Math.max(...ozoneMeans),
  };
};

/**
 * Fetch the latest complete 24-hour pollution window from Open-Meteo.
 */
export const fetchModelFeatures = async (lat: number, lon: number): Promise<ModelFeatures> => {
  const response = await axios.get<OpenMeteoHourlyResponse>(
    'https://air-quality-api.open-meteo.com/v1/air-quality',
    {
      params: {
        latitude: lat,
        longitude: lon,
        hourly: 'pm2_5,nitrogen_dioxide,ozone',
        past_days: 1,
        forecast_days: 1,
        timezone: 'UTC',
      },
      timeout: 10000,
    }
  );

  const hourly = response.data.hourly;
  const pm25 = hourly?.pm2_5;
  const nitrogenDioxide = hourly?.nitrogen_dioxide;
  const ozone = hourly?.ozone;
  if (!pm25 || !nitrogenDioxide || !ozone) {
    throw new Error('Open-Meteo response did not include all model pollutants');
  }

  return buildModelFeatures(pm25.slice(-24), nitrogenDioxide.slice(-24), ozone.slice(-24));
};

/**
 * Fetch Air Quality Index (AQI) data from OpenWeather API
 * @param lat Latitude
 * @param lon Longitude
 * @returns Air quality data including AQI, PM2.5, PM10
 */
export const fetchAirQualityData = async (
  lat: number,
  lon: number
): Promise<{ aqi: number; pm25: number; pm10: number } | null> => {
  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/air_pollution`,
      {
        params: {
          lat,
          lon,
          appid: OPENWEATHER_API_KEY,
        },
        timeout: 10000, // 10 second timeout
      }
    );

    if (response.data && response.data.list && response.data.list[0]) {
      const airData = response.data.list[0];
      return {
        aqi: airData.main.aqi * 50, // Convert OpenWeather scale (1-5) to AQI scale (0-500)
        pm25: airData.components.pm2_5 || 0,
        pm10: airData.components.pm10 || 0,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching air quality data:', error);
    return null;
  }
};

/**
 * Fetch weather data (temperature, humidity) from OpenWeather API
 * @param lat Latitude
 * @param lon Longitude
 * @returns Weather data including temperature and humidity
 */
export const fetchWeatherData = async (
  lat: number,
  lon: number
): Promise<{ temperature: number; humidity: number } | null> => {
  try {
    const response = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather`,
      {
        params: {
          lat,
          lon,
          appid: OPENWEATHER_API_KEY,
          units: 'metric', // Celsius
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.main) {
      return {
        temperature: response.data.main.temp,
        humidity: response.data.main.humidity,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return null;
  }
};

/**
 * Fetch pollen count data from Ambee API
 * @param lat Latitude
 * @param lon Longitude
 * @returns Pollen data including count and level
 */
export const fetchPollenData = async (
  lat: number,
  lon: number
): Promise<{ pollenCount: number; pollenLevel: 'low' | 'medium' | 'high' | 'very_high' } | null> => {
  try {
    // If no valid Ambee key, skip external call and return safe defaults
    if (!AMBEE_API_KEY || AMBEE_API_KEY === 'YOUR_AMBEE_KEY') {
      // Pollen is optional; avoid noisy errors when key isn't configured
      return { pollenCount: 0, pollenLevel: 'low' };
    }
    const response = await axios.get(
      `https://api.ambeedata.com/latest/pollen/by-lat-lng`,
      {
        params: {
          lat,
          lng: lon,
        },
        headers: {
          'x-api-key': AMBEE_API_KEY,
          'Content-type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.data && response.data.data[0]) {
      const pollenData = response.data.data[0];
      const totalCount = 
        (pollenData.Count?.grass_pollen || 0) +
        (pollenData.Count?.tree_pollen || 0) +
        (pollenData.Count?.weed_pollen || 0);

      // Classify pollen level based on total count
      let level: 'low' | 'medium' | 'high' | 'very_high' = 'low';
      if (totalCount > 200) level = 'very_high';
      else if (totalCount > 100) level = 'high';
      else if (totalCount > 50) level = 'medium';

      return {
        pollenCount: totalCount,
        pollenLevel: level,
      };
    }

    return null;
  } catch (error: any) {
    // Quiet fallback: return defaults without warning spam
    return {
      pollenCount: 0,
      pollenLevel: 'low',
    };
  }
};

/**
 * Fetch all environmental data for a location
 * Combines AQI, weather, and pollen data
 * @param lat Latitude
 * @param lon Longitude
 * @returns Complete environmental data
 */
export const fetchEnvironmentalData = async (
  lat: number,
  lon: number
): Promise<EnvironmentalData | null> => {
  try {
    console.log(`Fetching environmental data for location: ${lat}, ${lon}`);

    // Fetch all data in parallel for better performance
    const [airQuality, weather, pollen] = await Promise.all([
      fetchAirQualityData(lat, lon),
      fetchWeatherData(lat, lon),
      fetchPollenData(lat, lon),
    ]);

    // If we couldn't get air quality or weather, return null
    if (!airQuality || !weather) {
      console.error('Failed to fetch essential environmental data');
      return null;
    }

    const environmentalData: EnvironmentalData = {
      latitude: lat,
      longitude: lon,
      aqi: airQuality.aqi,
      pm25: airQuality.pm25,
      pm10: airQuality.pm10,
      temperature: weather.temperature,
      humidity: weather.humidity,
      pollenCount: pollen?.pollenCount || 0,
      pollenLevel: pollen?.pollenLevel || 'low',
      timestamp: new Date().toISOString(),
    };

    console.log('Environmental data fetched successfully:', environmentalData);
    return environmentalData;
  } catch (error) {
    console.error('Error in fetchEnvironmentalData:', error);
    return null;
  }
};

/**
 * Fallback: Use stored AQI data if API fails
 * This can fetch from your existing airQuality.ts utilities
 */
export const fetchFallbackAQI = async (lat: number, lon: number): Promise<number> => {
  // You can integrate with your existing airQuality.ts here
  // For now, return a safe default
  console.warn('Using fallback AQI data');
  return 50; // Moderate AQI as fallback
};
