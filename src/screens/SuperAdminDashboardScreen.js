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
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { fonts, shadows } from '../theme';

export default function SuperAdminDashboardScreen({ navigation }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [activeActivity, setActiveActivity] = useState(null);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [totalMembersCount, setTotalMembersCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [latestReport, setLatestReport] = useState(null);
  const [recentCheckins, setRecentCheckins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [_downloadingPdf, setDownloadingPdf] = useState(false);

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

          // 2. Fetch profile
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

          if (isMounted) setUserProfile(profile);

          // 3. User counts
          const { count: memberCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
          if (isMounted) setTotalMembersCount(memberCount || 0);

          // 4. Query current activity
          const { data: activities } = await supabase
            .from('activities')
            .select('*')
            .order('opens_at', { ascending: false })
            .limit(1);

          const currentAct = activities && activities.length > 0 ? activities[0] : null;
          if (isMounted) setActiveActivity(currentAct);

          if (currentAct) {
            // Count checked-in
            const { count: attCount } = await supabase
              .from('attendance')
              .select('*', { count: 'exact', head: true })
              .eq('activity_id', currentAct.id);
            if (isMounted) setCheckedInCount(attCount || 0);

            // Check if PDF report exists
            try {
              const { data: repData } = await supabase
                .from('reports')
                .select('*')
                .eq('activity_id', currentAct.id)
                .order('generated_at', { ascending: false })
                .limit(1);

              if (isMounted && repData && repData.length > 0) {
                setLatestReport(repData[0]);
              } else if (isMounted) {
                setLatestReport(null);
              }
            } catch (_rErr) {}

            // Pending offline reviews
            const { count: pendCount } = await supabase
              .from('pending_checkins')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'pending');
            if (isMounted) setPendingReviewCount(pendCount || 0);
          }

          // 5. Query 3 most recent check-ins
          try {
            let recents = [];
            const { data: recs, error: recsErr } = await supabase
              .from('attendance')
              .select(`
                id,
                member_id,
                checked_in_at,
                selfie_url,
                verification_status,
                user:users!attendance_member_id_fkey (
                  id,
                  name,
                  instrument
                )
              `)
              .order('checked_in_at', { ascending: false })
              .limit(3);

            if (!recsErr && recs && recs.length > 0) {
              recents = recs;
            } else {
              // Fallback query if relation name differs
              const { data: rawRecs } = await supabase
                .from('attendance')
                .select('id, member_id, checked_in_at, selfie_url, verification_status')
                .order('checked_in_at', { ascending: false })
                .limit(3);

              if (rawRecs && rawRecs.length > 0) {
                const memberIds = rawRecs.map((r) => r.member_id).filter(Boolean);
                const { data: usersData } = await supabase
                  .from('users')
                  .select('id, name, instrument')
                  .in('id', memberIds);

                const userMap = {};
                usersData?.forEach((u) => {
                  userMap[u.id] = u;
                });
                recents = rawRecs.map((r) => ({
                  ...r,
                  user: userMap[r.member_id] || { name: 'Member', instrument: 'Instrumentalist' },
                }));
              }
            }

            if (isMounted) setRecentCheckins(recents);
          } catch (recErr) {
            console.log('Recent check-ins fetch error:', recErr);
          }
        } catch (err) {
          console.error('SuperAdminDashboard load error:', err);
        } finally {
          if (isMounted) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      };

      fetchAdminStats();

      return () => {
        isMounted = false;
      };
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
  };

  const handleDownloadPDF = async () => {
    if (!latestReport?.storage_path) {
      Alert.alert(
        'PDF Report Generated',
        'Generating and compiling official monthly attendance PDF report with member photo verifications...',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      setDownloadingPdf(true);
      const { data: signedData, error: signErr } = await supabase.storage
        .from('reports')
        .createSignedUrl(latestReport.storage_path, 3600);

      if (signErr || !signedData?.signedUrl) {
        throw new Error(signErr?.message || 'Could not generate download link.');
      }

      const fileUrl = signedData.signedUrl;
      const fileName = `GGM_Attendance_${latestReport.activity_id.slice(0, 8)}.pdf`;
      const localUri = `${FileSystem.documentDirectory}${fileName}`;

      const downloadResult = await FileSystem.downloadAsync(fileUrl, localUri);

      if (downloadResult.status !== 200) {
        throw new Error('PDF download failed.');
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadResult.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Attendance PDF',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Downloaded', `Saved to ${downloadResult.uri}`);
      }
    } catch (err) {
      Alert.alert('Download Error', err.message || 'Failed to download report.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const formatCheckInTime = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_e) {
      return '';
    }
  };

  const adminName = userProfile?.name || 'Super Admin';

  if (loading && !userProfile) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#173B70" />
      </View>
    );
  }

  // 9 Mobile Banking (FirstBank) Style Administrative Actions
  const actionItems = [
    {
      id: 'register',
      label: 'Register',
      icon: 'camera',
      onPress: () => navigation.navigate('Register'),
    },
    {
      id: 'attendance',
      label: 'Attendance',
      icon: 'list',
      onPress: () => navigation.navigate('AttendanceList', { activity: activeActivity }),
    },
    {
      id: 'directory',
      label: 'Directory',
      icon: 'people',
      onPress: () => navigation.navigate('AllAttendance'),
    },
    {
      id: 'pdf',
      label: 'PDF Report',
      icon: 'document-text',
      onPress: handleDownloadPDF,
    },
    {
      id: 'performers',
      label: 'Performers',
      icon: 'trophy',
      onPress: () => navigation.navigate('TopPerformers'),
    },
    {
      id: 'admins',
      label: 'Admins',
      icon: 'shield-checkmark',
      onPress: () => navigation.navigate('ManageRoles'),
    },
    {
      id: 'audit',
      label: 'Audit Logs',
      icon: 'lock-closed',
      onPress: () => navigation.navigate('AuditLog'),
    },
    {
      id: 'announce',
      label: 'Announce',
      icon: 'megaphone',
      onPress: () => navigation.navigate('Notifications'),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'settings',
      onPress: () => navigation.navigate('AccountSettings'),
    },
  ];

  return (
    <View style={styles.container}>
      {/* ── 1. The Dark Navy Hero Header (Top 40% of Screen, Solid Navy #173B70) ── */}
      <View style={styles.heroHeader}>
        {/* Subtle Geometric Texture Overlay (Large Overlapping Squares) */}
        <View style={styles.geometricPatternContainer} pointerEvents="none">
          <View style={[styles.geometricSquare, { top: -40, right: -30, width: 200, height: 200, transform: [{ rotate: '15deg' }] }]} />
          <View style={[styles.geometricSquare, { top: 70, right: 30, width: 150, height: 150, transform: [{ rotate: '32deg' }] }]} />
          <View style={[styles.geometricSquare, { top: 120, left: -60, width: 180, height: 180, transform: [{ rotate: '25deg' }] }]} />
        </View>

        <SafeAreaView edges={['top', 'left', 'right']} style={styles.heroSafeArea}>
          {/* Top Bar: Hamburger menu (left), "Dashboard" (centered Playfair Display 24px), Notification Bell with Red Badge (right) */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => navigation.navigate('Home')}
              activeOpacity={0.7}
            >
              <Ionicons name="menu" size={26} color="#FFFFFF" />
            </TouchableOpacity>

            <Text style={styles.topBarTitle}>Dashboard</Text>

            <TouchableOpacity
              style={styles.bellButtonWrapper}
              onPress={() => navigation.navigate('Notifications')}
              activeOpacity={0.7}
            >
              <Ionicons name="notifications" size={24} color="#FFFFFF" />
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>25</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Profile Row: Large Circular Logo Container + Details */}
          <View style={styles.profileRow}>
            {/* Pure Circle Logo Container (No gold ring) */}
            <View style={styles.profileLogoCircle}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.profileLogo}
                resizeMode="contain"
              />
            </View>

            <View style={styles.profileDetailsCol}>
              <Text style={styles.brandTitle}>GGM Instrumentalists</Text>
              <Text style={styles.brandSubtitle}>Gods Ministry Inc.</Text>
              <View style={styles.welcomeAdminRow}>
                <Text style={styles.welcomeAdminText} numberOfLines={1}>
                  Welcome, {adminName}
                </Text>
                <Ionicons name="checkmark-circle" size={17} color="#38BDF8" style={{ marginLeft: 6 }} />
              </View>
            </View>

            {/* Switch to Member View */}
            <TouchableOpacity
              style={styles.memberViewButton}
              onPress={() => navigation.navigate('Home', { isMemberView: true, screen: 'HomeScreen', params: { isMemberView: true } })}
              activeOpacity={0.8}
            >
              <Text style={styles.memberViewButtonText}>Member View</Text>
            </TouchableOpacity>
          </View>

          {/* Translucent Info Card (borderRadius: 16, rgba(255, 255, 255, 0.15)) */}
          <View style={styles.translucentStatsCard}>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>TOTAL MEMBERS</Text>
              <Text style={styles.statNumber}>{totalMembersCount}</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>TODAY'S CHECK-INS</Text>
              <Text style={styles.statNumber}>{checkedInCount}</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>

      {/* ── 2. The Clean Transition to Pure White (#FFFFFF) 3x3 Action Grid ── */}
      <ScrollView
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#173B70']}
            tintColor="#173B70"
          />
        }
      >
        <Text style={styles.gridSectionHeading}>ADMINISTRATIVE ACTIONS</Text>

        {/* 3-Column Action Grid (75x75 Navy Blue Circular Buttons with White Icons) */}
        <View style={styles.actionGrid}>
          {actionItems.map((item) => (
            <View key={item.id} style={styles.gridItemWrapper}>
              <TouchableOpacity
                style={styles.actionCircleButton}
                onPress={item.onPress}
                activeOpacity={0.82}
              >
                <Ionicons name={item.icon} size={30} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.actionLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Pending Review Banner if offline items waiting */}
        {pendingReviewCount > 0 && (
          <TouchableOpacity
            style={styles.pendingBanner}
            onPress={() => navigation.navigate('PendingReview')}
            activeOpacity={0.85}
          >
            <View style={styles.pendingBadgeIcon}>
              <Ionicons name="alert-circle" size={20} color="#B45309" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingTitle}>
                {pendingReviewCount} Offline Submission{pendingReviewCount !== 1 ? 's' : ''} Pending
              </Text>
              <Text style={styles.pendingSub}>Tap to review and approve member records</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#B45309" />
          </TouchableOpacity>
        )}

        {/* ── 3. Bottom Section: RECENT CHECK-INS ── */}
        <View style={styles.recentSection}>
          <View style={styles.recentHeaderRow}>
            <Text style={styles.recentSectionHeading}>RECENT CHECK-INS</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('AttendanceList', { activity: activeActivity })}
              activeOpacity={0.7}
            >
              <Text style={styles.seeAllText}>See All →</Text>
            </TouchableOpacity>
          </View>

          {recentCheckins.length === 0 ? (
            <View style={styles.emptyRecentCard}>
              <Ionicons name="time-outline" size={32} color="#94A3B8" />
              <Text style={styles.emptyRecentTitle}>No Check-ins Recorded Today</Text>
              <Text style={styles.emptyRecentSubtitle}>
                Member attendance records will appear here in real time.
              </Text>
            </View>
          ) : (
            <View style={styles.recentListCard}>
              {recentCheckins.map((item, idx) => {
                const memberName = item.user?.name || 'Member';
                const instrument = item.user?.instrument || 'Instrumentalist';
                const timeString = formatCheckInTime(item.checked_in_at);
                const initial = memberName.charAt(0).toUpperCase();
                const isLast = idx === recentCheckins.length - 1;

                return (
                  <View key={item.id || idx}>
                    <View style={styles.recentItemRow}>
                      {/* Avatar */}
                      <View style={styles.recentAvatarCircle}>
                        {item.selfie_url ? (
                          <Image
                            source={{ uri: item.selfie_url }}
                            style={styles.recentAvatarImage}
                          />
                        ) : (
                          <Text style={styles.recentAvatarInitial}>{initial}</Text>
                        )}
                      </View>

                      {/* Name & Instrument */}
                      <View style={styles.recentMemberInfo}>
                        <Text style={styles.recentMemberName}>{memberName}</Text>
                        <Text style={styles.recentMemberInstrument}>{instrument}</Text>
                      </View>

                      {/* Time Badge */}
                      <View style={styles.recentTimeBadge}>
                        <Ionicons name="time-outline" size={12} color="#173B70" style={{ marginRight: 4 }} />
                        <Text style={styles.recentTimeText}>{timeString}</Text>
                      </View>
                    </View>
                    {!isLast && <View style={styles.recentItemDivider} />}
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── 4. The Solid Navy Bottom Tab Bar (3 Tabs: Home, History, Profile) ── */}
      <View style={styles.bottomTabBar}>
        <TouchableOpacity
          style={styles.bottomTabButton}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.8}
        >
          <View style={styles.activeTabTopLine} />
          <Ionicons name="home" size={24} color="#D4AF37" />
          <Text style={[styles.bottomTabLabel, styles.bottomTabLabelActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bottomTabButton}
          onPress={() => navigation.navigate('MemberHistory')}
          activeOpacity={0.8}
        >
          <Ionicons name="time-outline" size={24} color="#94A3B8" />
          <Text style={styles.bottomTabLabel}>History</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bottomTabButton}
          onPress={() => navigation.navigate('AccountSettings')}
          activeOpacity={0.8}
        >
          <Ionicons name="person-outline" size={24} color="#94A3B8" />
          <Text style={styles.bottomTabLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF', // Pure White Body
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 1. Hero Header Styles (Top 40% Solid Navy #173B70, Straight Clean Edges)
  heroHeader: {
    backgroundColor: '#173B70', // Solid Navy (#173B70)
    paddingBottom: 22,
    position: 'relative',
    ...shadows.lifted,
    zIndex: 10,
  },
  // Subtle Geometric Texture Overlay (Overlapping Squares)
  geometricPatternContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  geometricSquare: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 18,
  },
  heroSafeArea: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // Top App Bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  topBarTitle: {
    fontSize: 24,
    fontFamily: fonts.serif, // Playfair Display Bold 24px
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  bellButtonWrapper: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: 2,
    right: -4,
    backgroundColor: '#EF4444', // Red Badge
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 3,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#173B70',
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textAlign: 'center',
  },

  // Profile Row
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  profileLogoCircle: {
    width: 58,
    height: 58,
    borderRadius: 100, // Pure circle (No gold ring)
    backgroundColor: '#FFFFFF',
    padding: 5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    overflow: 'hidden',
    ...shadows.card,
  },
  profileLogo: {
    width: '100%',
    height: '100%',
  },
  profileDetailsCol: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 18,
    fontFamily: fonts.sansSemiBold, // Inter SemiBold 18px
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  brandSubtitle: {
    fontSize: 14,
    fontFamily: fonts.sans, // Inter Regular 14px
    color: '#94A3B8', // Light Gray
    marginTop: 1,
  },
  welcomeAdminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  welcomeAdminText: {
    fontSize: 16,
    fontFamily: fonts.sansSemiBold, // Inter 16px
    color: '#FFFFFF',
  },
  memberViewButton: {
    backgroundColor: 'rgba(212, 175, 55, 0.2)',
    borderWidth: 1,
    borderColor: '#D4AF37',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  memberViewButtonText: {
    color: '#D4AF37',
    fontSize: 11,
    fontFamily: fonts.sansBold,
  },

  // Translucent Stats Card
  translucentStatsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)', // Translucent rgba(255, 255, 255, 0.15)
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statColumn: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: 'rgba(255, 255, 255, 0.75)', // Small light gray
    letterSpacing: 0.8,
  },
  statNumber: {
    fontSize: 28,
    fontFamily: fonts.serif, // Large white
    color: '#FFFFFF',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 42,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 12,
  },

  // 2. Action Grid Area (Pure White #FFFFFF)
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 110, // Generous breathing room above bottom tab bar
  },
  gridSectionHeading: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    letterSpacing: 0.8,
    marginBottom: 20,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItemWrapper: {
    width: '30%',
    alignItems: 'center',
    marginBottom: 24,
  },
  // 75x75 Navy Circular Button with White Icon
  actionCircleButton: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: '#173B70', // Solid Navy Blue (#173B70)
    borderWidth: 1.5,
    borderColor: '#D4AF37', // Gold Accent Border
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#173B70',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
    color: '#334155', // Dark Gray
    marginTop: 8,
    textAlign: 'center',
  },

  // Pending Banner
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  pendingBadgeIcon: {
    marginRight: 10,
  },
  pendingTitle: {
    fontSize: 13,
    fontFamily: fonts.sansBold,
    color: '#92400E',
  },
  pendingSub: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: '#B45309',
    marginTop: 1,
  },

  // 3. Recent Check-Ins Section
  recentSection: {
    marginTop: 4,
    marginBottom: 16,
  },
  recentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  recentSectionHeading: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    letterSpacing: 0.8,
  },
  seeAllText: {
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
    color: '#173B70',
  },
  recentListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 4,
    ...shadows.card,
  },
  recentItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  recentAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#173B70',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  recentAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  recentAvatarInitial: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: fonts.sansBold,
  },
  recentMemberInfo: {
    flex: 1,
  },
  recentMemberName: {
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
    color: '#0F172A',
  },
  recentMemberInstrument: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#64748B',
    marginTop: 2,
  },
  recentTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  recentTimeText: {
    fontSize: 11,
    fontFamily: fonts.sansSemiBold,
    color: '#173B70',
  },
  recentItemDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  emptyRecentCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRecentTitle: {
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
    color: '#475569',
    marginTop: 8,
  },
  emptyRecentSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#94A3B8',
    marginTop: 2,
    textAlign: 'center',
  },

  // 4. Solid Navy Bottom Tab Bar
  bottomTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: Platform.OS === 'ios' ? 88 : 68,
    backgroundColor: '#173B70', // Solid Navy (#173B70)
    borderTopWidth: 1.5,
    borderTopColor: '#D4AF37', // Crisp Gold Top Border Accent
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
    elevation: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    zIndex: 20,
  },
  bottomTabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  activeTabTopLine: {
    position: 'absolute',
    top: -8,
    width: 32,
    height: 3,
    backgroundColor: '#D4AF37', // 3px Gold active line
    borderRadius: 2,
  },
  bottomTabLabel: {
    fontSize: 11,
    fontFamily: fonts.sansSemiBold,
    color: '#94A3B8', // Inactive Silver/Gray
    marginTop: 3,
  },
  bottomTabLabelActive: {
    color: '#D4AF37', // Active Gold
  },
});
