/**
 * Notifications module — stub for Expo Go compatibility.
 *
 * expo-notifications requires a native Development Build (SDK 53+).
 * These functions are no-ops so the app runs in Expo Go without crashing.
 * Push notifications will be re-enabled when building with EAS.
 */

/**
 * Requests push notification permissions and retrieves the Expo Push Token.
 * @returns {Promise<string|null>}
 */
export async function registerForPushNotifications() {
  console.log('[Notifications] Skipped — requires a Development Build (not Expo Go).');
  return null;
}

/**
 * Sets up a listener for incoming notifications while the app is in the foreground.
 * @param {Function} _callback
 * @returns {Function} Unsubscribe no-op
 */
export function setupNotificationListener(_callback) {
  return () => {};
}
