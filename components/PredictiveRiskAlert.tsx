/**
 * Predictive Risk Alert System - Main Component
 * 
 * This component provides a comprehensive asthma risk monitoring system:
 * 1. Fetches current location
 * 2. Gets real-time environmental data (AQI, weather, pollen)
 * 3. Sends engineered pollution features to the trained risk model
 * 4. Sends proactive alerts if conditions match past triggers
 * 5. Supports geofencing for automatic monitoring
 * 
 * NO AI/ML MODELS USED - Pure rule-based logic
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Switch,
  Alert,
  ScrollView,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/utils/supabase';
import { getCurrentLocation, requestBackgroundLocationPermission, getLocationPermissionStatus } from '@/utils/geofencing';
import { fetchEnvironmentalData, EnvironmentalData } from '@/utils/environmentalDataAPI';
import { RiskAssessment } from '@/utils/riskAssessment';
import { predictRiskAtLocation, toRiskAssessment } from '@/utils/riskModelAPI';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendRiskAlert } from '@/utils/notificationService';
import { startBackgroundRiskMonitoring, stopBackgroundRiskMonitoring } from '@/utils/backgroundMonitoring';

export default function PredictiveRiskAlert() {
  const [loading, setLoading] = useState(false);
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [environmentalData, setEnvironmentalData] = useState<EnvironmentalData | null>(null);
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [checking, setChecking] = useState(false);
  const [monitorTimer, setMonitorTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [lastNotifyTs, setLastNotifyTs] = useState<number | null>(null);
  const monitoringEnabledRef = useRef(false);

  useEffect(() => {
    checkPermissions();
    // Restore monitoring toggle from storage
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('riskMonitoringEnabled');
        if (saved === 'true') {
          // Attempt to enable silently (no alerts/spinners)
          toggleMonitoring(true, { silent: true });
        }
      } catch {}
    })();

    // Restore last notification timestamp for cooldown
    (async () => {
      try {
        const ts = await AsyncStorage.getItem('riskNotifyLastTs');
        if (ts) setLastNotifyTs(Number(ts));
      } catch {}
    })();

    // Keep monitoring active when returning to foreground
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (monitoringEnabledRef.current) {
          checkCurrentRisk();
        }
      }
    });

    return () => {
      sub.remove();
      // Cleanup interval on unmount
      if (monitorTimer) {
        clearInterval(monitorTimer);
      }
    };
  }, []);

  /**
   * Check if we have necessary permissions
   */
  const checkPermissions = async () => {
    const permissions = await getLocationPermissionStatus();
    setHasLocationPermission(permissions.foreground);
  };

  /**
   * Main function to check current risk level
   * Performs the complete workflow:
   * 1. Get location
   * 2. Fetch environmental data and model features
   * 3. Request a model prediction
   * 4. Display alert if risky
   */
  const checkCurrentRisk = async () => {
    try {
      // Prevent overlapping manual/background runs
      if (checking) {
        return;
      }
      setChecking(true);

      // Step 1: Get current user ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please log in to use risk monitoring');
        return;
      }

      // Step 2: Get current location
      const location = await getCurrentLocation();
      if (!location) {
        Alert.alert(
          'Location Required',
          'Please enable location services to check asthma risk in your area.'
        );
        return;
      }

      setCurrentLocation({ lat: location.latitude, lon: location.longitude });

      // Step 3: Use only Open-Meteo engineered pollution features for prediction.
      const prediction = await predictRiskAtLocation(location.latitude, location.longitude);
      const assessment = toRiskAssessment(prediction);
      setRiskAssessment(assessment);
      setLastCheckTime(new Date());

      // The legacy weather/pollen panel is supplementary and must not block
      // the model result when its optional providers are unavailable.
      const envData = await fetchEnvironmentalData(location.latitude, location.longitude);
      if (envData) {
        setEnvironmentalData(envData);
      }

      // Step 4: Display alert based on risk level
      displayRiskAlert(assessment, envData);
    } catch (error) {
      // Error handled silently
      Alert.alert('Error', 'Failed to check risk. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  /**
   * Display appropriate alert based on risk level
   */
  const displayRiskAlert = (assessment: RiskAssessment, envData: EnvironmentalData | null) => {
    // Also send a local notification when risk is medium/high, with 1-minute cooldown
    if (assessment.isRisky) {
      const now = Date.now();
      const last = lastNotifyTs ?? 0;
      if (now - last >= 60 * 1000) {
        sendRiskAlert(assessment)
          .then(async () => {
            setLastNotifyTs(now);
            await AsyncStorage.setItem('riskNotifyLastTs', String(now));
          })
          .catch(() => {
            // Notification error handled silently
          });
      }
    }
    // Suppress modal alerts too if within cooldown window
    const nowTs = Date.now();
    if (lastNotifyTs && nowTs - lastNotifyTs < 60 * 1000) {
      return; // Skip showing alert popups repeatedly
    }
    if (assessment.riskLevel === 'high') {
      Alert.alert(
        '🚨 HIGH ASTHMA RISK ALERT',
        `The model estimates a ${assessment.riskProbability! * 100}% environmental risk.\n\n` +
        `Model probability: ${Math.round((assessment.riskProbability ?? 0) * 100)}%\n\n` +
        `Risk Factors:\n${assessment.riskFactors.slice(0, 3).join('\n')}\n\n` +
        `Recommendations:\n${assessment.recommendations.slice(0, 2).join('\n')}`,
        [
          { text: 'View Details', onPress: () => {} },
          { text: 'OK', style: 'cancel' },
        ]
      );
    } else if (assessment.riskLevel === 'medium') {
      Alert.alert(
        '⚠️ Moderate Asthma Risk',
        `The model estimates a ${Math.round((assessment.riskProbability ?? 0) * 100)}% environmental risk.\n\n` +
        `Be prepared:\n${assessment.recommendations.slice(0, 2).join('\n')}`,
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert(
        '✅ Low Risk',
        `The model estimates a ${Math.round((assessment.riskProbability ?? 0) * 100)}% environmental risk.` +
        (envData
          ? `\n\nCurrent Conditions:\nAQI: ${envData.aqi}\nTemperature: ${envData.temperature}°C\nHumidity: ${envData.humidity}%`
          : ''),
        [{ text: 'Great!' }]
      );
    }
  };

  /**
   * Toggle automatic monitoring
   */
  const startForegroundMonitoring = () => {
    // Avoid duplicating intervals
    if (monitoringEnabledRef.current) {
      return;
    }
    setMonitoringEnabled(true);
    monitoringEnabledRef.current = true;
    if (monitorTimer) {
      clearInterval(monitorTimer);
    }
    const timer = setInterval(() => {
      // Skip if a run is already in progress
      if (!checking) {
        checkCurrentRisk();
      }
    }, 1 * 60 * 1000);
    setMonitorTimer(timer);
  };

  const toggleMonitoring = async (enabled: boolean, options?: { silent?: boolean }) => {
    if (enabled) {
      if (monitoringEnabledRef.current) {
        // Already monitoring; avoid duplicating interval
        if (!options?.silent) {
          Alert.alert('Monitoring Active', 'Risk monitoring is already enabled.');
        }
        return;
      }
      // Request background permissions for continuous monitoring (foreground-only fallback)
      const granted = await requestBackgroundLocationPermission();
      if (!granted) {
        // In silent/rehydration mode, still enable foreground monitoring without background permission
        if (options?.silent) {
          startForegroundMonitoring();
          await AsyncStorage.setItem('riskMonitoringEnabled', 'true');
          return;
        }
        Alert.alert(
          'Permission Required',
          'Background location permission is needed for automatic risk monitoring.\n\n⚠️ If you see an error, you need to rebuild the app:\n\n1. Run: npx expo prebuild --clean\n2. Run: npx expo run:android\n\nFor now, you can use "Check Risk Now" manually.',
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Start periodic monitoring; optionally skip immediate check
      if (!options?.silent) {
        await checkCurrentRisk();
      }
      // Check every 5 minutes in foreground; for background use TaskManager
      startForegroundMonitoring();

      // Attempt to start background monitoring (dev/production build required)
      await startBackgroundRiskMonitoring().catch(() => {});
      
      await AsyncStorage.setItem('riskMonitoringEnabled', 'true');
      if (!options?.silent) {
        Alert.alert('Monitoring Enabled', 'QAir will check your asthma risk automatically as you move around.', [{ text: 'Great!' }]);
      }
    } else {
      setMonitoringEnabled(false);
      monitoringEnabledRef.current = false;
      if (monitorTimer) {
        clearInterval(monitorTimer);
        setMonitorTimer(null);
      }
      // Stop background monitoring if running
      await stopBackgroundRiskMonitoring().catch(() => {});
      await AsyncStorage.setItem('riskMonitoringEnabled', 'false');
      Alert.alert(
        'Monitoring Disabled', 
        'Automatic risk checking has been turned off.',
        [{ text: 'OK' }]
      );
    }
  };

  /**
   * Get risk level color
   */
  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high': return '#EF4444';
      case 'medium': return '#F59E0B';
      case 'low': return '#10B981';
      default: return '#6B7280';
    }
  };

  /**
   * Get AQI category and color
   */
  const getAQIInfo = (aqi: number) => {
    if (aqi <= 50) return { category: 'Good', color: '#10B981' };
    if (aqi <= 100) return { category: 'Moderate', color: '#F59E0B' };
    if (aqi <= 150) return { category: 'Unhealthy for Sensitive', color: '#F97316' };
    if (aqi <= 200) return { category: 'Unhealthy', color: '#EF4444' };
    if (aqi <= 300) return { category: 'Very Unhealthy', color: '#9333EA' };
    return { category: 'Hazardous', color: '#7C2D12' };
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#0F172A' }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <LinearGradient
          colors={['#4F46E5', '#6366F1']}
          className="p-6 pb-8 rounded-b-3xl">
          <View className="flex-row items-center mb-2">
            <Ionicons name="shield-checkmark" size={32} color="white" />
            <Text className="text-white text-2xl font-bold ml-3">Risk Monitor</Text>
          </View>
          <Text className="text-indigo-100 text-sm">
            Model-based alerts from current pollution conditions
          </Text>
        </LinearGradient>

        {/* Auto-Monitoring Toggle */}
        <View className="bg-white/10 mx-5 mt-5 rounded-3xl p-5 shadow-md" style={{ elevation: 4, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-4">
              <Text className="text-slate-100 font-bold text-lg">Automatic Monitoring</Text>
              <Text className="text-slate-300 text-sm mt-1">
                Get alerts when entering risky areas
              </Text>
            </View>
            <Switch
              value={monitoringEnabled}
              onValueChange={toggleMonitoring}
              trackColor={{ false: '#475569', true: '#6366F1' }}
              thumbColor={monitoringEnabled ? '#FFFFFF' : '#CBD5E1'}
            />
          </View>
        </View>

        {/* Manual Check Button removed as requested */}

        {/* Current Risk Status */}
        {riskAssessment && (
          <View className="bg-white/10 mx-5 mt-5 rounded-3xl p-5 shadow-md" style={{ elevation: 4, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }}>
            <Text className="text-slate-100 font-bold text-xl mb-4">Current Risk Level</Text>
            
            <View
              className="rounded-2xl p-6 mb-4"
              style={{ backgroundColor: getRiskColor(riskAssessment.riskLevel) + '30', borderWidth: 2, borderColor: getRiskColor(riskAssessment.riskLevel) }}>
              <View className="flex-row items-center justify-between mb-3">
                <Text
                  className="font-bold text-2xl"
                  style={{ color: getRiskColor(riskAssessment.riskLevel) }}>
                  {riskAssessment.riskLevel.toUpperCase()}
                </Text>
                <Text className="text-slate-300 text-lg">
                  {Math.round((riskAssessment.riskProbability ?? 0) * 100)}% probability
                </Text>
              </View>
              
              <Text className="text-slate-200">
                Random Forest environmental risk estimate
              </Text>
            </View>

            {riskAssessment.riskFactors.length > 0 && (
              <View className="mb-4">
                <Text className="text-slate-100 font-bold mb-2">Risk Factors:</Text>
                {riskAssessment.riskFactors.map((factor, index) => (
                  <View key={index} className="flex-row items-start mb-2">
                    <Ionicons name="warning-outline" size={16} color="#FFA500" style={{ marginTop: 2 }} />
                    <Text className="text-slate-300 text-sm ml-2 flex-1">{factor}</Text>
                  </View>
                ))}
              </View>
            )}

            {riskAssessment.recommendations.length > 0 && (
              <View>
                <Text className="text-slate-100 font-bold mb-2">Recommendations:</Text>
                {riskAssessment.recommendations.map((rec, index) => (
                  <View key={index} className="flex-row items-start mb-2">
                    <Ionicons name="checkmark-circle" size={16} color="#10B981" style={{ marginTop: 2 }} />
                    <Text className="text-slate-300 text-sm ml-2 flex-1">{rec}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Environmental Data */}
        {environmentalData && (
          <View className="bg-white/10 mx-5 mt-5 rounded-3xl p-5 shadow-md" style={{ elevation: 4, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }}>
            <Text className="text-slate-100 font-bold text-xl mb-4">Current Conditions</Text>
            
            <View className="space-y-3">
              {/* AQI */}
              <View className="flex-row items-center justify-between p-3 bg-white/5 rounded-xl">
                <View className="flex-row items-center">
                  <Ionicons name="cloud" size={24} color="#818CF8" />
                  <Text className="text-slate-200 font-semibold ml-3">Air Quality</Text>
                </View>
                <View className="items-end">
                  <Text className="text-slate-100 font-bold text-lg">{environmentalData.aqi}</Text>
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: getAQIInfo(environmentalData.aqi).color }}>
                    {getAQIInfo(environmentalData.aqi).category}
                  </Text>
                </View>
              </View>

              {/* Temperature */}
              <View className="flex-row items-center justify-between p-3 bg-white/5 rounded-xl">
                <View className="flex-row items-center">
                  <Ionicons name="thermometer" size={24} color="#F97316" />
                  <Text className="text-slate-200 font-semibold ml-3">Temperature</Text>
                </View>
                <Text className="text-slate-100 font-bold text-lg">{environmentalData.temperature}°C</Text>
              </View>

              {/* Humidity */}
              <View className="flex-row items-center justify-between p-3 bg-white/5 rounded-xl">
                <View className="flex-row items-center">
                  <Ionicons name="water" size={24} color="#3B82F6" />
                  <Text className="text-slate-200 font-semibold ml-3">Humidity</Text>
                </View>
                <Text className="text-slate-100 font-bold text-lg">{environmentalData.humidity}%</Text>
              </View>

              {/* Pollen */}
              <View className="flex-row items-center justify-between p-3 bg-white/5 rounded-xl">
                <View className="flex-row items-center">
                  <Ionicons name="flower" size={24} color="#EC4899" />
                  <Text className="text-slate-200 font-semibold ml-3">Pollen Level</Text>
                </View>
                <Text className="text-slate-100 font-bold text-lg capitalize">
                  {environmentalData.pollenLevel.replace('_', ' ')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Last Check Time */}
        {lastCheckTime && (
          <View className="mx-5 mt-3 mb-6">
            <Text className="text-slate-400 text-sm text-center">
              Last checked: {lastCheckTime.toLocaleTimeString()}
            </Text>
          </View>
        )}

        {/* Info Box */}
        <View className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-4 mx-5 mb-6">
          <View className="flex-row items-start">
            <Ionicons name="information-circle" size={24} color="#60A5FA" />
            <View className="flex-1 ml-3">
              <Text className="text-blue-300 font-bold mb-1">How it works</Text>
              <Text className="text-blue-200 text-sm">
                This system compares current environmental conditions (AQI, temperature, humidity, pollen) 
                with your past asthma trigger history using rule-based logic. No AI models used.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
