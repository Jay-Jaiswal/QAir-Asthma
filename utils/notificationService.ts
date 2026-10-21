// Notification Service
// Send local push notifications for risk alerts

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { RiskAssessment } from './riskAssessment';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request notification permissions
 * @returns true if permission granted
 */
export const requestNotificationPermissions = async (): Promise<boolean> => {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Notification permission denied');
      return false;
    }

    // Configure notification channel for Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('asthma-alerts', {
        name: 'Asthma Risk Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#EF4444',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
      });
    }

    console.log('Notification permission granted');
    return true;
  } catch (error) {
    console.error('Error requesting notification permissions:', error);
    return false;
  }
};

/**
 * Send a risk alert notification
 * @param riskAssessment Risk assessment data
 * @param locationName Optional location name
 */
export const sendRiskAlert = async (
  riskAssessment: RiskAssessment,
  locationName?: string
): Promise<void> => {
  try {
    if (riskAssessment.riskLevel === 'low') {
      return;
    }
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) {
      console.log('Cannot send notification: permission denied');
      return;
    }

    // Global 1-minute cooldown to prevent spam
    const COOLDOWN_MS = 60 * 1000;
    try {
      const lastTsStr = await AsyncStorage.getItem('riskNotifyLastTs');
      const lastTs = lastTsStr ? Number(lastTsStr) : 0;
      const now = Date.now();
      if (now - lastTs < COOLDOWN_MS) {
        console.log('Risk alert suppressed due to cooldown');
        return;
      }
      await AsyncStorage.setItem('riskNotifyLastTs', String(now));
    } catch (e) {
      console.warn('Cooldown check failed, proceeding anyway', e);
    }

    // Determine notification content based on risk level
    let title = '';
    let body = '';
    let priority: Notifications.AndroidNotificationPriority = Notifications.AndroidNotificationPriority.DEFAULT;

    if (riskAssessment.riskLevel === 'high') {
      title = '🚨 HIGH ASTHMA RISK ALERT';
      body = `The model estimates a ${Math.round((riskAssessment.riskProbability ?? 1) * 100)}% environmental risk ${locationName ? `at ${locationName}` : 'in this area'}. Keep your inhaler ready.`;
      priority = Notifications.AndroidNotificationPriority.MAX;
    } else if (riskAssessment.riskLevel === 'medium') {
      title = '⚠️ Moderate Asthma Risk';
      body = `The model estimates a ${Math.round((riskAssessment.riskProbability ?? 0.5) * 100)}% environmental risk ${locationName ? `at ${locationName}` : 'in this area'}. Be prepared and monitor your symptoms.`;
      priority = Notifications.AndroidNotificationPriority.HIGH;
    } else {
      title = '✅ Low Risk Area';
      body = `Air quality ${locationName ? `at ${locationName}` : 'in this area'} looks good. Stay safe!`;
      priority = Notifications.AndroidNotificationPriority.DEFAULT;
    }

    // Add top risk factors to the body
    if (riskAssessment.riskFactors.length > 0) {
      body += `\n\n${riskAssessment.riskFactors.slice(0, 2).join('\n')}`;
    }

    // Schedule notification
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          riskLevel: riskAssessment.riskLevel,
          similarityScore: riskAssessment.similarityScore,
          matchedTriggers: riskAssessment.matchedTriggers.length,
          riskProbability: riskAssessment.riskProbability,
          modelFeatures: riskAssessment.modelFeatures,
        },
        sound: riskAssessment.riskLevel === 'high' ? 'default' : undefined,
        priority: priority,
        vibrate: riskAssessment.riskLevel === 'high' ? [0, 250, 250, 250] : undefined,
      },
      trigger: null, // Send immediately
    });

    console.log('Risk alert notification sent:', title);
  } catch (error) {
    console.error('Error sending risk alert:', error);
  }
};

/**
 * Send a geofence entry alert
 * @param locationName Name of the location entered
 */
export const sendGeofenceAlert = async (locationName: string): Promise<void> => {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📍 Entering Known Trigger Area',
        body: `You're approaching ${locationName}, where you experienced asthma symptoms before. Be cautious!`,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });

    console.log('Geofence alert sent for:', locationName);
  } catch (error) {
    console.error('Error sending geofence alert:', error);
  }
};

/**
 * Send an alert when the user enters a calculated red zone
 * @param triggerCount Number of historical triggers clustered in the zone
 */
export const sendRedZoneAlert = async (triggerCount: number): Promise<void> => {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🚨 Red Zone Alert',
        body: `This area is linked to ${triggerCount} past asthma incidents. Limit outdoor activity and keep your inhaler nearby.`,
        sound: 'default',
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 300, 200, 300],
      },
      trigger: null,
    });

    console.log('Red zone alert sent');
  } catch (error) {
    console.error('Error sending red zone alert:', error);
  }
};

export async function sendLowInhalerAlert(remaining: number) {
  try {
    const isCritical = remaining <= 5;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: isCritical ? '🚨 Inhaler Critical – Replace Now' : '⚠️ Inhaler Running Low',
        body: isCritical 
          ? `Only ${remaining} dose${remaining === 1 ? '' : 's'} left! Please replace your inhaler immediately.`
          : `${remaining} doses remaining out of 30. Consider getting a replacement soon.`,
        priority: isCritical 
          ? Notifications.AndroidNotificationPriority.MAX 
          : Notifications.AndroidNotificationPriority.HIGH,
        sound: 'default',
      },
      trigger: null,
    });
  } catch (e) {
    console.error('Failed to send low inhaler alert', e);
  }
}
/**
 * Send a daily environmental report notification
 * @param aqi Current AQI
 * @param pollenLevel Pollen level
 */
export const sendDailyReport = async (
  aqi: number,
  pollenLevel: 'low' | 'medium' | 'high' | 'very_high'
): Promise<void> => {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    let aqiStatus = 'Good';
    let aqiEmoji = '😊';

    if (aqi > 150) {
      aqiStatus = 'Unhealthy';
      aqiEmoji = '😷';
    } else if (aqi > 100) {
      aqiStatus = 'Moderate';
      aqiEmoji = '😐';
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${aqiEmoji} Today's Air Quality`,
        body: `AQI: ${aqi} (${aqiStatus})\nPollen: ${pollenLevel}\n\nStay safe!`,
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: null,
    });

    console.log('Daily report sent');
  } catch (error) {
    console.error('Error sending daily report:', error);
  }
};

/**
 * Schedule a daily morning air quality reminder
 */
export const scheduleDailyReminder = async (): Promise<void> => {
  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    // Cancel existing reminders
    await Notifications.cancelAllScheduledNotificationsAsync();

    // Schedule for 8 AM daily
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🌤️ Check Today\'s Air Quality',
        body: 'Good morning! Check the air quality before heading out.',
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour: 8,
        minute: 0,
        repeats: true,
      } as Notifications.CalendarTriggerInput,
    });

    console.log('Daily reminder scheduled for 8:00 AM');
  } catch (error) {
    console.error('Error scheduling daily reminder:', error);
  }
};

/**
 * Cancel all scheduled notifications
 */
export const cancelAllNotifications = async (): Promise<void> => {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    console.log('All notifications cancelled');
  } catch (error) {
    console.error('Error cancelling notifications:', error);
  }
};

/**
 * Get notification permission status
 */
export const getNotificationPermissionStatus = async (): Promise<boolean> => {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('Error getting notification permission status:', error);
    return false;
  }
};
