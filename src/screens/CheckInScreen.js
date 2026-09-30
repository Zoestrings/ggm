import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { getDistanceMeters } from '../lib/location';
import { compressImage } from '../lib/image';
import { savePendingCheckin } from '../lib/offline';
import { colors, spacing } from '../theme';

export default function CheckInScreen({ route, navigation }) {
  const { activity } = route.params || {};

  // Verification flow state: 'verifying_location' | 'camera' | 'preview' | 'submitting' | 'success'
  const [step, setStep] = useState('verifying_location');
  const [statusMessage, setStatusMessage] = useState('Verifying location and session...');
  const [currentUser, setCurrentUser] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [photoUri, setPhotoUri] = useState(null);
  const [checkInTime, setCheckInTime] = useState(null);

  // Camera permissions
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  useEffect(() => {
    runPreCheck();
  }, []);

  const logAttempt = async (userId, reason, metadata = {}) => {
    try {
      if (userId && activity?.id) {
        await supabase.from('verification_attempts').insert({
          member_id: userId,
          activity_id: activity.id,
          attempted_at: new Date().toISOString(),
          reason: reason,
          metadata: metadata,
        });
      }
    } catch (e) {
      console.warn('Could not log verification attempt:', e.message);
    }
  };

  const runPreCheck = async () => {
    try {
      // 1. Get authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Session Expired', 'Please log in again.', [
          { text: 'OK', onPress: () => navigation.replace('Login') },
        ]);
        return;
      }
      setCurrentUser(user);

      if (!activity) {
        Alert.alert('Error', 'No activity selected.', [
          { text: 'Back', onPress: () => navigation.goBack() },
        ]);
        return;
      }

      // Step A — Location permission
      setStatusMessage('Requesting location permissions...');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        await logAttempt(user.id, 'location_permission_denied');
        Alert.alert(
          'Location Permission Required',
          'Location verification is required to record attendance. Please enable location in your device settings.',
          [
            { text: 'Cancel', onPress: () => navigation.goBack(), style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }

      // Step B — Get current position
      setStatusMessage('Checking your current location...');
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const userLat = loc.coords.latitude;
      const userLng = loc.coords.longitude;
      const accuracy = loc.coords.accuracy || 0;
      setUserLocation(loc);

      // Step C — Geofence & Accuracy check
      setStatusMessage('Verifying venue boundaries...');
      const geofenceLat = activity.geofence_lat;
      const geofenceLng = activity.geofence_lng;
      const geofenceRadius = activity.geofence_radius_m || 100;
      const maxAccuracy = activity.max_accuracy_m || 50;

      if (geofenceLat !== null && geofenceLng !== null && geofenceLat !== undefined) {
        const distance = getDistanceMeters(userLat, userLng, geofenceLat, geofenceLng);

        if (distance > geofenceRadius) {
          await logAttempt(user.id, 'outside_geofence', {
            distance: Math.round(distance),
            userLat,
            userLng,
            geofenceRadius,
          });
          Alert.alert(
            'Location Verification Failed',
            `We could not verify your location at the church premises (${Math.round(distance)}m away). Please move within the venue and try again.`,
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          );
          return;
        }

        if (accuracy > maxAccuracy) {
          await logAttempt(user.id, 'poor_accuracy', { accuracy: Math.round(accuracy), maxAccuracy });
          Alert.alert(
            'GPS Accuracy Low',
            `Your GPS accuracy is ±${Math.round(accuracy)}m. Please move to an open area and try again.`,
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          );
          return;
        }
      }

      // Step D — Server time check
      setStatusMessage('Checking session window...');
      const { data: actData, error: actError } = await supabase
        .from('activities')
        .select('*')
        .eq('id', activity.id)
        .single();

      const nowIso = new Date().toISOString();
      if (
        actError ||
        !actData ||
        nowIso < actData.opens_at ||
        nowIso > actData.closes_at ||
        actData.finalized_at
      ) {
        await logAttempt(user.id, 'outside_time');
        Alert.alert(
          'Attendance Closed',
          'This attendance activity is no longer available or has concluded.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        return;
      }

      // Step E — Duplicate check
      setStatusMessage('Verifying attendance records...');
      const { data: existingAttendance } = await supabase
        .from('attendance')
        .select('id, checked_in_at')
        .eq('member_id', user.id)
        .eq('activity_id', activity.id)
        .maybeSingle();

      if (existingAttendance) {
        Alert.alert(
          'Already Checked In',
          'Your attendance has already been recorded for this activity.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        return;
      }

      // Step F — Ensure Camera permission
      if (!permission || !permission.granted) {
        const camStatus = await requestPermission();
        if (!camStatus.granted) {
          Alert.alert(
            'Camera Permission Required',
            'Camera access is required to capture your verification photo.',
            [
              { text: 'Cancel', onPress: () => navigation.goBack(), style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
      }

      setStep('camera');
    } catch (error) {
      console.error('Pre-check error:', error);
      Alert.alert(
        'Verification Error',
        error.message || 'An unexpected error occurred during verification.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }
  };

  const handleCapture = async () => {
    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          skipProcessing: false,
        });
        if (photo?.uri) {
          setPhotoUri(photo.uri);
          setStep('preview');
        }
      } catch (err) {
        Alert.alert('Error', 'Failed to take photo: ' + err.message);
      }
    }
  };

  const handleSubmit = async () => {
    if (!photoUri || !currentUser || !activity || !userLocation) return;

    setStep('submitting');
    setStatusMessage('Compressing and preparing selfie...');

    let compressedUri = photoUri;
    try {
      compressedUri = await compressImage(photoUri);
    } catch (compressErr) {
      console.warn('Image compression fallback:', compressErr);
    }

    try {
      setStatusMessage('Uploading verification selfie...');
      const response = await fetch(compressedUri);
      const blob = await response.blob();

      const fileName = `${currentUser.id}/${activity.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('selfies')
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (uploadError) {
        console.warn('Storage upload note:', uploadError.message);
      }

      setStatusMessage('Recording attendance on server...');
      const nowTime = new Date().toISOString();
      const { error: insertError } = await supabase.from('attendance').insert({
        member_id: currentUser.id,
        activity_id: activity.id,
        checked_in_at: nowTime,
        lat: userLocation.coords.latitude,
        lng: userLocation.coords.longitude,
        accuracy_m: userLocation.coords.accuracy || 0,
        selfie_url: fileName,
        verification_status: 'verified',
        check_in_method: 'live',
      });

      if (insertError) {
        if (insertError.code === '23505') {
          Alert.alert('Notice', 'Attendance already recorded for this activity.');
          navigation.goBack();
          return;
        }
        throw insertError;
      }

      setCheckInTime(new Date());
      setStep('success');
    } catch (error) {
      console.error('Submission error (saving offline):', error);

      try {
        await savePendingCheckin({
          member_id: currentUser.id,
          activity_id: activity.id,
          captured_at: new Date().toISOString(),
          lat: userLocation.coords.latitude,
          lng: userLocation.coords.longitude,
          accuracy_m: userLocation.coords.accuracy || 0,
          selfie_local_uri: compressedUri,
          failure_reason: 'network_error',
        });

        Alert.alert(
          'Offline Check-In Saved',
          "No network connection detected. Your verification record is saved locally and will sync when you're back online.",
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } catch (offlineErr) {
        Alert.alert(
          'Submission Error',
          error.message || 'Could not record attendance. Please check your connection and try again.',
          [{ text: 'Try Again', onPress: () => setStep('preview') }]
        );
      }
    }
  };

  // 1. Loading / Verification / Submitting Screen
  if (step === 'verifying_location' || step === 'submitting') {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.watermark}
          resizeMode="contain"
        />
        <View style={styles.loadingCard}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingTitle}>
            {step === 'submitting' ? 'Submitting Attendance...' : 'Verifying Requirements...'}
          </Text>
          <Text style={styles.loadingSubtitle}>{statusMessage}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // 2. Success Screen (Clean, institutional, restrained green)
  if (step === 'success') {
    const checkInDateStr = checkInTime
      ? checkInTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const checkInTimeStr = checkInTime
      ? checkInTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : 'Recorded';

    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.watermark}
          resizeMode="contain"
        />
        <View style={styles.successCard}>
          <View style={styles.successIconWrapper}>
            <Ionicons name="checkmark-circle" size={48} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>ATTENDANCE RECORDED</Text>
          <Text style={styles.successSubtitle}>GGM Instrumentalists Attendance Management</Text>

          <View style={styles.successDivider} />

          <View style={styles.successDetailsBox}>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Activity</Text>
              <Text style={styles.successValue} numberOfLines={1}>
                {activity?.name || 'Department Activity'}
              </Text>
            </View>

            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Date</Text>
              <Text style={styles.successValue}>{checkInDateStr}</Text>
            </View>

            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Check-in</Text>
              <Text style={styles.successValueHighlight}>{checkInTimeStr}</Text>
            </View>

            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Status</Text>
              <View style={styles.presentBadge}>
                <Text style={styles.presentBadgeText}>Present</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.85}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // 3. Photo Preview Screen
  if (step === 'preview') {
    return (
      <SafeAreaView style={styles.container}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.watermark}
          resizeMode="contain"
        />
        <View style={styles.previewContainer}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>Review Verification Photo</Text>
            <Text style={styles.previewSubtitle}>Ensure your face is clearly visible and well-lit</Text>
          </View>

          <View style={styles.previewImageWrapper}>
            <Image source={{ uri: photoUri }} style={styles.previewImage} resizeMode="cover" />
          </View>

          <View style={styles.previewActionsRow}>
            <TouchableOpacity
              style={styles.retakeButton}
              onPress={() => {
                setPhotoUri(null);
                setStep('camera');
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
              <Text style={styles.retakeButtonText}>Retake</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.submitButton}
              onPress={handleSubmit}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.submitButtonText}>Confirm & Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // 4. Live Camera View
  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="front"
        ref={cameraRef}
      />
      <SafeAreaView style={[StyleSheet.absoluteFillObject, styles.cameraOverlay]} pointerEvents="box-none">
        {/* Header Bar */}
        <View style={styles.cameraTopBar}>
          <TouchableOpacity
            style={styles.closeCameraButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
            <Text style={styles.closeCameraText}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.activityBadge}>
            <Text style={styles.activityBadgeText} numberOfLines={1}>
              {activity?.name}
            </Text>
          </View>
        </View>

        {/* Center Face Frame Guide */}
        <View style={styles.faceGuideWrapper}>
          <View style={styles.faceGuide} />
          <Text style={styles.faceGuideText}>Position your face inside the frame</Text>
        </View>

        {/* Bottom Capture Button */}
        <View style={styles.captureContainer}>
          <TouchableOpacity
            style={styles.captureButtonOuter}
            onPress={handleCapture}
            activeOpacity={0.8}
          >
            <View style={styles.captureButtonInner} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  watermark: {
    position: 'absolute',
    width: 320,
    height: 320,
    alignSelf: 'center',
    top: '28%',
    opacity: 0.04,
    zIndex: 0,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.pagePadding,
  },
  loadingCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
  },
  loadingTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  loadingSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  successCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  successIconWrapper: {
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  successSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 16,
    textAlign: 'center',
  },
  successDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    width: '100%',
    marginBottom: 16,
  },
  successDetailsBox: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
    marginBottom: 20,
  },
  successRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  successLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  successValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    maxWidth: '65%',
    textAlign: 'right',
  },
  successValueHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  presentBadge: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  presentBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.successText,
  },
  doneButton: {
    backgroundColor: colors.primary,
    minHeight: 50,
    borderRadius: 8,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  previewContainer: {
    flex: 1,
    padding: spacing.pagePadding,
    justifyContent: 'space-between',
  },
  previewHeader: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  previewSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
  },
  previewImageWrapper: {
    flex: 1,
    maxHeight: 400,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#000000',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
    marginBottom: 10,
  },
  retakeButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  retakeButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  submitButton: {
    flex: 1.5,
    backgroundColor: colors.primary,
    minHeight: 52,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cameraTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  closeCameraButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  closeCameraText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  activityBadge: {
    backgroundColor: 'rgba(23, 59, 112, 0.85)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: 200,
  },
  activityBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  faceGuideWrapper: {
    alignItems: 'center',
  },
  faceGuide: {
    width: 230,
    height: 300,
    borderRadius: 115,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    borderStyle: 'dashed',
    marginBottom: 12,
  },
  faceGuideText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  captureContainer: {
    alignItems: 'center',
    paddingBottom: 28,
  },
  captureButtonOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  captureButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
  },
});
