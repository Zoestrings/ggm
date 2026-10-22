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
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from '../lib/notifications';
import { syncPendingCheckins } from '../lib/offline';
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

  return (
    <View style={styles.container}>
      {/* 1. Background Approved Faint Watermark (Strict 0.04 Opacity) */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* 2. Faint Musical Background Texture Floating Across Page */}
      <View style={styles.backgroundMusicalTexture} pointerEvents="none">
        <Text style={[styles.bgMusicNote, { top: 220, left: 16 }]}>𝄞</Text>
        <Text style={[styles.bgMusicNote, { top: 270, right: 24, fontSize: 32 }]}>♫</Text>
        <Text style={[styles.bgMusicNote, { top: 380, left: 28 }]}>♪</Text>
        <Text style={[styles.bgMusicNote, { top: 480, right: 35 }]}>𝄢</Text>
        <Text style={[styles.bgMusicNote, { top: 560, left: 18, fontSize: 28 }]}>♬</Text>
        <Text style={[styles.bgMusicNote, { top: 640, right: 22 }]}>♩</Text>
      </View>

      {/* 3. The Wavy Navy Header with Musical Notes & Gold Curved Border */}
      <View style={styles.headerWrapper}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.headerSafeArea}>
          {/* Faint Musical Notes Inside Header */}
          <View style={styles.headerMusicalBackground} pointerEvents="none">
            <Text style={[styles.headerMusicNote, { top: 12, right: 30 }]}>♪</Text>
            <Text style={[styles.headerMusicNote, { top: 42, right: 80, fontSize: 24 }]}>♫</Text>
            <Text style={[styles.headerMusicNote, { top: 68, left: 20 }]}>♩</Text>
            <Text style={[styles.headerMusicNote, { top: 20, left: 130, fontSize: 20 }]}>♬</Text>
            <Text style={[styles.headerMusicNote, { top: 55, right: 140 }]}>♪</Text>
          </View>

          {/* Top Bar: Logo & Notification Bell */}
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

          {/* Welcome Area: Gold Sun Icon & Playfair Display Font */}
          <View style={styles.welcomeContainer}>
            <View style={styles.welcomeGoldIconWrapper}>
              <Ionicons name="sunny" size={20} color="#D4AF37" />
            </View>
            <Text style={styles.welcomeGreeting} numberOfLines={1}>
              Welcome, {name}
            </Text>
            <Text style={styles.welcomeSubtitle}>Sanctuary Music Ministry</Text>
          </View>
        </SafeAreaView>

        {/* Wavy SVG Bottom Curve with 4px Thick Gold Border */}
        <Svg
          width="100%"
          height={40}
          viewBox="0 0 375 40"
          preserveAspectRatio="none"
          style={styles.wavySvg}
        >
          {/* Navy Wave Body */}
          <Path
            d="M0,0 L375,0 L375,12 Q280,38 187.5,20 Q95,2 0,28 Z"
            fill="#173B70"
          />
          {/* Thick Gold Wave Border Along the Bottom */}
          <Path
            d="M0,28 Q95,2 187.5,20 Q280,38 375,12"
            fill="none"
            stroke="#D4AF37"
            strokeWidth="4"
          />
        </Svg>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 4. Central Action Area: Giant Gold Ring with GGM Logo & Pill "Check In →" Button */}
        <View style={styles.shutterSection}>
          {/* Giant Gold Ring with GGM Church Logo (Tap to Check In) */}
          <TouchableOpacity
            style={[
              styles.shutterGoldRing,
              (!activeActivity || loadingActivity) && styles.shutterGoldRingDisabled,
            ]}
            onPress={handleCheckInPress}
            disabled={!activeActivity || loadingActivity}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={
                activeActivity
                  ? ['#1E40AF', '#173B70', '#0F2444']
                  : ['#94A3B8', '#475569', '#1E293B']
              }
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.85, y: 1 }}
              style={styles.shutterGradient}
            >
              {/* 3D Glossy Light Reflection (Top Arc) */}
              <View style={styles.shutterGloss} />

              {/* Church Brand Emblem Proudly Centered */}
              <View style={styles.logoCircleWrapper}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.shutterLogo}
                  resizeMode="contain"
                />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          {/* Dedicated Navy Pill-Shaped "Check In →" Button Directly Below Circle */}
          <TouchableOpacity
            style={[
              styles.pillCheckInButton,
              (!activeActivity || loadingActivity) && styles.pillCheckInDisabled,
            ]}
            onPress={handleCheckInPress}
            disabled={!activeActivity || loadingActivity}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={
                activeActivity
                  ? ['#173B70', '#1E40AF']
                  : ['#94A3B8', '#64748B']
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.pillCheckInGradient}
            >
              <Ionicons
                name="camera"
                size={18}
                color={activeActivity ? '#D4AF37' : '#FFFFFF'}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.pillCheckInText}>
                {activeActivity ? 'Check In' : 'Attendance Closed'}
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={activeActivity ? '#D4AF37' : '#FFFFFF'}
                style={{ marginLeft: 8 }}
              />
            </LinearGradient>
          </TouchableOpacity>

          {/* Session Status Caption (Live Green Pill vs. Closed Gray Pill) */}
          <View style={styles.sessionStatusRow}>
            {activeActivity ? (
              <View style={styles.statusLivePill}>
                <View style={styles.liveGreenDot} />
                <Text style={styles.statusLiveText}>
                  LIVE SESSION OPEN • Closes at {new Date(activeActivity.closes_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            ) : (
              <View style={styles.statusClosedPill}>
                <View style={styles.closedGrayDot} />
                <Text style={styles.statusClosedText}>
                  ATTENDANCE CLOSED • Next session on scheduled cleaning date
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 5. The Next Cleaning Date Card (Pure White with Crisp 2px Gold Border) */}
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

        {/* 6. My Attendance History Section */}
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

        {/* 7. Role-Conditional Admin Controls (For Super Admins) */}
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

        {/* 8. Footer Spiritual Quote with Gold Lines */}
        <View style={styles.quoteWrapper}>
          <View style={styles.quoteGoldLine} />
          <Text style={styles.quoteText}>
            "Affecting souls for Christ through music"
          </Text>
          <View style={styles.quoteGoldLine} />
        </View>
      </ScrollView>
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
    opacity: 0.04, // Strict approved faint watermark
    zIndex: 0,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Faint Musical Background Texture
  backgroundMusicalTexture: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  bgMusicNote: {
    position: 'absolute',
    fontSize: 26,
    color: '#173B70',
    opacity: 0.045, // Faint musical note texture
    fontWeight: '700',
  },

  // 1. Wavy Header Styles
  headerWrapper: {
    backgroundColor: '#173B70', // Dark Navy
    overflow: 'hidden',
    ...shadows.lifted,
    zIndex: 10,
  },
  headerSafeArea: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 4,
    position: 'relative',
  },
  headerMusicalBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  headerMusicNote: {
    position: 'absolute',
    fontSize: 18,
    color: '#D4AF37',
    opacity: 0.16, // Gold musical notes floating in header
  },
  headerTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
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
    borderWidth: 1.5,
    borderColor: '#D4AF37', // Gold trim
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
    borderColor: 'rgba(212, 175, 55, 0.35)',
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
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  welcomeGoldIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(212, 175, 55, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  welcomeGreeting: {
    fontSize: 26,
    fontFamily: fonts.serif, // Playfair Display
    color: '#FFFFFF',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  welcomeSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 3,
    letterSpacing: 0.5,
  },
  wavySvg: {
    marginTop: -2,
  },

  // Scroll Content
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 30,
  },

  // 2. Central 3D Logo Ring & Pill Button Styles
  shutterSection: {
    alignItems: 'center',
    marginVertical: 10,
  },
  shutterGoldRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 4,
    borderColor: '#D4AF37', // Gold Ring
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#173B70',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 12,
  },
  shutterGoldRingDisabled: {
    opacity: 0.85,
  },
  shutterGradient: {
    width: 144,
    height: 144,
    borderRadius: 72,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  shutterGloss: {
    position: 'absolute',
    top: 0,
    left: 8,
    right: 8,
    height: 65,
    borderTopLeftRadius: 70,
    borderTopRightRadius: 70,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  logoCircleWrapper: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#FFFFFF',
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#D4AF37', // Gold Border around logo
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  shutterLogo: {
    width: '100%',
    height: '100%',
  },

  // Dedicated Pill-Shaped "Check In →" Button
  pillCheckInButton: {
    marginTop: 18,
    borderRadius: 25,
    overflow: 'hidden',
    ...shadows.lifted,
    width: 220,
  },
  pillCheckInDisabled: {
    opacity: 0.65,
    elevation: 0,
  },
  pillCheckInGradient: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D4AF37', // Gold Trim
    borderRadius: 25,
  },
  pillCheckInText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: fonts.sansBold,
    letterSpacing: 0.5,
  },
  sessionStatusRow: {
    marginTop: 12,
  },
  statusLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  liveGreenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 7,
  },
  statusLiveText: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#047857',
  },
  statusClosedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  closedGrayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
    marginRight: 7,
  },
  statusClosedText: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: '#64748B',
  },

  // 3. Next Cleaning Date Card (Pure White with Crisp 2px Gold Border)
  dateCard: {
    backgroundColor: '#FFFFFF', // Pure White (NO yellow)
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#D4AF37', // Crisp 2px Gold Border
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
});
