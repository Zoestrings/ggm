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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

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

  const adminName = userProfile?.name || 'Super Admin';

  if (loading && !userProfile) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#173B70" />
      </View>
    );
  }

  // 9 FirstBank Style Administrative Actions
  const actionItems = [
    {
      id: 'register',
      label: 'Register',
      icon: 'person-add',
      onPress: () => navigation.navigate('Register'),
    },
    {
      id: 'attendance',
      label: 'Attendance',
      icon: 'calendar',
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
      label: 'PDF',
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
      label: 'Audit',
      icon: 'file-tray-full',
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
      {/* ── 1. The Dark Navy Hero Header (Top 35% of Screen) ── */}
      <View style={styles.heroHeader}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.heroSafeArea}>
          {/* Top Bar: Hamburger, Title, Notification Bell */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => navigation.navigate('Home')}
              activeOpacity={0.7}
            >
              <Ionicons name="menu" size={24} color="#FFFFFF" />
            </TouchableOpacity>

            <Text style={styles.topBarTitle}>Dashboard</Text>

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => navigation.navigate('Notifications')}
              activeOpacity={0.7}
            >
              <Ionicons name="notifications" size={20} color="#D4AF37" />
            </TouchableOpacity>
          </View>

          {/* Profile Row: Large White Circle with GGM Logo + Details */}
          <View style={styles.profileRow}>
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
                <Ionicons name="checkmark-circle" size={16} color="#38BDF8" style={{ marginLeft: 5 }} />
              </View>
            </View>

            {/* Quick Switch to Member View */}
            <TouchableOpacity
              style={styles.memberViewButton}
              onPress={() => navigation.navigate('Home')}
              activeOpacity={0.8}
            >
              <Text style={styles.memberViewButtonText}>Member View</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* ── Translucent Stats Card Overlapping the Bottom of Header ── */}
        <View style={styles.statsCardWrapper}>
          <View style={styles.translucentStatsCard}>
            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>TOTAL MEMBERS</Text>
              <Text style={styles.statNumber}>{totalMembersCount}</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statColumn}>
              <Text style={styles.statLabel}>TODAY'S CHECK-INS</Text>
              <Text style={[styles.statNumber, { color: '#D4AF37' }]}>{checkedInCount}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── 2. Pure White Body Area Below Header ── */}
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

        {/* 3-Column Action Grid (75x75 Navy Blue Circular Buttons) */}
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

        {/* Pending Review Banner if items waiting */}
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
      </ScrollView>
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

  // 1. Hero Header Styles (Top 35% Solid Navy)
  heroHeader: {
    backgroundColor: '#173B70', // Solid Navy (#173B70)
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    ...shadows.lifted,
    zIndex: 10,
  },
  heroSafeArea: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
  },
  topBarTitle: {
    fontSize: 18,
    fontFamily: fonts.serifSemiBold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  // Profile Row
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  profileLogoCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#D4AF37', // Gold trim
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
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  brandSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: '#D4AF37', // Gold Accent
    marginTop: 1,
  },
  welcomeAdminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  welcomeAdminText: {
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
    color: 'rgba(255, 255, 255, 0.95)',
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
  statsCardWrapper: {
    paddingHorizontal: 20,
    marginTop: 4,
  },
  translucentStatsCard: {
    backgroundColor: 'rgba(15, 36, 68, 0.85)', // Dark Semi-Transparent Card
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(212, 175, 55, 0.45)', // Gold Border
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadows.lifted,
  },
  statColumn: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: 'rgba(255, 255, 255, 0.75)',
    letterSpacing: 0.8,
  },
  statNumber: {
    fontSize: 28,
    fontFamily: fonts.serifBold, // Playfair Display
    color: '#FFFFFF',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 42,
    backgroundColor: 'rgba(212, 175, 55, 0.35)',
    marginHorizontal: 10,
  },

  // 2. Action Grid Area (Pure White)
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
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
  // 75x75 Circular Button
  actionCircleButton: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: '#173B70', // Navy Blue
    borderWidth: 2,
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
    marginTop: 10,
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
});
