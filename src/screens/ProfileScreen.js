import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  TextInput,
  Switch,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/image';
import { fonts, shadows } from '../theme';

const NOTIF_PREFS_KEY = 'notif_prefs';
const PROFILE_CACHE_KEY = '@ggm_user_profile';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Preference switches
  const [activityReminders, setActivityReminders] = useState(true);

  // Security modals state
  const [changePwVisible, setChangePwVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPw, setUpdatingPw] = useState(false);

  const [changePhoneVisible, setChangePhoneVisible] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [updatingPhone, setUpdatingPhone] = useState(false);

  const [changeEmailVisible, setChangeEmailVisible] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [updatingEmail, setUpdatingEmail] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadProfile = async () => {
        try {
          setLoading(true);
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (!authUser) {
            navigation.replace('Login');
            return;
          }
          if (isMounted) setUser(authUser);

          // 1. Check cached profile first
          try {
            const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
            if (cached && isMounted) {
              const parsed = JSON.parse(cached);
              if (parsed && parsed.id === authUser.id) {
                setUserProfile(parsed);
                setNewPhone(parsed.phone || '');
                setNewEmail(parsed.email || authUser.email || '');
              }
            }
          } catch (_cErr) {}

          // 2. Load preferences
          try {
            const rawPrefs = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
            if (rawPrefs && isMounted) {
              const p = JSON.parse(rawPrefs);
              if (p.activityReminders !== undefined) {
                setActivityReminders(p.activityReminders);
              }
            }
          } catch (_pErr) {}

          // 3. Fetch fresh user profile from public.users table
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();

          if (isMounted && profile) {
            setUserProfile(profile);
            setNewPhone(profile.phone || '');
            setNewEmail(profile.email || authUser.email || '');
            await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));

            if (profile.avatar_url) {
              if (profile.avatar_url.startsWith('http')) {
                setAvatarUrl(profile.avatar_url);
              } else {
                const { data: signedData } = await supabase.storage
                  .from('avatars')
                  .createSignedUrl(profile.avatar_url, 3600);
                setAvatarUrl(signedData?.signedUrl || null);
              }
            } else {
              setAvatarUrl(null);
            }
          }
        } catch (err) {
          console.error('ProfileScreen load error:', err);
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      loadProfile();
      return () => {
        isMounted = false;
      };
    }, [])
  );

  const handleToggleReminders = async (val) => {
    setActivityReminders(val);
    try {
      const raw = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.activityReminders = val;
      await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(parsed));
    } catch (_e) {}
  };

  const handlePickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.length > 0) {
      await uploadAvatar(result.assets[0].uri);
    }
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.length > 0) {
      await uploadAvatar(result.assets[0].uri);
    }
  };

  const uploadAvatar = async (uri) => {
    if (!user) return;
    try {
      setUploadingAvatar(true);
      const compressed = await compressImage(uri);
      const filePath = `${user.id}/avatar_${Date.now()}.jpg`;

      // Read file binary using the new Expo File API (with safe fallback)
      let arrayBuffer;
      try {
        const file = new File(compressed);
        if (typeof file.bytes === 'function') {
          const bytes = await file.bytes();
          arrayBuffer = bytes.buffer;
        } else if (typeof file.base64 === 'function') {
          const b64 = file.base64();
          arrayBuffer = decode(b64);
        } else {
          const b64 = await FileSystemLegacy.readAsStringAsync(compressed, {
            encoding: FileSystemLegacy.EncodingType.Base64,
          });
          arrayBuffer = decode(b64);
        }
      } catch (_fileErr) {
        const b64 = await FileSystemLegacy.readAsStringAsync(compressed, {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
        arrayBuffer = decode(b64);
      }

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      await supabase.from('users').update({ avatar_url: filePath }).eq('id', user.id);

      const { data: signedData } = await supabase.storage
        .from('avatars')
        .createSignedUrl(filePath, 3600);
      setAvatarUrl(signedData?.signedUrl || null);

      Alert.alert('Success', 'Profile picture updated successfully!');
    } catch (err) {
      Alert.alert('Upload Failed', err.message || 'Could not upload image.');
      console.error('Avatar upload error:', err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const showAvatarOptions = () => {
    Alert.alert('Change Profile Picture', 'Select photo source', [
      { text: 'Choose from Library', onPress: handlePickAvatar },
      { text: 'Take a Photo', onPress: handleTakePhoto },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword) {
      Alert.alert('Required', 'Please enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Invalid Password', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }

    setUpdatingPw(true);
    try {
      const userEmail = user?.email || userProfile?.email;
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (signInError) {
        Alert.alert('Verification Failed', 'Current password is incorrect.');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      Alert.alert('Success', 'Your password has been changed.');
      setChangePwVisible(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      Alert.alert('Update Failed', err.message || 'Could not update password.');
    } finally {
      setUpdatingPw(false);
    }
  };

  const handleUpdatePhone = async () => {
    if (!newPhone.trim()) {
      Alert.alert('Required', 'Please enter a valid phone number.');
      return;
    }
    setUpdatingPhone(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({ phone: newPhone.trim() })
        .eq('id', user.id);
      if (error) throw error;

      const updated = { ...userProfile, phone: newPhone.trim() };
      setUserProfile(updated);
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(updated));

      Alert.alert('Success', 'Phone number updated successfully.');
      setChangePhoneVisible(false);
    } catch (err) {
      Alert.alert('Update Failed', err.message || 'Could not update phone number.');
    } finally {
      setUpdatingPhone(false);
    }
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim() || !newEmail.includes('@')) {
      Alert.alert('Required', 'Please enter a valid email address.');
      return;
    }
    setUpdatingEmail(true);
    try {
      const { error: authError } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (authError) throw authError;

      await supabase
        .from('users')
        .update({ email: newEmail.trim() })
        .eq('id', user.id);

      const updated = { ...userProfile, email: newEmail.trim() };
      setUserProfile(updated);
      await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(updated));

      Alert.alert('Verification Sent', 'Please check your new email address to confirm this change.');
      setChangeEmailVisible(false);
    } catch (err) {
      Alert.alert('Update Failed', err.message || 'Could not update email.');
    } finally {
      setUpdatingEmail(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.multiRemove([PROFILE_CACHE_KEY, NOTIF_PREFS_KEY, '@ggm_pending_checkins']);
              await supabase.auth.signOut();
              navigation.replace('Login');
            } catch (err) {
              console.error('Sign out error:', err);
              navigation.replace('Login');
            }
          },
        },
      ]
    );
  };

  if (loading && !userProfile) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#173B70" />
      </View>
    );
  }

  const meta = user?.user_metadata || {};
  const fullName = userProfile?.name || meta.full_name || 'Member';
  const phone = userProfile?.phone || meta.phone || 'Not provided';
  const email = user?.email || userProfile?.email || 'Not provided';
  const instrument = userProfile?.instrument || meta.instrument || 'Keyboard';
  const roleName = (userProfile?.role || meta.role || 'MEMBER').toUpperCase().replace('_', ' ');
  const initial = fullName.charAt(0).toUpperCase();

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. The Profile Header (Centered) ── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={showAvatarOptions}
            activeOpacity={0.85}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}

            {/* Small Camera Overlay on Bottom Right */}
            <View style={styles.cameraBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="camera" size={16} color="#FFFFFF" />
              )}
            </View>
          </TouchableOpacity>

          {/* User Name in Playfair Display (Navy, 24px) */}
          <Text style={styles.userName}>{fullName}</Text>

          {/* Navy Pill Role Badge */}
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleName}</Text>
          </View>

          {/* Change Profile Picture Link */}
          <TouchableOpacity onPress={showAvatarOptions} activeOpacity={0.7}>
            <Text style={styles.changePhotoLink}>Change Profile Picture</Text>
          </TouchableOpacity>
        </View>

        {/* ── 2. Card 1: PERSONAL INFORMATION ── */}
        <View style={styles.card}>
          <Text style={styles.cardHeaderTitle}>PERSONAL INFORMATION</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Full Name</Text>
            <Text style={styles.infoValue}>{fullName}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phone Number</Text>
            <Text style={styles.infoValue}>{phone}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email Address</Text>
            <Text style={styles.infoValue} numberOfLines={1}>{email}</Text>
          </View>
        </View>

        {/* ── 3. Card 2: ORGANISATION ── */}
        <View style={styles.card}>
          <Text style={styles.cardHeaderTitle}>ORGANISATION</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Ministry</Text>
            <Text style={styles.infoValue}>God's Grace Ministry</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Department</Text>
            <Text style={styles.infoValue}>GGM Instrumentalists</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Section / Instrument</Text>
            <View style={styles.instrumentBadge}>
              <Ionicons name="musical-notes" size={13} color="#173B70" style={{ marginRight: 4 }} />
              <Text style={styles.instrumentBadgeText}>{instrument}</Text>
            </View>
          </View>
        </View>

        {/* ── 4. Card 3: ACCOUNT SECURITY ── */}
        <View style={styles.card}>
          <Text style={styles.cardHeaderTitle}>ACCOUNT SECURITY</Text>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => setChangePwVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <View style={styles.actionIconWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color="#173B70" />
              </View>
              <Text style={styles.actionTitle}>Change Password</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => setChangePhoneVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <View style={styles.actionIconWrapper}>
                <Ionicons name="call-outline" size={18} color="#173B70" />
              </View>
              <Text style={styles.actionTitle}>Update Phone Number</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => setChangeEmailVisible(true)}
            activeOpacity={0.7}
          >
            <View style={styles.actionLeft}>
              <View style={styles.actionIconWrapper}>
                <Ionicons name="mail-outline" size={18} color="#173B70" />
              </View>
              <Text style={styles.actionTitle}>Update Email Address</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* ── 5. Card 4: PREFERENCES ── */}
        <View style={styles.card}>
          <Text style={styles.cardHeaderTitle}>PREFERENCES</Text>

          <View style={styles.preferenceRow}>
            <View style={styles.actionLeft}>
              <View style={styles.actionIconWrapper}>
                <Ionicons name="notifications-outline" size={18} color="#173B70" />
              </View>
              <View>
                <Text style={styles.actionTitle}>Activity Reminders</Text>
                <Text style={styles.actionSubtitle}>Alerts for scheduled cleaning & services</Text>
              </View>
            </View>

            <Switch
              value={activityReminders}
              onValueChange={handleToggleReminders}
              trackColor={{ false: '#E2E8F0', true: '#173B70' }}
              thumbColor={activityReminders ? '#D4AF37' : '#94A3B8'}
            />
          </View>
        </View>

        {/* ── 6. Log Out Button ── */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={20} color="#EF4444" style={{ marginRight: 8 }} />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Change Password Modal ── */}
      <Modal
        visible={changePwVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setChangePwVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Password</Text>
            <Text style={styles.modalSubtitle}>Verify your current password to set a new one.</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Current Password"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />

            <TextInput
              style={styles.modalInput}
              placeholder="New Password (min 6 characters)"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <TextInput
              style={styles.modalInput}
              placeholder="Confirm New Password"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setChangePwVisible(false)}
                disabled={updatingPw}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleUpdatePassword}
                disabled={updatingPw}
              >
                {updatingPw ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Update Phone Modal ── */}
      <Modal
        visible={changePhoneVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setChangePhoneVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update Phone Number</Text>
            <Text style={styles.modalSubtitle}>Enter your active telephone number.</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 08012345678"
              placeholderTextColor="#94A3B8"
              keyboardType="phone-pad"
              value={newPhone}
              onChangeText={setNewPhone}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setChangePhoneVisible(false)}
                disabled={updatingPhone}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleUpdatePhone}
                disabled={updatingPhone}
              >
                {updatingPhone ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Update</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Update Email Modal ── */}
      <Modal
        visible={changeEmailVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setChangeEmailVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update Email Address</Text>
            <Text style={styles.modalSubtitle}>A confirmation link will be sent to verify your new email.</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g. musician@godsministry.org"
              placeholderTextColor="#94A3B8"
              keyboardType="email-address"
              autoCapitalize="none"
              value={newEmail}
              onChangeText={setNewEmail}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setChangeEmailVisible(false)}
                disabled={updatingEmail}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleUpdateEmail}
                disabled={updatingEmail}
              >
                {updatingEmail ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Send Link</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC', // Crisp background for cards
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 120 : 96, // Clear bottom tab bar
  },

  // 1. Header Styles
  header: {
    alignItems: 'center',
    marginBottom: 24,
    paddingTop: 8,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    position: 'relative',
    marginBottom: 14,
    shadowColor: '#173B70',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  avatarFallback: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#173B70',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#D4AF37',
  },
  avatarInitial: {
    fontSize: 40,
    fontFamily: fonts.serif,
    color: '#FFFFFF',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#173B70',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.card,
  },
  userName: {
    fontSize: 24,
    fontFamily: fonts.serif,
    color: '#173B70',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  roleBadge: {
    backgroundColor: '#173B70', // Navy Pill
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
  },
  roleBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: fonts.sansBold,
    letterSpacing: 0.8,
  },
  changePhotoLink: {
    color: '#173B70',
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
    marginTop: 10,
    textDecorationLine: 'underline',
  },

  // 2. Information Card Styles (Premium Style)
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#173B70',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeaderTitle: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: '#64748B',
  },
  infoValue: {
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
    color: '#0F172A',
    maxWidth: '60%',
    textAlign: 'right',
  },
  instrumentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF4FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  instrumentBadgeText: {
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
    color: '#173B70',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 8,
  },

  // Action Rows
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  actionIconWrapper: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  actionTitle: {
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
    color: '#0F172A',
  },
  actionSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#94A3B8',
    marginTop: 1,
  },

  // Preference Row
  preferenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },

  // 3. Log Out Button
  logoutButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  logoutButtonText: {
    color: '#EF4444',
    fontSize: 15,
    fontFamily: fonts.sansBold,
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 22,
    ...shadows.lifted,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: fonts.sansBold,
    color: '#0F172A',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: '#64748B',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: '#0F172A',
    marginBottom: 12,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 10,
  },
  modalCancelBtnText: {
    color: '#64748B',
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  modalSaveBtn: {
    backgroundColor: '#173B70',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: fonts.sansBold,
  },
});
