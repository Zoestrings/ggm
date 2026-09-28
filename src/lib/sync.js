import { Alert } from 'react-native';
import { syncPendingCheckins } from './offline';

let isSyncing = false;

/**
 * Automatically synchronizes offline pending check-ins with Supabase.
 * @param {boolean} [silent=false] Whether to suppress user-facing alerts.
 */
export async function performAutoSync(silent = false) {
  if (isSyncing) return 0;
  isSyncing = true;

  try {
    const syncedCount = await syncPendingCheckins();
    if (syncedCount > 0 && !silent) {
      Alert.alert(
        'Cloud Sync Complete ☁️',
        `${syncedCount} offline attendance record${syncedCount > 1 ? 's were' : ' was'} successfully synced with the church server.`
      );
    }
    return syncedCount;
  } catch (err) {
    console.warn('Auto sync execution note:', err);
    return 0;
  } finally {
    isSyncing = false;
  }
}
