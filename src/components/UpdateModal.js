import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
  Image,
  ScrollView,
  AppState,
} from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

/**
 * Semver comparison: returns true if remote > local
 */
export function isNewerVersion(remote, local) {
  if (!remote || !local) return false;
  const rParts = remote.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const lParts = local.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

export default function UpdateModal() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);

  // Current app version from native package or expo config fallback
  const currentVersion =
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    '1.0.0';

  const checkForUpdate = useCallback(async () => {
    try {
      setChecking(true);
      console.log('Checking for updates... currentVersion:', currentVersion);

      // Query latest release by released_at, with fallback to created_at or general select
      let { data, error } = await supabase
        .from('app_versions')
        .select('*')
        .order('released_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Update check released_at order failed, trying created_at fallback:', error.message);
        const fallback = await supabase
          .from('app_versions')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        data = fallback.data;
        error = fallback.error;
      }

      console.log('Checking for updates...', currentVersion, data);

      if (error) {
        console.warn('Update check query error:', error.message);
        return;
      }

      if (data && data.version) {
        const newer = isNewerVersion(data.version, currentVersion);
        console.log('Update evaluation:', data.version, 'newer than', currentVersion, '=>', newer);
        if (newer) {
          setUpdateInfo(data);
          setDismissed(false);
          setUpdateAvailable(true);
        }
      } else {
        console.log('No update records found in app_versions table.');
      }
    } catch (err) {
      console.warn('Failed to check for updates:', err.message);
    } finally {
      setChecking(false);
    }
  }, [currentVersion]);

  // Check on component mount
  useEffect(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  // Also re-check when app returns to foreground from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkForUpdate();
      }
    });
    return () => sub.remove();
  }, [checkForUpdate]);

  const handleUpdateNow = async () => {
    const downloadUrl =
      updateInfo?.download_url ||
      updateInfo?.apk_url ||
      updateInfo?.url;

    if (!downloadUrl) return;

    try {
      const canOpen = await Linking.canOpenURL(downloadUrl);
      if (canOpen) {
        await Linking.openURL(downloadUrl);
      } else {
        await Linking.openURL(downloadUrl);
      }
    } catch (err) {
      console.error('Error opening download URL:', err);
    }
  };

  if (!updateAvailable || dismissed || !updateInfo) {
    return null;
  }

  const isMandatory =
    updateInfo.is_mandatory === true ||
    updateInfo.force_update === true;

  const releaseNotes =
    updateInfo.release_notes ||
    updateInfo.changelog ||
    updateInfo.notes ||
    'A new version of the GGM Attendance app is available with performance improvements and updates.';

  return (
    <Modal
      visible={updateAvailable && !dismissed}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!isMandatory) setDismissed(true);
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header Icon */}
          <View style={styles.iconContainer}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
            />
            <View style={styles.badge}>
              <Ionicons name="arrow-up" size={12} color="#FFFFFF" />
            </View>
          </View>

          {/* Title & Subtitle */}
          <Text style={styles.title}>Update Available</Text>
          <Text style={styles.subtitle}>
            A newer version of GGM Attendance is ready!
          </Text>

          {/* Version Chips */}
          <View style={styles.versionRow}>
            <View style={styles.versionChipCurrent}>
              <Text style={styles.versionLabel}>Current</Text>
              <Text style={styles.versionValue}>v{currentVersion}</Text>
            </View>
            <Ionicons name="arrow-forward" size={16} color={colors.textLight} />
            <View style={styles.versionChipNew}>
              <Text style={styles.versionLabelNew}>New</Text>
              <Text style={styles.versionValueNew}>v{updateInfo.version}</Text>
            </View>
          </View>

          {/* Release Notes */}
          <View style={styles.notesContainer}>
            <Text style={styles.notesTitle}>What's New:</Text>
            <ScrollView style={styles.notesScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.notesText}>{releaseNotes}</Text>
            </ScrollView>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={styles.updateButton}
              onPress={handleUpdateNow}
              activeOpacity={0.85}
            >
              <Ionicons name="cloud-download-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.updateButtonText}>Update Now</Text>
            </TouchableOpacity>

            {!isMandatory && (
              <TouchableOpacity
                style={styles.laterButton}
                onPress={() => setDismissed(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.laterButtonText}>Later</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 9999,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  logo: {
    width: 68,
    height: 68,
    resizeMode: 'contain',
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#16A34A',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
    width: '100%',
  },
  versionChipCurrent: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  versionLabel: {
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  versionValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  versionChipNew: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  versionLabelNew: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  versionValueNew: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  notesContainer: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: 20,
    maxHeight: 120,
  },
  notesTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  notesScroll: {
    maxHeight: 80,
  },
  notesText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  buttonContainer: {
    width: '100%',
    gap: 10,
  },
  updateButton: {
    flexDirection: 'row',
    backgroundColor: colors.primary,
    minHeight: 48,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  updateButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  laterButton: {
    minHeight: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  laterButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
