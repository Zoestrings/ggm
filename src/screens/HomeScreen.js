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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from '../lib/notifications';
import { syncPendingCheckins } from '../lib/offline';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, spacing, fonts, shadows } from '../theme';

const PROFILE_CACHE_KEY = '@ggm_user_profile';

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeActivity, setActiveActivity] = useState(null);
  const [nextActivityDate, setNextActivityDate] = useState('3rd November');
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [recentHistory, setRecentHistory] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

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

          // 2. Load cached profile immediately to prevent UI flicker
          try {
            const cached = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
            if (cached && isMounted) {
              const parsed = JSON.parse(cached);
              if (parsed && parsed.id === currentUser.id) {
                setUserProfile(parsed);
                setLoadingUser(false);
              }
            }
          } catch (_cErr) {}

          // 3. Fetch fresh user profile from public.users table (source of truth)
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', currentUser.id)
            .single();

          if (isMounted) {
            if (profile && profile.name) {
              setUserProfile(profile);
              await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
            } else {
              const meta = currentUser.user_metadata || {};
              const healedProfile = {
                id: currentUser.id,
                name: meta.full_name || meta.name || currentUser.email?.split('@')[0] || 'Member',
                phone: meta.phone || profile?.phone || '',
                instrument: (meta.instrument && meta.instrument !== 'Musician')
                  ? meta.instrument
                  : ((profile?.instrument && profile.instrument !== 'Musician') ? profile.instrument : 'Keyboard'),
                role: meta.role || profile?.role || 'member',
                password_hash: 'managed_by_supabase_auth',
              };
              setUserProfile(healedProfile);
              await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(healedProfile));

              try {
                await supabase.from('users').upsert(healedProfile, { onConflict: 'id' });
              } catch (_healErr) {
                console.warn('HomeScreen profile healing note:', _healErr);
              }
            }
            setLoadingUser(false);
          }

          // If must_change_pw is true, force complete profile
          if (profile?.must_change_pw) {
            navigation.replace('CompleteProfile');
            return;
          }

          // 4. Query open activity from Supabase
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

          // Query next scheduled cleaning date
          const { data: upcomingActs } = await supabase
            .from('activities')
            .select('activity_date, name')
            .gte('closes_at', now)
            .order('opens_at', { ascending: true })
            .limit(1);

          if (isMounted) {
            if (activities && activities.length > 0) {
              setActiveActivity(activities[0]);
            } else {
              setActiveActivity(null);
            }

            if (upcomingActs && upcomingActs.length > 0 && upcomingActs[0].activity_date) {
              const d = new Date(upcomingActs[0].activity_date);
              const day = d.getDate();
              const suffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
              const monthStr = d.toLocaleDateString('en-US', { month: 'long' });
              setNextActivityDate(`${day}${suffix} ${monthStr}`);
            } else {
              setNextActivityDate('3rd November');
            }

            setLoadingActivity(false);
          }

          // 5. Fetch recent 3 attendance records for the history table
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

          // 6. Query unread notifications count
          try {
            const { count: unreadCount } = await supabase
              .from('notifications')
              .select('*', { count: 'exact', head: true })
              .eq('member_id', currentUser.id)
              .is('read_at', null);

            if (isMounted) {
              setUnreadNotifications(unreadCount || 0);
            }
          } catch (_notifErr) {}

          // 7. Try syncing any queued offline check-ins
          try {
            await syncPendingCheckins();
          } catch (_syncErr) {}
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

  const handleCheckInPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (activeActivity) {
      navigation.navigate('CheckIn', { activity: activeActivity });
    }
  };

  if (loadingUser && !user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#173B70" />
      </View>
    );
  }

  const meta = user?.user_metadata || {};
  const name = userProfile?.name || meta.full_name || 'Member';
  const role = userProfile?.role || meta.role || 'member';
  const isSuperAdmin = role === 'super_admin';
  const isSubAdmin = role === 'sub_admin';

  return (
    <View style={styles.container}>
      {/* Background Approved Watermark */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* 1. Header: Dark Navy with Curved Gold Bottom Border */}
      <View style={styles.headerWrapper}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.headerSafeArea}>
          <View style={styles.headerTopBar}>
            <View style={styles.headerLeft}>
              <View style={styles.headerLogoCircle}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.headerLogo}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.headerBrandTexts}>
                <Text style={styles.headerBrandTitle}>GGM Instrumentalists</Text>
                <Text style={styles.headerBrandSubtitle}>God's Ministry Inc.</Text>
              </View>
            </View>

            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.headerBellButton}
                onPress={() => navigation.navigate('Notifications')}
                activeOpacity={0.8}
              >
                <Ionicons name="notifications" size={20} color="#D4AF37" />
                {unreadNotifications > 0 && <View style={styles.unreadBadgeDot} />}
              </TouchableOpacity>
            </View>
          </View>

          {/* Welcome Greeting with Gold Motif */}
          <View style={styles.welcomeContainer}>
            <View style={styles.welcomeMotifRow}>
              <Ionicons name="sparkles" size={14} color="#D4AF37" />
              <Text style={styles.welcomeAuraText}>SANCTUARY MUSIC MINISTRY</Text>
              <Ionicons name="sparkles" size={14} color="#D4AF37" />
            </View>
            <Text style={styles.welcomeGreeting} numberOfLines={1}>
              Welcome, {name}
            </Text>
          </View>
        </SafeAreaView>

        {/* Curved Gold Accent Line at bottom of header */}
        <View style={styles.goldCurveLine} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 2. The 3D Glossy Circular Check-In Button */}
        <View style={styles.shutterSection}>
          <View style={styles.shutterGoldRing}>
            <TouchableOpacity
              style={[
                styles.shutter3DButton,
                (!activeActivity || loadingActivity) && styles.shutter3DButtonDisabled,
              ]}
              onPress={handleCheckInPress}
              disabled={!activeActivity || loadingActivity}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={
                  activeActivity
                    ? ['#2563EB', '#173B70', '#0F2444']
                    : ['#94A3B8', '#64748B', '#334155']
                }
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={styles.shutterGradient}
              >
                {/* 3D Glossy Light Reflection (Top Arc) */}
                <View style={styles.shutterGloss} />

                {/* Shutter Icon & Text */}
                <View style={styles.shutterContent}>
                  {loadingActivity ? (
                    <ActivityIndicator size="large" color="#FFFFFF" />
                  ) : (
                    <>
                      <View style={styles.checkIconOuter}>
                        <Ionicons name="checkmark" size={38} color="#FFFFFF" />
                      </View>
                      <Text style={styles.shutterMainText}>
                        {activeActivity ? 'REGISTER' : 'ATTENDANCE'}
                      </Text>
                      <Text style={styles.shutterSubText}>
                        {activeActivity ? 'CHECK-IN' : 'PORTAL CLOSED'}
                      </Text>
                    </>
                  )}
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Session Status Pill below Button */}
          <View style={styles.statusPillContainer}>
            {activeActivity ? (
              <View style={styles.statusPillOpen}>
                <View style={styles.statusDotLive} />
                <Text style={styles.statusPillOpenText}>
                  LIVE SESSION OPEN • Closes at {new Date(activeActivity.closes_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            ) : (
              <View style={styles.statusPillClosed}>
                <Ionicons name="time-outline" size={13} color="#64748B" />
                <Text style={styles.statusPillClosedText}>
                  Next session opens on scheduled date
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 3. The Next Cleaning Date Card */}
        <View style={styles.dateCard}>
          <View style={styles.dateCardRow}>
            <View style={styles.dateIconWrapper}>
              <Ionicons name="calendar" size={26} color="#D4AF37" />
            </View>
            <View style={styles.dateInfoCol}>
              <Text style={styles.dateCardLabel}>NEXT CLEANING DATE</Text>
              <Text style={styles.dateCardValue}>{nextActivityDate}</Text>
              <Text style={styles.dateCardSub}>God's Grace Ministry Warri HQ • 6:00 AM</Text>
            </View>
          </View>
        </View>

        {/* 4. My Attendance History Section */}
        <View style={styles.historySection}>
          <View style={styles.historyHeaderRow}>
            <Text style={styles.sectionHeading}>MY RECENT ATTENDANCE</Text>
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
                  ? checkInDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
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

        {/* 5. Role-Conditional Admin Controls (For Super Admins) */}
        {isSuperAdmin && (
          <View style={styles.superAdminSection}>
            <View style={styles.adminBadgeRow}>
              <Ionicons name="shield-checkmark" size={16} color="#173B70" />
              <Text style={styles.adminSectionTitle}>SUPER ADMIN PORTAL</Text>
            </View>
            <Text style={styles.adminSectionSubtitle}>Full administrative oversight & reporting</Text>

            <TouchableOpacity
              style={styles.adminDashboardFullButton}
              onPress={() => navigation.navigate('SuperAdminDashboard')}
              activeOpacity={0.8}
            >
              <Text style={styles.adminDashboardFullButtonText}>Open Super Admin Dashboard →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 6. Footer Spiritual Quote with Gold Lines */}
        <View style={styles.quoteWrapper}>
          <View style={styles.quoteGoldLine} />
          <Text style={styles.quoteText}>
            "Affecting souls for Christ through music"
          </Text>
          <View style={styles.quoteGoldLine} />
        </View>
      </ScrollView>

      {/* 7. Bottom Navigation Tab Bar (Solid Navy, Gold active indicator) */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} activeOpacity={0.8}>
          <Ionicons name="home" size={22} color="#D4AF37" />
          <Text style={styles.navItemTextActive}>Home</Text>
          <View style={styles.activeGoldBar} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('MemberHistory')}
          activeOpacity={0.8}
        >
          <Ionicons name="time-outline" size={22} color="#94A3B8" />
          <Text style={styles.navItemTextInactive}>History</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('AccountSettings')}
          activeOpacity={0.8}
        >
          <Ionicons name="person-outline" size={22} color="#94A3B8" />
          <Text style={styles.navItemTextInactive}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Strict Pure White
  },
  watermark: {
    position: 'absolute',
    width: 320,
    height: 320,
    alignSelf: 'center',
    top: '30%',
    opacity: 0.06, // Strict approved faint watermark
    zIndex: 0,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 1. Header Styles
  headerWrapper: {
    backgroundColor: '#173B70', // Dark Navy
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    overflow: 'hidden',
    ...shadows.lifted,
    zIndex: 10,
  },
  headerSafeArea: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
  },
  headerTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    padding: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerLogo: {
    width: '100%',
    height: '100%',
  },
  headerBrandTexts: {
    justifyContent: 'center',
  },
  headerBrandTitle: {
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  headerBrandSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: '#D4AF37', // Gold Accent
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  unreadBadgeDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#173B70',
  },
  welcomeContainer: {
    marginTop: 4,
  },
  welcomeMotifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  welcomeAuraText: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#D4AF37',
    letterSpacing: 1,
  },
  welcomeGreeting: {
    fontSize: 26,
    fontFamily: fonts.serif, // Playfair Display
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  goldCurveLine: {
    height: 4,
    backgroundColor: '#D4AF37', // Gold curved bottom border
    width: '100%',
  },

  // Scroll Content
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 30,
  },

  // 2. 3D Shutter Button Styles
  shutterSection: {
    alignItems: 'center',
    marginVertical: 12,
  },
  shutterGoldRing: {
    width: 172,
    height: 172,
    borderRadius: 86,
    borderWidth: 4,
    borderColor: '#D4AF37', // Gold Ring
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#173B70',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 10,
  },
  shutter3DButton: {
    width: 156,
    height: 156,
    borderRadius: 78,
    overflow: 'hidden',
  },
  shutter3DButtonDisabled: {
    opacity: 0.85,
  },
  shutterGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  shutterGloss: {
    position: 'absolute',
    top: 0,
    left: 10,
    right: 10,
    height: 70,
    borderTopLeftRadius: 75,
    borderTopRightRadius: 75,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  shutterContent: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  checkIconOuter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  shutterMainText: {
    fontSize: 15,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
    letterSpacing: 1.2,
  },
  shutterSubText: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    color: '#D4AF37', // Gold Subtext
    letterSpacing: 0.6,
    marginTop: 2,
  },
  statusPillContainer: {
    marginTop: 14,
  },
  statusPillOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusDotLive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 7,
  },
  statusPillOpenText: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#047857',
  },
  statusPillClosed: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusPillClosedText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: '#64748B',
    marginLeft: 5,
  },

  // 3. Next Cleaning Date Card
  dateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#D4AF37', // Thick Gold Border
    padding: 18,
    marginTop: 16,
    marginBottom: 20,
    ...shadows.card,
  },
  dateCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateIconWrapper: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(212, 175, 55, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  dateInfoCol: {
    flex: 1,
  },
  dateCardLabel: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    letterSpacing: 0.8,
  },
  dateCardValue: {
    fontSize: 22,
    fontFamily: fonts.serif, // Playfair Display
    color: '#173B70', // Navy
    marginTop: 2,
  },
  dateCardSub: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#94A3B8',
    marginTop: 2,
  },

  // 4. History Section
  historySection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E9EEF5',
    padding: 18,
    marginBottom: 20,
    ...shadows.card,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sectionHeading: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    letterSpacing: 0.6,
  },
  viewAllLink: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#173B70',
  },
  historyTable: {
    borderTopWidth: 1,
    borderTopColor: '#F3F6FA',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E9EEF5',
  },
  tableHeaderCell: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F6FA',
  },
  tableCellName: {
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
    color: '#0F172A',
  },
  tableCell: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#475569',
  },
  tableCellStatus: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#10B981',
  },
  tableEmptyRow: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  tableEmptyText: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#64748B',
  },

  // 5. Super Admin Quick Section
  superAdminSection: {
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    ...shadows.card,
  },
  adminBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  adminSectionTitle: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#173B70',
    letterSpacing: 0.5,
    marginLeft: 6,
  },
  adminSectionSubtitle: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: '#475569',
    marginBottom: 10,
  },
  adminDashboardFullButton: {
    backgroundColor: '#173B70',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  adminDashboardFullButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.sansBold,
  },

  // 6. Spiritual Quote Footer
  quoteWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
    paddingHorizontal: 10,
  },
  quoteGoldLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#D4AF37', // Gold line
    opacity: 0.45,
  },
  quoteText: {
    fontSize: 12,
    fontFamily: fonts.serifSemiBold,
    fontStyle: 'italic',
    color: '#173B70',
    marginHorizontal: 12,
    textAlign: 'center',
  },

  // 7. Bottom Tab Bar
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#173B70', // Solid Navy
    borderTopWidth: 1,
    borderTopColor: 'rgba(212, 175, 55, 0.2)',
    paddingVertical: 8,
    paddingBottom: 16,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 16,
  },
  navItemTextActive: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#D4AF37', // Active Gold
    marginTop: 3,
  },
  navItemTextInactive: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    color: '#94A3B8', // Inactive Silver/Gray
    marginTop: 3,
  },
  activeGoldBar: {
    position: 'absolute',
    bottom: -6,
    width: 28,
    height: 3,
    backgroundColor: '#D4AF37', // 3px Gold underline
    borderRadius: 1.5,
  },
});
