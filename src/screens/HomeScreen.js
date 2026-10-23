import React, { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from '../lib/notifications';
import { syncPendingCheckins } from '../lib/offline';
import { fonts, shadows } from '../theme';
import GeometricHeader from '../components/GeometricHeader';

const PROFILE_CACHE_KEY = '@ggm_user_profile';

export default function HomeScreen({ navigation, route }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [activeActivity, setActiveActivity] = useState(null);
  const [nextActivityDate, setNextActivityDate] = useState('3rd November');
  const [loadingActivity, setLoadingActivity] = useState(true);
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
          } catch (_cErr) { }

          // 3. Fetch fresh user profile from public.users table (source of truth)
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', currentUser.id)
            .single();

          if (isMounted) {
            const isKnownSuperAdmin = currentUser.email?.toLowerCase() === 'akpodomagoodluck9@gmail.com';
            if (profile) {
              const effectiveRole = profile.role || (isKnownSuperAdmin ? 'super_admin' : 'member');
              const finalProfile = { ...profile, role: effectiveRole };
              setUserProfile(finalProfile);
              await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(finalProfile));
            } else {
              const meta = currentUser.user_metadata || {};
              const healedRole = meta.role || (isKnownSuperAdmin ? 'super_admin' : 'member');
              const healedProfile = {
                id: currentUser.id,
                name: meta.full_name || meta.name || currentUser.email?.split('@')[0] || 'Member',
                phone: meta.phone || profile?.phone || '',
                instrument: (meta.instrument && meta.instrument !== 'Musician')
                  ? meta.instrument
                  : ((profile?.instrument && profile.instrument !== 'Musician') ? profile.instrument : 'Keyboard'),
                role: healedRole,
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
          let { data: activities } = await supabase
            .from('activities')
            .select('*')
            .lte('opens_at', now)
            .gte('closes_at', now)
            .is('finalized_at', null)
            .order('opens_at', { ascending: false })
            .limit(1);

          // If no currently active window, fetch latest for seamless check-in routing
          if (!activities || activities.length === 0) {
            const { data: latestActs } = await supabase
              .from('activities')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(1);
            if (latestActs && latestActs.length > 0) {
              activities = latestActs;
            }
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

          // 5. Query unread notifications count
          try {
            const { count: unreadCount } = await supabase
              .from('notifications')
              .select('*', { count: 'exact', head: true })
              .eq('member_id', currentUser.id)
              .is('read_at', null);

            if (isMounted) {
              setUnreadNotifications(unreadCount || 0);
            }
          } catch (_notifErr) { }

          // 6. Try syncing any queued offline check-ins
          try {
            await syncPendingCheckins();
          } catch (_syncErr) { }
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
    const targetActivity = activeActivity || {
      id: 'general-session',
      name: 'Musician Service Session',
      opens_at: new Date(Date.now() - 3600000).toISOString(),
      closes_at: new Date(Date.now() + 86400000).toISOString(),
    };
    navigation.navigate('CheckIn', { activity: targetActivity });
  };

  if (loadingUser && !user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#403F91" />
      </View>
    );
  }

  const meta = user?.user_metadata || {};
  const name = userProfile?.name || meta.full_name || 'Member';
  const userRole = (userProfile?.role || meta.role || '').toLowerCase();
  const isSuperAdmin =
    userRole === 'super_admin' ||
    userRole === 'admin' ||
    user?.email?.toLowerCase() === 'akpodomagoodluck9@gmail.com';
  const isSubAdmin = userRole === 'sub_admin';

  const navigateToAdmin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isSuperAdmin) {
      navigation.navigate('SuperAdminDashboard');
    } else if (isSubAdmin) {
      navigation.navigate('SubAdminDashboard');
    }
  };

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

      {/* 3. The Navy Header with Clean Rounded-Square Logo Container & Gold Curved Bottom */}
      <View style={styles.headerWrapper}>
        {/* Geometric Background Pattern */}
        <GeometricHeader />
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.headerSafeArea}>
          {/* Subtle Musical Texture inside Header */}
          <View style={styles.headerMusicalBackground} pointerEvents="none">
            <Text style={[styles.headerMusicNote, { top: 12, right: 30 }]}>♪</Text>
            <Text style={[styles.headerMusicNote, { top: 42, right: 80, fontSize: 24 }]}>♫</Text>
            <Text style={[styles.headerMusicNote, { top: 68, left: 20 }]}>♩</Text>
            <Text style={[styles.headerMusicNote, { top: 20, left: 130, fontSize: 20 }]}>♬</Text>
          </View>

          {/* Top Bar: Clean White Rounded Square Logo Box & Notification Bell */}
          <View style={styles.headerTopBar}>
            <View style={styles.headerLeft}>
              {/* Logo directly on Navy Background */}
              <Image
                source={require('../../assets/logo.png')}
                style={styles.headerLogoDirect}
                resizeMode="contain"
              />
              <View style={styles.headerBrandTexts}>
                <Text style={styles.headerBrandTitle}>GGM INSTRUMENTALIST</Text>
                <Text style={styles.headerBrandSubtitle}>GOD'S GRACE MINISTRY INC.</Text>
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
            <Text style={styles.welcomeSubtitle}>GOD'S GRACE MINISTRY INC.</Text>
          </View>
        </SafeAreaView>

        {/* Wavy SVG Bottom Curve with 4px Thick Gold Border (Safely Positioned Below Header Content) */}
        <Svg
          width="100%"
          height={32}
          viewBox="0 0 375 32"
          preserveAspectRatio="none"
          style={styles.wavySvg}
        >
          {/* Navy Wave Body */}
          <Path
            d="M0,0 L375,0 L375,10 Q280,30 187.5,16 Q95,2 0,22 Z"
            fill="#403F91"
          />
          {/* Thick Gold Wave Border Along the Bottom */}
          <Path
            d="M0,22 Q95,2 187.5,16 Q280,30 375,10"
            fill="none"
            stroke="#D4AF37"
            strokeWidth="3.5"
          />
        </Svg>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 4. Giant Check-In Button */}
        <View style={styles.buttonSection}>
          <TouchableOpacity
            style={styles.giantButton}
            onPress={handleCheckInPress}
            activeOpacity={0.88}
          >
            {/* Church Logo completely filling the circle edge-to-edge */}
            <Image
              source={require('../../assets/logo.png')}
              style={styles.giantButtonLogo}
              resizeMode="cover"
            />
          </TouchableOpacity>

          {/* Eye-Catching Bold Action Text */}
          <Text style={styles.buttonInstructionText}>
            Tap to Register your Attendance
          </Text>
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


        {/* 7. Footer Spiritual Quote with Gold Lines & Ministry Subtitle */}
        <View style={styles.footerContainer}>
          <View style={styles.quoteWrapper}>
            <View style={styles.quoteGoldLine} />
            <Text style={styles.quoteText}>
              "Affecting souls for Christ through music"
            </Text>
            <View style={styles.quoteGoldLine} />
          </View>
          <Text style={styles.footerMinistrySubtitle}>
            GOD'S GRACE MINISTRY INSTRUMENTALIST
          </Text>
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
    opacity: 0.04,
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
    color: '#403F91',
    opacity: 0.045,
    fontWeight: '700',
  },

  // 1. Header Styles
  headerWrapper: {
    backgroundColor: '#403F91', // Dark Navy
    position: 'relative',
    overflow: 'hidden',
    ...shadows.lifted,
    zIndex: 10,
  },
  geometricPatternImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.8,
  },
  headerSafeArea: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14, // Generous breathing room
    position: 'relative',
    zIndex: 1,
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
    opacity: 0.16,
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
  // Logo directly on Navy Background
  headerLogoDirect: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
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
  headerAdminButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.15)',
    borderWidth: 1,
    borderColor: '#D4AF37',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  headerAdminButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
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
    borderColor: '#403F91',
  },
  welcomeContainer: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 6,
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
    fontFamily: fonts.serif,
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
    paddingTop: 20,
    paddingBottom: 90, // Generous clearance for docked bottom tab bar
  },

  buttonSection: {
    alignItems: 'center',
    marginVertical: 16,
  },
  giantButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#403F91', // Royal Indigo circle
    borderWidth: 4,
    borderColor: '#D4AF37',     // Crisp 4px Gold Border
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',

    // Tactile 3D Circular Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  giantButtonLogo: {
    width: '100%',
    height: '100%',
    borderRadius: 80,
    backgroundColor: 'transparent',
  },
  buttonInstructionText: {
    fontSize: 16,
    fontFamily: fonts.sansSemiBold, // Inter_600SemiBold
    fontWeight: '600',
    color: '#173A70',               // Deep Navy
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 6,
    letterSpacing: 0.2,
  },

  // 3. Next Cleaning Date Card (Pure White with Crisp 2px Gold Border)
  dateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#D4AF37',
    padding: 18,
    marginTop: 8,
    marginBottom: 18,
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
    fontFamily: fonts.serif,
    color: '#403F91',
    marginTop: 2,
  },
  dateCardSub: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#94A3B8',
    marginTop: 2,
  },

  // 4. Spiritual Quote & Ministry Footer
  footerContainer: {
    alignItems: 'center',
    marginVertical: 18,
    paddingHorizontal: 10,
  },
  quoteWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  quoteGoldLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#D4AF37',
    opacity: 0.45,
  },
  quoteText: {
    fontSize: 12,
    fontFamily: fonts.serifSemiBold,
    fontStyle: 'italic',
    color: '#403F91',
    marginHorizontal: 12,
    textAlign: 'center',
  },
  footerMinistrySubtitle: {
    fontSize: 10,
    fontFamily: fonts.sansBold,
    color: '#D4AF37',
    letterSpacing: 1.2,
    marginTop: 6,
    textAlign: 'center',
  },

  // 5. Admin Portal Header & Bottom Card Styles
  headerAdminButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    borderWidth: 1.5,
    borderColor: '#D4AF37',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    marginRight: 8,
  },
  headerAdminButtonText: {
    color: '#D4AF37',
    fontSize: 12,
    fontFamily: fonts.sansBold,
    letterSpacing: 0.3,
  },
  adminPortalCard: {
    backgroundColor: '#403F91', // Rich Solid Navy
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#D4AF37', // Gold Accent Border
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
    shadowColor: '#403F91',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  adminPortalLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  adminPortalIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(212, 175, 55, 0.16)',
    borderWidth: 1,
    borderColor: '#D4AF37',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  adminPortalTextWrapper: {
    flex: 1,
  },
  adminPortalTitle: {
    fontSize: 15,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  adminPortalSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#CBD5E1',
    marginTop: 2,
  },
  adminPortalArrowBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
});
