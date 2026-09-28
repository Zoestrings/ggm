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
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

const NOTIF_KEY = 'notif_prefs';

function formatRole(role) {
  if (!role) return 'Member';
  return role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function getRoleBadgeStyle(role) {
  const r = (role || '').toLowerCase();
  if (r === 'super_admin' || r === 'admin') {
    return { bg: '#DBEAFE', text: '#1E40AF' };
  }
  return { bg: '#F3F4F6', text: '#6B7280' };
}

export default function AccountSettingsScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notifActivity, setNotifActivity] = useState(true);
  const [notifFinalization, setNotifFinalization] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const load = async () => {
        try {
          setLoading(true);

          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (!authUser) { navigation.replace('Login'); return; }
          if (isMounted) setUser(authUser);

          const { data: p } = await supabase
            .from('users')
            .select('*')
            .eq('id', authUser.id)
            .single();
          if (isMounted) setProfile(p);

          // Load notification prefs from AsyncStorage
          const raw = await AsyncStorage.getItem(NOTIF_KEY);
          if (raw && isMounted) {
            const prefs = JSON.parse(raw);
            setNotifActivity(prefs.activity ?? true);
            setNotifFinalization(prefs.finalization ?? true);
          }
        } catch (err) {
          console.error('AccountSettingsScreen error:', err);
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      load();
      return () => { isMounted = false; };
    }, [])
  );

  const saveNotifPref = async (key, value) => {
    try {
      const raw = await AsyncStorage.getItem(NOTIF_KEY);
      const prefs = raw ? JSON.parse(raw) : {};
      prefs[key] = value;
      await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(prefs));
    } catch (_) {}
  };

  const handleSignOut = () => {
    Alert.alert(
      'Log out of your account?',
      'You will need to sign in again to access the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.auth.signOut();
              navigation.replace('Login');
            } catch (err) {
              Alert.alert('Error', err.message || 'Sign out failed.');
            }
          },
        },
      ]
    );
  };

  const comingSoon = (label) =>
    Alert.alert(label, 'This feature is coming soon.', [{ text: 'OK' }]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const meta = user?.user_metadata || {};
  const name = profile?.name || meta.full_name || user?.email || 'Member';
  const email = profile?.email || user?.email || '—';
  const role = profile?.role || 'member';
  const instrument = profile?.instrument || meta.instrument || null;
  const initial = name.charAt(0).toUpperCase();
  const badgeStyle = getRoleBadgeStyle(role);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Watermark */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile block ── */}
        <View style={styles.profileBlock}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
          <Text style={styles.profileName}>{name}</Text>
          <View style={[styles.roleBadge, { backgroundColor: badgeStyle.bg }]}>
            <Text style={[styles.roleBadgeText, { color: badgeStyle.text }]}>
              {formatRole(role).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.profileEmail}>{email}</Text>
        </View>

        {/* ── Membership ── */}
        <SectionLabel>MEMBERSHIP</SectionLabel>
        <View style={styles.card}>
          <InfoRow icon="business-outline" label="Department" value="GGM Instrumentalists" />
          <InfoRow icon="home-outline" label="Ministry" value="Gods Ministry Inc." />
          {instrument && (
            <InfoRow icon="musical-notes-outline" label="Section" value={instrument} last />
          )}
          {!instrument && (
            <InfoRow icon="musical-notes-outline" label="Section" value="—" last />
          )}
        </View>

        {/* ── Account ── */}
        <SectionLabel>ACCOUNT</SectionLabel>
        <View style={styles.card}>
          <ActionRow
            icon="key-outline"
            label="Change Password"
            onPress={() => comingSoon('Change Password')}
          />
          <ActionRow
            icon="phone-portrait-outline"
            label="Update Phone Number"
            onPress={() => comingSoon('Update Phone Number')}
          />
          <ActionRow
            icon="mail-outline"
            label="Update Email"
            onPress={() => comingSoon('Update Email')}
            last
          />
        </View>

        {/* ── Notifications ── */}
        <SectionLabel>NOTIFICATIONS</SectionLabel>
        <View style={styles.card}>
          <ToggleRow
            icon="notifications-outline"
            label="Activity reminders"
            value={notifActivity}
            onValueChange={(v) => {
              setNotifActivity(v);
              saveNotifPref('activity', v);
            }}
          />
          <ToggleRow
            icon="checkmark-done-outline"
            label="Finalization notices"
            value={notifFinalization}
            onValueChange={(v) => {
              setNotifFinalization(v);
              saveNotifPref('finalization', v);
            }}
            last
          />
        </View>

        {/* ── About ── */}
        <SectionLabel>ABOUT</SectionLabel>
        <View style={styles.card}>
          <InfoRow icon="information-circle-outline" label="App Version" value="1.0.0" />
          <ActionRow
            icon="document-text-outline"
            label="Privacy Policy"
            onPress={() =>
              Alert.alert(
                'Privacy Policy',
                'This app collects attendance records for GGM Instrumentalists. Data is stored securely and is only accessible to authorized administrators.',
                [{ text: 'OK' }]
              )
            }
          />
          <ActionRow
            icon="help-circle-outline"
            label="Help & Support"
            onPress={() =>
              Alert.alert(
                'Help & Support',
                'For assistance, contact your GGM Instrumentalists administrator or department head.',
                [{ text: 'OK' }]
              )
            }
            last
          />
        </View>

        {/* ── Log Out ── */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.85}
        >
          <Ionicons name="log-out-outline" size={18} color="#DC2626" style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>Log Out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Sub-components ──────────────────────────────────────────

function SectionLabel({ children }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function InfoRow({ icon, label, value, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Ionicons name={icon} size={20} color="#6B7280" style={styles.rowIcon} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ActionRow({ icon, label, onPress, last }) {
  return (
    <TouchableOpacity
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={20} color="#6B7280" style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: '#111827', flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
    </TouchableOpacity>
  );
}

function ToggleRow({ icon, label, value, onValueChange, last }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Ionicons name={icon} size={20} color="#6B7280" style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: '#111827', flex: 1 }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#E5E7EB', true: '#BFDBFE' }}
        thumbColor={value ? colors.primary : '#9CA3AF'}
        ios_backgroundColor="#E5E7EB"
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  centered: { justifyContent: 'center', alignItems: 'center' },

  watermark: {
    position: 'absolute',
    width: 300,
    height: 300,
    alignSelf: 'center',
    top: '22%',
    opacity: 0.06,
    zIndex: 0,
  },

  // Header
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.pagePadding,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    zIndex: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.3,
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 20,
  },

  // Profile block
  profileBlock: {
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1E3A8A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    // subtle shadow
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
    letterSpacing: -0.4,
  },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 8,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  profileEmail: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '400',
  },

  // Section label
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 4,
  },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    // subtle shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  // Rows
  row: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowIcon: {
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 14,
    color: '#6B7280',
    flex: 1,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    flexShrink: 1,
    maxWidth: '55%',
    textAlign: 'right',
  },

  // Sign out
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    marginTop: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DC2626',
    backgroundColor: 'transparent',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
});
