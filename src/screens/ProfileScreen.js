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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { compressImage } from '../lib/image';
import { colors, spacing } from '../theme';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadProfile = async () => {
        try {
          setLoading(true);
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (!authUser) { navigation.replace('Login'); return; }
          if (isMounted) setUser(authUser);

          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();

          if (isMounted) {
            setUserProfile(profile);
            if (profile?.avatar_url) {
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
          console.error('ProfileScreen error:', err);
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      loadProfile();
      return () => { isMounted = false; };
    }, [])
  );

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

      // Read file as base64 then decode to ArrayBuffer — the correct
      // approach for Supabase Storage uploads in React Native / Expo.
      const base64 = await FileSystem.readAsStringAsync(compressed, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const arrayBuffer = decode(base64);

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, { upsert: true, contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      await supabase.from('users').update({ avatar_url: filePath }).eq('id', user.id);

      const { data: signedData } = await supabase.storage
        .from('avatars')
        .createSignedUrl(filePath, 3600);
      setAvatarUrl(signedData?.signedUrl || null);

      Alert.alert('Success', 'Profile picture updated!');
    } catch (err) {
      Alert.alert('Upload Failed', err.message || 'Could not upload. Please try again.');
      console.error('Avatar upload error:', err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const showAvatarOptions = () => {
    Alert.alert('Profile Picture', 'Choose a source', [
      { text: 'Choose from Library', onPress: handlePickAvatar },
      { text: 'Take a Photo', onPress: handleTakePhoto },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleSignOut = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.auth.signOut();
              navigation.replace('Login');
            } catch (error) {
              Alert.alert('Error', error.message || 'Failed to sign out.');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const meta = user?.user_metadata || {};
  const name = userProfile?.name || meta.full_name || user?.email || 'Member';
  const instrument = userProfile?.instrument || meta.instrument || '—';
  const phone = userProfile?.phone || meta.phone || '—';
  const email = userProfile?.email || user?.email || '—';
  const role = userProfile?.role || 'member';
  const initials = name.split(' ').map((n) => n.charAt(0).toUpperCase()).slice(0, 2).join('');

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Image source={require('../../assets/logo.png')} style={styles.watermark} resizeMode="contain" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Ionicons name="arrow-back-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>My Profile</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarWrapper} onPress={showAvatarOptions} activeOpacity={0.85} disabled={uploadingAvatar}>
            {uploadingAvatar ? (
              <View style={styles.avatarCircle}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarCircle} resizeMode="cover" />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <Text style={styles.avatarName}>{name}</Text>

          <View style={styles.instrumentBadge}>
            <Ionicons name="musical-notes-outline" size={13} color={colors.primary} style={{ marginRight: 5 }} />
            <Text style={styles.instrumentBadgeText}>{instrument}</Text>
          </View>

          <TouchableOpacity style={styles.changePhotoLink} onPress={showAvatarOptions} activeOpacity={0.7} disabled={uploadingAvatar}>
            <Text style={styles.changePhotoLinkText}>
              {uploadingAvatar ? 'Uploading...' : 'Change Profile Picture'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Personal Info Card */}
        <View style={styles.detailsCard}>
          <Text style={styles.cardSectionLabel}>PERSONAL INFORMATION</Text>
          <DetailRow icon="person-outline" label="Full Name" value={name} />
          <DetailRow icon="musical-notes-outline" label="Instrument" value={instrument} />
          <DetailRow icon="call-outline" label="Phone" value={phone} />
          <DetailRow icon="mail-outline" label="Email" value={email} />
          <DetailRow
            icon="shield-checkmark-outline"
            label="Role"
            value={role.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            last
          />
        </View>

        {/* Organisation Card */}
        <View style={styles.detailsCard}>
          <Text style={styles.cardSectionLabel}>ORGANISATION</Text>
          <DetailRow icon="business-outline" label="Ministry" value="Gods Ministry Inc." />
          <DetailRow icon="people-outline" label="Department" value="GGM Instrumentalists" last />
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>Log Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ icon, label, value, last }) {
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]}>
      <View style={styles.detailIconWrap}>
        <Ionicons name={icon} size={17} color={colors.textMuted} />
      </View>
      <View style={styles.detailText}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue} numberOfLines={1}>{value || '—'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { justifyContent: 'center', alignItems: 'center' },
  watermark: {
    position: 'absolute', width: 300, height: 300,
    alignSelf: 'center', top: '25%', opacity: 0.04, zIndex: 0,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.pagePadding, paddingVertical: 12,
    backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: colors.border, zIndex: 10,
  },
  backButton: {
    width: 38, height: 38, borderRadius: 8, borderWidth: 1,
    borderColor: colors.border, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF',
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.2 },
  headerSubtitle: { fontSize: 11, color: colors.textMuted, fontWeight: '500', marginTop: 1 },
  scrollContent: { paddingHorizontal: spacing.pagePadding, paddingTop: 28, paddingBottom: 20 },

  // Avatar
  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarWrapper: { position: 'relative', marginBottom: 14 },
  avatarCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: colors.primaryBorder,
  },
  avatarInitials: { color: '#FFFFFF', fontSize: 32, fontWeight: '700', letterSpacing: -1 },
  cameraBadge: {
    position: 'absolute', bottom: 2, right: 2, width: 28, height: 28,
    borderRadius: 14, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFFFFF',
  },
  avatarName: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.3, marginBottom: 6 },
  instrumentBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primaryLight,
    borderWidth: 1, borderColor: colors.primaryBorder,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 10,
  },
  instrumentBadgeText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  changePhotoLink: { paddingVertical: 4, paddingHorizontal: 8 },
  changePhotoLinkText: { fontSize: 13, fontWeight: '600', color: colors.primary, textDecorationLine: 'underline' },

  // Details card
  detailsCard: {
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, padding: 16, marginBottom: 14,
  },
  cardSectionLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.7, marginBottom: 12 },
  detailRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  detailIconWrap: { width: 32, alignItems: 'center', marginRight: 10 },
  detailText: { flex: 1 },
  detailLabel: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginBottom: 1 },
  detailValue: { fontSize: 14, fontWeight: '500', color: colors.textPrimary },

  // Sign out
  signOutButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.errorBorder, borderRadius: 9,
    paddingVertical: 14, marginTop: 6, backgroundColor: colors.errorBg,
  },
  signOutText: { fontSize: 14, fontWeight: '700', color: colors.error },
});
