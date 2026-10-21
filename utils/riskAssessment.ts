// Predictive Risk Alert System
// Rule-based comparison engine to detect risky conditions based on user's trigger history

import { supabase } from './supabase';
import { EnvironmentalData, ModelFeatures } from './environmentalDataAPI';

// Thresholds for similarity matching (adjustable based on user sensitivity)
export const SIMILARITY_THRESHOLDS = {
  AQI_DIFFERENCE: 25, // AQI within ±25 is considered similar
  HUMIDITY_DIFFERENCE: 15, // Humidity within ±15% is similar
  TEMPERATURE_DIFFERENCE: 5, // Temperature within ±5°C is similar
  POLLEN_LEVEL_INCREASE: true, // Alert if pollen is same or higher
  PM25_DIFFERENCE: 10, // PM2.5 within ±10 is similar
  DISTANCE_THRESHOLD_KM: 2, // Alert if within 2km of past trigger location
};

export type TriggerRecord = {
  id: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  aqi?: number;
  pm25?: number;
  pm10?: number;
  temperature?: number;
  humidity?: number;
};

export type RiskAssessment = {
  isRisky: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  matchedTriggers: TriggerRecord[];
  riskFactors: string[];
  recommendations: string[];
  similarityScore: number; // 0-100, how similar to past triggers
  riskProbability?: number;
  modelFeatures?: ModelFeatures;
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param lat1 Latitude of point 1
 * @param lon1 Longitude of point 1
 * @param lat2 Latitude of point 2
 * @param lon2 Longitude of point 2
 * @returns Distance in kilometers
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
};

/**
 * Check if current environmental data matches a past trigger
 * Uses rule-based logic with configurable thresholds
 * @param currentData Current environmental conditions
 * @param trigger Past trigger event data
 * @returns Similarity score (0-100) and matching factors
 */
export const calculateTriggerSimilarity = (
  currentData: EnvironmentalData,
  trigger: TriggerRecord
): { score: number; matchingFactors: string[] } => {
  let matchingFactors: string[] = [];
  let totalScore = 0;
  let maxScore = 0;

  // 1. Check AQI similarity (weight: 30 points)
  maxScore += 30;
  if (trigger.aqi && currentData.aqi) {
    const aqiDiff = Math.abs(currentData.aqi - trigger.aqi);
    if (aqiDiff <= SIMILARITY_THRESHOLDS.AQI_DIFFERENCE) {
      const aqiScore = 30 * (1 - aqiDiff / SIMILARITY_THRESHOLDS.AQI_DIFFERENCE);
      totalScore += aqiScore;
      matchingFactors.push(`AQI similar (${currentData.aqi} vs ${trigger.aqi})`);
    }
  }

  // 2. Check humidity similarity (weight: 20 points)
  maxScore += 20;
  if (trigger.humidity && currentData.humidity) {
    const humidityDiff = Math.abs(currentData.humidity - trigger.humidity);
    if (humidityDiff <= SIMILARITY_THRESHOLDS.HUMIDITY_DIFFERENCE) {
      const humidityScore = 20 * (1 - humidityDiff / SIMILARITY_THRESHOLDS.HUMIDITY_DIFFERENCE);
      totalScore += humidityScore;
      matchingFactors.push(`Humidity similar (${currentData.humidity}% vs ${trigger.humidity}%)`);
    }
  }

  // 3. Check temperature similarity (weight: 15 points)
  maxScore += 15;
  if (trigger.temperature && currentData.temperature) {
    const tempDiff = Math.abs(currentData.temperature - trigger.temperature);
    if (tempDiff <= SIMILARITY_THRESHOLDS.TEMPERATURE_DIFFERENCE) {
      const tempScore = 15 * (1 - tempDiff / SIMILARITY_THRESHOLDS.TEMPERATURE_DIFFERENCE);
      totalScore += tempScore;
      matchingFactors.push(`Temperature similar (${currentData.temperature}°C vs ${trigger.temperature}°C)`);
    }
  }

  // 4. Check PM2.5 similarity (weight: 20 points)
  maxScore += 20;
  if (trigger.pm25 && currentData.pm25) {
    const pm25Diff = Math.abs(currentData.pm25 - trigger.pm25);
    if (pm25Diff <= SIMILARITY_THRESHOLDS.PM25_DIFFERENCE) {
      const pm25Score = 20 * (1 - pm25Diff / SIMILARITY_THRESHOLDS.PM25_DIFFERENCE);
      totalScore += pm25Score;
      matchingFactors.push(`PM2.5 similar (${currentData.pm25} vs ${trigger.pm25})`);
    }
  }

  // 5. Check location proximity (weight: 15 points)
  maxScore += 15;
  const distance = calculateDistance(
    currentData.latitude,
    currentData.longitude,
    trigger.latitude,
    trigger.longitude
  );
  if (distance <= SIMILARITY_THRESHOLDS.DISTANCE_THRESHOLD_KM) {
    const locationScore = 15 * (1 - distance / SIMILARITY_THRESHOLDS.DISTANCE_THRESHOLD_KM);
    totalScore += locationScore;
    matchingFactors.push(`Near past trigger location (${distance.toFixed(2)}km away)`);
  }

  // Calculate final similarity percentage
  const similarityPercentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

  return {
    score: Math.round(similarityPercentage),
    matchingFactors,
  };
};

/**
 * Fetch user's trigger history from database
 * @param userId User ID
 * @param limit Maximum number of triggers to fetch (default: 50 recent triggers)
 * @returns Array of past trigger records
 */
export const fetchUserTriggerHistory = async (
  userId: string,
  limit: number = 50
): Promise<TriggerRecord[]> => {
  try {
    const { data, error } = await supabase
      .from('inhaler_triggers')
      .select('*')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching trigger history:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchUserTriggerHistory:', error);
    return [];
  }
};

/**
 * Check if current environmental conditions match user's past triggers
 * Main risk assessment function
 * @param currentData Current environmental data
 * @param userId User ID
 * @returns Risk assessment with recommendations
 */
export const checkTriggerSimilarity = async (
  currentData: EnvironmentalData,
  userId: string
): Promise<RiskAssessment> => {
  try {
    console.log('Checking trigger similarity for user:', userId);

    // Fetch user's trigger history
    const triggerHistory = await fetchUserTriggerHistory(userId);

    console.log(`📚 Found ${triggerHistory.length} triggers in database`);

    if (triggerHistory.length === 0) {
      console.log('No trigger history found for user');
      return {
        isRisky: false,
        riskLevel: 'low',
        matchedTriggers: [],
        riskFactors: [],
        recommendations: ['Start tracking your triggers to get personalized alerts!'],
        similarityScore: 0,
      };
    }

    // Compare current data with each past trigger
    const similarities = triggerHistory.map((trigger) => {
      const similarity = calculateTriggerSimilarity(currentData, trigger);
      console.log(`🔍 Trigger ${trigger.id.substring(0, 8)}... Score: ${similarity.score}% Factors: [${similarity.matchingFactors.join(', ')}]`);
      return {
        trigger,
        ...similarity,
      };
    });

    // Sort by similarity score (highest first)
    similarities.sort((a, b) => b.score - a.score);
    
    console.log(`🏆 Best match: ${similarities[0]?.score || 0}% similarity`);

    // Get top matches (score >= 25% similarity)
    const significantMatches = similarities.filter((s) => s.score >= 25);

    // Determine risk level based on best match
    const highestScore = similarities[0]?.score || 0;
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    let isRisky = false;

    if (highestScore >= 50) {
      riskLevel = 'high';
      isRisky = true;
    } else if (highestScore >= 25) {
      riskLevel = 'medium';
      isRisky = true;
    }

    // Collect all risk factors from matched triggers
    const allRiskFactors = new Set<string>();
    significantMatches.forEach((match) => {
      match.matchingFactors.forEach((factor) => allRiskFactors.add(factor));
    });

    // Generate recommendations based on risk level
    const recommendations = generateRecommendations(riskLevel, currentData, significantMatches.length);

    return {
      isRisky,
      riskLevel,
      matchedTriggers: significantMatches.map((m) => m.trigger),
      riskFactors: Array.from(allRiskFactors),
      recommendations,
      similarityScore: highestScore,
    };
  } catch (error) {
    console.error('Error in checkTriggerSimilarity:', error);
    return {
      isRisky: false,
      riskLevel: 'low',
      matchedTriggers: [],
      riskFactors: [],
      recommendations: [],
      similarityScore: 0,
    };
  }
};

/**
 * Generate personalized recommendations based on risk level
 * @param riskLevel Current risk level
 * @param currentData Current environmental data
 * @param matchCount Number of matched triggers
 * @returns Array of recommendation strings
 */
const generateRecommendations = (
  riskLevel: 'low' | 'medium' | 'high',
  currentData: EnvironmentalData,
  matchCount: number
): string[] => {
  const recommendations: string[] = [];

  if (riskLevel === 'high') {
    recommendations.push('🚨 HIGH RISK: Keep your inhaler with you at all times');
    recommendations.push('Consider staying indoors if possible');
    recommendations.push(`This area has triggered asthma ${matchCount} time(s) before`);
  } else if (riskLevel === 'medium') {
    recommendations.push('⚠️ MODERATE RISK: Be prepared and monitor your symptoms');
    recommendations.push('Have your rescue inhaler accessible');
  }

  // Specific recommendations based on environmental factors
  if (currentData.aqi > 100) {
    recommendations.push('🌫️ Air quality is unhealthy - limit outdoor activities');
  }

  if (currentData.humidity > 70) {
    recommendations.push('💧 High humidity detected - a common asthma trigger');
  }

  if (currentData.pollenLevel === 'high' || currentData.pollenLevel === 'very_high') {
    recommendations.push('🌸 High pollen count - take allergy medication if prescribed');
  }

  if (currentData.temperature < 10 || currentData.temperature > 30) {
    recommendations.push('🌡️ Extreme temperature - breathe through your nose to warm/cool air');
  }

  return recommendations;
};

/**
 * Store the risk assessment in database for history tracking
 * @param userId User ID
 * @param riskAssessment Risk assessment result
 * @param currentData Current environmental data
 */
export const logRiskAssessment = async (
  userId: string,
  riskAssessment: RiskAssessment,
  currentData: EnvironmentalData
): Promise<void> => {
  try {
    // You can create a new table for risk alerts or use existing tables
    console.log('Risk assessment logged:', {
      userId,
      riskLevel: riskAssessment.riskLevel,
      location: `${currentData.latitude},${currentData.longitude}`,
      timestamp: new Date().toISOString(),
    });

    // Optional: Store in database for analytics
    // await supabase.from('risk_alerts').insert({ ... });
  } catch (error) {
    console.error('Error logging risk assessment:', error);
  }
};
