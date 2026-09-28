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
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function AdminDashboardScreen({ navigation }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [activeActivity, setActiveActivity] = useState(null);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [failedAttemptsCount, setFailedAttemptsCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [totalMembersCount, setTotalMembersCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const fetchAdminStats = async () => {
        try {
          setLoading(true);
          // 1. Get current auth user
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            navigation.replace('Login');
            return;
          }

          if (isMounted) setCurrentUser(user);

          // 2. Fetch user profile and role
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

          if (isMounted) setUserProfile(profile);

          if (profile?.must_change_pw) {
            navigation.replace('CompleteProfile');
            return;
          }

          // 3. Count total registered members
          const { count: memberCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

          if (isMounted) setTotalMembersCount(memberCount || 0);

          // 4. Query latest active activity
          const { data: activities } = await supabase
            .from('activities')
            .select('*')
            .order('opens_at', { ascending: false })
            .limit(1);

          const currentAct = activities && activities.length > 0 ? activities[0] : null;
          if (isMounted) setActiveActivity(currentAct);

          if (currentAct) {
            // 5. Count attendance for current activity
            const { count: attCount } = await supabase
              .from('attendance')
              .select('*', { count: 'exact', head: true })
              .eq('activity_id', currentAct.id);

            // 6. Count failed attempts for current activity
            const { count: failCount } = await supabase
              .from('verification_attempts')
              .select('*', { count: 'exact', head: true })
              .eq('activity_id', currentAct.id);

            // 7. Count pending offline check-ins
            const { count: pendCount } = await supabase
              .from('pending_checkins')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'pending');

            if (isMounted) {
              setCheckedInCount(attCount || 0);
              setFailedAttemptsCount(failCount || 0);
              setPendingReviewCount(pendCount || 0);
            }
          }
        } catch (err) {
          console.error('Error fetching admin dashboard stats:', err);
        } finally {
          if (isMounted) setLoading(false);
        }
      };

      fetchAdminStats();

      return () => {
        isMounted = false;
      };
    }, [])
  );

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to end your administrative session?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.auth.signOut();
              navigation.replace('Login');
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  const isSuperAdmin = userProfile?.role === 'super_admin';
  const adminName = userProfile?.name || 'Administrator';

  if (loading && !userProfile) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Background Subtle Watermark */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.headerOrgTitle}>GGM Instrumentalists</Text>
            <Text style={styles.headerOrgSubtitle}>Gods Ministry Inc. • Admin Portal</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.switchButton}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.7}
        >
          <Text style={styles.switchButtonText}>Member View</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Monitored Activity Card */}
        <View style={styles.activityBanner}>
          <View style={styles.activityBannerTop}>
            <Text style={styles.sectionHeading}>CURRENT MONITORED SESSION</Text>
            {activeActivity && (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>● LIVE</Text>
              </View>
            )}
          </View>

          <Text style={styles.activityName}>
            {activeActivity ? activeActivity.name : 'No Active Activity'}
          </Text>

          {activeActivity && (
            <View style={styles.activityMetaRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={styles.activityDate}>
                {new Date(activeActivity.opens_at).toLocaleDateString([], {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            </View>
          )}
        </View>

        {/* Statistical Blocks Grid */}
        <Text style={styles.sectionTitle}>Overview Statistics</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{checkedInCount}</Text>
            <Text style={styles.statLabel}>Verified Present</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={[styles.statNumber, failedAttemptsCount > 0 && { color: colors.errorText }]}>
              {failedAttemptsCount}
            </Text>
            <Text style={styles.statLabel}>Violations / Failed</Text>
          </View>

          <View style={styles.statBox}>
            <Text
              style={[
                styles.statNumber,
                pendingReviewCount > 0 && { color: colors.warningText },
              ]}
            >
              {pendingReviewCount}
            </Text>
            <Text style={styles.statLabel}>Pending Reviews</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{totalMembersCount}</Text>
            <Text style={styles.statLabel}>Total Members</Text>
          </View>
        </View>

        {/* Management & Operations Modules */}
        <Text style={styles.sectionTitle}>Management Modules</Text>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('AttendanceList', { activity: activeActivity })}
          activeOpacity={0.7}
        >
          <View style={styles.actionIconWrapper}>
            <Ionicons name="list-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.actionTextWrapper}>
            <Text style={styles.actionTitle}>Attendance Ledger</Text>
            <Text style={styles.actionDesc}>Check verified musicians, timestamps, & selfies</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('FailedAttempts', { activity: activeActivity })}
          activeOpacity={0.7}
        >
          <View style={[styles.actionIconWrapper, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.errorText} />
          </View>
          <View style={styles.actionTextWrapper}>
            <Text style={styles.actionTitle}>Verification Violations</Text>
            <Text style={styles.actionDesc}>Review geofence & GPS verification failures</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => navigation.navigate('GenerateReport', { activity: activeActivity })}
          activeOpacity={0.7}
        >
          <View style={styles.actionIconWrapper}>
            <Ionicons name="document-text-outline" size={20} color={colors.primary} />
          </View>
          <View style={styles.actionTextWrapper}>
            <Text style={styles.actionTitle}>Generate Report & Finalize</Text>
            <Text style={styles.actionDesc}>Export verified official PDF & lock ledger</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionCard,
            pendingReviewCount > 0 && { borderColor: colors.warningBorder, backgroundColor: colors.warningBg },
          ]}
          onPress={() => navigation.navigate('PendingReview')}
          activeOpacity={0.7}
        >
          <View
            style={[
              styles.actionIconWrapper,
              pendingReviewCount > 0 && { backgroundColor: '#FEF3C7' },
            ]}
          >
            <Ionicons
              name="time-outline"
              size={20}
              color={pendingReviewCount > 0 ? colors.warningText : colors.primary}
            />
          </View>
          <View style={styles.actionTextWrapper}>
            <Text style={styles.actionTitle}>
              Pending Offline Submissions {pendingReviewCount > 0 ? `(${pendingReviewCount})` : ''}
            </Text>
            <Text style={styles.actionDesc}>Approve or reject offline check-in records</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
        </TouchableOpacity>

        {isSuperAdmin && (
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => navigation.navigate('AdminManagement')}
            activeOpacity={0.7}
          >
            <View style={styles.actionIconWrapper}>
              <Ionicons name="people-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.actionTextWrapper}>
              <Text style={styles.actionTitle}>Department Admins</Text>
              <Text style={styles.actionDesc}>Provision admin access & assign roles</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textLight} />
          </TouchableOpacity>
        )}

        {/* Sign Out Button */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={16} color={colors.errorText} style={{ marginRight: 6 }} />
          <Text style={styles.signOutButtonText}>Sign Out of Admin Session</Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerLogo: {
    width: 44,
    height: 44,
    marginRight: 10,
  },
  headerOrgTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerOrgSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: 1,
  },
  switchButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  switchButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  scrollContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 16,
    paddingBottom: 20,
  },
  activityBanner: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
  },
  activityBannerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
  liveBadge: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.successText,
  },
  activityName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  activityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activityDate: {
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 10,
    letterSpacing: -0.1,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  actionIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  actionTextWrapper: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  actionDesc: {
    fontSize: 12,
    color: colors.textMuted,
  },
  signOutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.errorBorder,
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    paddingVertical: 12,
    marginTop: 16,
  },
  signOutButtonText: {
    color: colors.errorText,
    fontSize: 13,
    fontWeight: '600',
  },
});
