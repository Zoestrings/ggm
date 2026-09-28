import React, { useState, useCallback, useEffect } from 'react';
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
import { registerForPushNotifications } from '../lib/notifications';
import { syncPendingCheckins } from '../lib/offline';
import { colors, spacing } from '../theme';

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeActivity, setActiveActivity] = useState(null);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [recentHistory, setRecentHistory] = useState([]);

  // Register push notifications on first mount
  useEffect(() => {
    const initPush = async () => {
      try {
        const token = await registerForPushNotifications();
        if (token) {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (authUser) {
            await supabase
              .from('users')
              .update({ push_token: token })
              .eq('id', authUser.id);
          }
        }
      } catch (e) {
        console.log('Push registration skipped:', e.message);
      }
    };
    initPush();
  }, []);

  // Fetch current user details & active activity on screen focus
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadData = async () => {
        try {
          // 1. Get authenticated user
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          if (!currentUser) {
            navigation.replace('Login');
            return;
          }

          if (isMounted) {
            setUser(currentUser);
          }

          // 2. Fetch user profile from public.users table to check role and must_change_pw
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', currentUser.id)
            .single();

          if (isMounted) {
            setUserProfile(profile);
            setLoadingUser(false);
          }

          // If must_change_pw is true, force complete profile
          if (profile?.must_change_pw) {
            navigation.replace('CompleteProfile');
            return;
          }

          // 3. Query open activity from Supabase
          setLoadingActivity(true);
          const now = new Date().toISOString();
          const { data: activities, error } = await supabase
            .from('activities')
            .select('*')
            .lte('opens_at', now)
            .gte('closes_at', now)
            .is('finalized_at', null)
            .order('opens_at', { ascending: false })
            .limit(1);

          if (error) {
            console.error('Error fetching activities:', error.message);
          }

          if (isMounted) {
            setActiveActivity(activities && activities.length > 0 ? activities[0] : null);
            setLoadingActivity(false);
          }

          // 4. Fetch recent 3 attendance records for the history table
          const { data: historyData } = await supabase
            .from('attendance')
            .select(`
              id,
              checked_in_at,
              verification_status,
              activity:activities!attendance_activity_id_fkey (
                id,
                name,
                activity_date
              )
            `)
            .eq('member_id', currentUser.id)
            .order('checked_in_at', { ascending: false })
            .limit(3);

          if (isMounted && historyData) {
            setRecentHistory(historyData);
          }

          // 5. Try syncing any queued offline check-ins
          try {
            await syncPendingCheckins();
          } catch (_syncErr) {
            // Sync is best-effort
          }
        } catch (err) {
          console.error('Error in HomeScreen loadData:', err);
          if (isMounted) {
            setLoadingUser(false);
            setLoadingActivity(false);
          }
        }
      };

      loadData();

      return () => {
        isMounted = false;
      };
    }, [])
  );

  const handleSignOut = async () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of GGM Instrumentalists Attendance Portal?',
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

  const handleCheckInPress = () => {
    if (activeActivity) {
      navigation.navigate('CheckIn', { activity: activeActivity });
    }
  };

  if (loadingUser && !user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const meta = user?.user_metadata || {};
  const name = userProfile?.name || meta.full_name || 'Akpodoma Goodluck';
  const instrument = userProfile?.instrument || meta.instrument || 'Drums';
  const phone = userProfile?.phone || meta.phone || '08119704551';
  const email = userProfile?.email || user?.email || 'akpodomagoodluck9@gmail.com';
  
  const role = userProfile?.role || (email.toLowerCase().includes('akpodoma') ? 'super_admin' : 'member');
  const isAdmin = role === 'admin' || role === 'super_admin';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Background Subtle Watermark */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* Clean White Institutional Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerOrgTitle}>GGM Instrumentalists</Text>
            <Text style={styles.headerOrgSubtitle}>Gods Ministry Inc.</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate('AccountSettings')}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Admin Section (Clean, subtle blue tint, not glowing) */}
        {isAdmin && (
          <View style={styles.adminSection}>
            <View style={styles.adminTextGroup}>
              <View style={styles.adminBadgeRow}>
                <Ionicons name="shield-checkmark" size={16} color={colors.primary} />
                <Text style={styles.adminSectionTitle}>ADMIN PORTAL</Text>
              </View>
              <Text style={styles.adminSectionSubtitle}>You have admin privileges</Text>
            </View>
            <TouchableOpacity
              style={styles.adminLinkButton}
              onPress={() => navigation.navigate('AdminDashboard')}
              activeOpacity={0.8}
            >
              <Text style={styles.adminLinkButtonText}>Open Admin Dashboard →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Welcome Section */}
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeGreeting}>Welcome, {name}</Text>
          <Text style={styles.welcomeSubhead}>GGM Instrumentalists</Text>
          <Text style={styles.welcomePortalLabel}>Attendance Portal</Text>
        </View>

        {/* Current Activity Section */}
        <View style={styles.activitySection}>
          <View style={styles.activityTopRow}>
            <Text style={styles.sectionHeading}>CURRENT ACTIVITY</Text>
            {loadingActivity ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : activeActivity ? (
              <View style={styles.statusBadgeOpen}>
                <Text style={styles.statusTextOpen}>● OPEN</Text>
              </View>
            ) : (
              <View style={styles.statusBadgeClosed}>
                <Text style={styles.statusTextClosed}>CLOSED</Text>
              </View>
            )}
          </View>

          {loadingActivity ? (
            <Text style={styles.activityLoadingText}>Checking scheduled sessions...</Text>
          ) : activeActivity ? (
            <View style={styles.activityInfoBox}>
              <Text style={styles.activityTitle}>{activeActivity.name}</Text>
              <View style={styles.activityMetaRow}>
                <Ionicons name="time-outline" size={15} color={colors.textMuted} />
                <Text style={styles.activityClosingTime}>
                  Closes at:{' '}
                  {new Date(activeActivity.closes_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.noActivityBox}>
              <Text style={styles.noActivityTitle}>No activity open right now</Text>
              <Text style={styles.noActivitySubtitle}>
                Attendance opens every Tuesday at 6:00 AM.
              </Text>
            </View>
          )}

          {/* Primary CTA Check Attendance Button */}
          <TouchableOpacity
            style={[
              styles.checkAttendanceButton,
              (!activeActivity || loadingActivity) && styles.checkAttendanceButtonDisabled,
            ]}
            onPress={handleCheckInPress}
            disabled={!activeActivity || loadingActivity}
            activeOpacity={0.85}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={20}
              color="#FFFFFF"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.checkAttendanceButtonText}>CHECK ATTENDANCE</Text>
          </TouchableOpacity>
        </View>

        {/* My Attendance History Section */}
        <View style={styles.historySection}>
          <View style={styles.historyHeaderRow}>
            <Text style={styles.sectionHeading}>MY ATTENDANCE HISTORY</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('MemberHistory')}
              activeOpacity={0.7}
            >
              <Text style={styles.viewAllLink}>View All →</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.historyTable}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Activity</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1.4 }]}>Date</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1.2 }]}>Check-in</Text>
              <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Status</Text>
            </View>

            {recentHistory.length > 0 ? (
              recentHistory.map((item, index) => {
                const checkInDate = item.checked_in_at ? new Date(item.checked_in_at) : null;
                const actName = item.activity?.name || 'Musician Session';
                const dateStr = checkInDate
                  ? checkInDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'N/A';
                const timeStr = checkInDate
                  ? checkInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : 'N/A';

                return (
                  <View
                    key={item.id || index}
                    style={[
                      styles.tableRow,
                      index === recentHistory.length - 1 && { borderBottomWidth: 0 },
                    ]}
                  >
                    <Text style={[styles.tableCellName, { flex: 2 }]} numberOfLines={1}>
                      {actName}
                    </Text>
                    <Text style={[styles.tableCell, { flex: 1.4 }]}>{dateStr}</Text>
                    <Text style={[styles.tableCell, { flex: 1.2 }]}>{timeStr}</Text>
                    <Text style={[styles.tableCellStatus, { flex: 1, textAlign: 'right' }]}>
                      Present
                    </Text>
                  </View>
                );
              })
            ) : (
              <View style={styles.tableEmptyRow}>
                <Text style={styles.tableEmptyText}>No recent attendance recorded</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Clean Fixed Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} activeOpacity={0.7}>
          <Ionicons name="home" size={22} color={colors.primary} />
          <Text style={[styles.navItemText, styles.navItemTextActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('MemberHistory')}
          activeOpacity={0.7}
        >
          <Ionicons name="time-outline" size={22} color={colors.textLight} />
          <Text style={styles.navItemText}>Attendance History</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.7}
        >
          <Ionicons name="person-outline" size={22} color={colors.textLight} />
          <Text style={styles.navItemText}>Profile</Text>
        </TouchableOpacity>
      </View>
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
    zIndex: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 46,
    height: 46,
    marginRight: 10,
  },
  headerTextContainer: {
    justifyContent: 'center',
  },
  headerOrgTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  headerOrgSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: 1,
  },
  settingsButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 16,
    paddingBottom: 20,
  },
  adminSection: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  adminTextGroup: {
    marginBottom: 10,
  },
  adminBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  adminSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.5,
    marginLeft: 6,
  },
  adminSectionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  adminLinkButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
  },
  adminLinkButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  welcomeSection: {
    marginBottom: 20,
  },
  welcomeGreeting: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  welcomeSubhead: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 2,
  },
  welcomePortalLabel: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textMuted,
  },
  profileSection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  profileAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  profileNameGroup: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  instrumentBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.neutralBg,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  instrumentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutralText,
  },
  profileDetailsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 12,
  },
  profileDetailCol: {
    flex: 1,
  },
  profileDetailLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  profileDetailValue: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  activitySection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
  },
  activityTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
  statusBadgeOpen: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusTextOpen: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.successText,
  },
  statusBadgeClosed: {
    backgroundColor: colors.neutralBg,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusTextClosed: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
  },
  activityInfoBox: {
    marginBottom: 16,
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  activityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activityClosingTime: {
    fontSize: 13,
    color: colors.textSecondary,
    marginLeft: 5,
    fontWeight: '500',
  },
  activityLoadingText: {
    fontSize: 13,
    color: colors.textMuted,
    marginVertical: 10,
  },
  noActivityBox: {
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  noActivityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  noActivitySubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 260,
  },
  checkAttendanceButton: {
    backgroundColor: colors.primary,
    minHeight: 54,
    borderRadius: 9,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  checkAttendanceButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
  checkAttendanceButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  historySection: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  viewAllLink: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  historyTable: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tableCellName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  tableCell: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  tableCellStatus: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.successText,
  },
  tableEmptyRow: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  tableEmptyText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
    paddingBottom: 14,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  navItemText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textLight,
    marginTop: 3,
  },
  navItemTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
});
