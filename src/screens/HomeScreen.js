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

const PROFILE_CACHE_KEY = '@ggm_user_profile';

export default function HomeScreen({ navigation }) {
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
          let { data: activities } = await supabase
            .from('activities')
            .select('*')
            .lte('opens_at', now)
            .gte('closes_at', now)
            .is('finalized_at', null)
            .order('opens_at', { ascending: false })
            .limit(1);

          // If no currently active window, fetch the most recent activity for seamless check-in routing
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
          } catch (_notifErr) {}

          // 6. Try syncing any queued offline check-ins
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
        <ActivityIndicator size="large" color="#173B70" />
      </View>
    );
  }

  const meta = user?.user_metadata || {};
  const name = userProfile?.name || meta.full_name || 'Member';

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
        {/* 4. The Giant Check-In Button (Solid Navy, 4px Gold Border, Soft Navy Shadow, Camera Icon) */}
        <View style={styles.buttonSection}>
          <TouchableOpacity
            style={styles.giantButton}
            onPress={handleCheckInPress}
            activeOpacity={0.88}
          >
            {/* Soft Top Gloss Highlight */}
            <View style={styles.buttonGloss} />

            {/* Large White Camera Icon */}
            <Ionicons name="camera" size={54} color="#FFFFFF" style={{ marginBottom: 4 }} />

            {/* Bold White Action Text */}
            <Text style={styles.giantButtonText}>CHECK IN</Text>
          </TouchableOpacity>

          {/* Session Status Pill */}
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
                  ATTENDANCE CLOSED • Next session on scheduled date
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

        {/* 6. Footer Spiritual Quote with Gold Lines & Ministry Subtitle */}
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
    opacity: 0.045,
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
    paddingTop: 24,
    paddingBottom: 30,
  },

  // 2. Giant Button (Solid Navy, 4px Gold Border, Soft Navy Shadow)
  buttonSection: {
    alignItems: 'center',
    marginVertical: 18,
  },
  giantButton: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: '#173B70', // Solid Navy
    borderWidth: 4,
    borderColor: '#D4AF37', // 4px Gold Border
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    // Mature, Premium Soft Navy Shadow
    shadowColor: '#173B70',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonGloss: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 55,
    borderTopLeftRadius: 80,
    borderTopRightRadius: 80,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  giantButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: fonts.sansBold,
    letterSpacing: 1.5,
  },
  sessionStatusRow: {
    marginTop: 16,
  },
  statusLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 14,
    paddingVertical: 7,
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
    paddingHorizontal: 14,
    paddingVertical: 7,
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
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#D4AF37', // Crisp 2px Gold Border
    padding: 18,
    marginTop: 12,
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

  // 4. Spiritual Quote & Ministry Footer
  footerContainer: {
    alignItems: 'center',
    marginVertical: 20,
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
  footerMinistrySubtitle: {
    fontSize: 10,
    fontFamily: fonts.sansBold,
    color: '#D4AF37', // Gold Accent
    letterSpacing: 1.2,
    marginTop: 6,
    textAlign: 'center',
  },
});
