import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const STORAGE_KEY = 'ggm_pending_checkins';

/**
 * Saves a pending check-in to local device storage.
 * @param {Object} checkin
 */
export async function savePendingCheckin(checkin) {
  try {
    const existing = await getPendingCheckins();
    const itemWithId = {
      id: checkin.id || `pending_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      ...checkin,
      created_at: checkin.captured_at || new Date().toISOString(),
    };
    const updated = [...existing, itemWithId];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return itemWithId;
  } catch (error) {
    console.error('Error saving pending check-in locally:', error);
    throw error;
  }
}

/**
 * Retrieves all stored pending check-ins.
 * @returns {Promise<Array>}
 */
export async function getPendingCheckins() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Error reading pending check-ins:', error);
    return [];
  }
}

/**
 * Removes a specific pending check-in after it has been synchronized.
 * @param {string} id
 */
export async function removePendingCheckin(id) {
  try {
    const existing = await getPendingCheckins();
    const updated = existing.filter((item) => item.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Error removing synced check-in:', error);
  }
}

/**
 * Syncs locally saved pending check-ins to Supabase pending_checkins table and storage.
 * @returns {Promise<number>} Number of successfully synced records.
 */
export async function syncPendingCheckins() {
  const pending = await getPendingCheckins();
  if (pending.length === 0) return 0;

  let syncedCount = 0;

  for (const item of pending) {
    try {
      let uploadedStoragePath = item.selfie_storage_path;

      // 1. If we have a local selfie URI that hasn't been uploaded yet
      if (item.selfie_local_uri && !uploadedStoragePath) {
        try {
          const response = await fetch(item.selfie_local_uri);
          const blob = await response.blob();
          const fileName = `${item.member_id}/${item.activity_id}_offline_${Date.now()}.jpg`;

          const { error: uploadError } = await supabase.storage
            .from('selfies')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              upsert: true,
            });

          if (!uploadError) {
            uploadedStoragePath = fileName;
          }
        } catch (uploadErr) {
          console.warn('Offline selfie sync upload deferred:', uploadErr.message);
        }
      }

      // 2. Insert into pending_checkins table in Supabase
      const { error: insertError } = await supabase.from('pending_checkins').insert({
        member_id: item.member_id,
        activity_id: item.activity_id,
        captured_at: item.captured_at || new Date().toISOString(),
        lat: item.lat,
        lng: item.lng,
        accuracy_m: item.accuracy_m,
        selfie_local_uri: item.selfie_local_uri || null,
        selfie_storage_path: uploadedStoragePath || null,
        failure_reason: item.failure_reason || 'network_error',
        status: 'pending',
      });

      if (!insertError) {
        await removePendingCheckin(item.id);
        syncedCount += 1;
      }
    } catch (err) {
      console.warn('Pending check-in sync item error:', err);
    }
  }

  return syncedCount;
}
