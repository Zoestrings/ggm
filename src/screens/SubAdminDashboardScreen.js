import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { fonts, shadows } from '../theme';
import GeometricHeader from '../components/GeometricHeader';

export default function SubAdminDashboardScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adminName, setAdminName] = useState('Sub-Admin');
  const [totalMembersCount, setTotalMembersCount] = useState(0);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [activeActivity, setActiveActivity] = useState(null);

  const fetchDashboardData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }

      const { data: profile } = await supabase
        .from('users')
        .select('name, role')
        .eq('id', user.id)
        .single();

      if (profile?.name) setAdminName(profile.name);

      const { count: memberCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      setTotalMembersCount(memberCount || 0);

      const { data: acts } = await supabase
        .from('activities')
        .select('*')
        .order('opens_at', { ascending: false })
        .limit(1);

      if (acts && acts.length > 0) {
        setActiveActivity(acts[0]);
        const { count: todayCount } = await supabase
          .from('attendance')
          .select('*', { count: 'exact', head: true })
          .eq('activity_id', acts[0].id);
        setCheckedInCount(todayCount || 0);
      }
    } catch (err) {
      console.error('Error in SubAdminDashboard data fetch:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchDashboardData();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  const handleDownloadPDF = async () => {
    try {
      if (!activeActivity) {
        Alert.alert('Notice', 'No active service/activity found for report.');
        return;
      }
      const { data: records } = await supabase
        .from('attendance')
        .select('checked_in_at, user:users ( name, instrument )')
        .eq('activity_id', activeActivity.id)
        .order('checked_in_at', { ascending: true });

      const rows = (records || [])
        .map(
          (r, i) => `<tr>
            <td>${i + 1}</td>
            <td>${r.user?.name || 'Member'}</td>
            <td>${r.user?.instrument || 'Instrumentalist'}</td>
            <td>${new Date(r.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          </tr>`
        )
        .join('');

      const html = `
        <html>
          <body style="font-family: sans-serif; padding: 20px;">
            <h1 style="color: #403F91;">GGM Instrumentalists Attendance Report</h1>
            <h3>${activeActivity.name || 'Cleaning & Service'} • ${new Date().toLocaleDateString()}</h3>
            <p>Total Check-ins: ${(records || []).length}</p>
            <table border="1" cellpadding="8" cellspacing="0" style="width: 100%; border-collapse: collapse;">
              <tr style="background-color: #403F91; color: white;">
                <th>#</th><th>Name</th><th>Instrument</th><th>Check-in Time</th>
              </tr>
              ${rows}
            </table>
          </body>
        </html>
      `;
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri);
    } catch (err) {
      Alert.alert('PDF Error', err.message || 'Could not generate report.');
    }
  };

  // ── Exactly 7 Allowed Sub-Admin Actions (Strictly excludes 'Admins' and 'Audit Logs') ──
  const actionItems = [
    {
      id: 'register',
      label: 'Register',
      icon: 'camera',
      onPress: () => navigation.navigate('CheckIn'),
    },
    {
      id: 'live_list',
      label: 'Live List',
      icon: 'list',
      onPress: () => navigation.navigate('SubAdminAttendance', { activity: activeActivity }),
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
      id: 'announce',
      label: 'Announcements',
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

  if (loading && !refreshing) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#403F91" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* ── 1. Royal Indigo Hero Header ── */}
      <View style={styles.heroHeader}>
        <GeometricHeader />

        <SafeAreaView edges={['top', 'left', 'right']} style={styles.heroSafeArea}>
          {/* Top Bar: Clean right-aligned Notification Bell */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.bellButtonWrapper}
              onPress={() => navigation.navigate('Notifications')}
              activeOpacity={0.7}
            >
              <Ionicons name="notifications" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Profile Row: Logo + Official Branding */}
          <View style={styles.profileRow}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.profileLogoDirect}
              resizeMode="contain"
            />

            <View style={styles.profileDetailsCol}>
              <Text style={styles.brandTitle}>GGM INSTRUMENTALIST</Text>
              <Text style={styles.brandSubtitle}>GOD'S GRACE MINISTRY INC.</Text>
              <View style={styles.welcomeAdminRow}>
                <Text style={styles.welcomeAdminText} numberOfLines={1}>
                  Welcome, {adminName}
                </Text>
                <Ionicons name="checkmark-circle" size={17} color="#38BDF8" style={{ marginLeft: 6 }} />
              </View>
            </View>
          </View>

          {/* Glassmorphic Stats Card */}
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

      {/* ── 2. White Section: 3-Column Action Grid ── */}
      <ScrollView
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#403F91']} tintColor="#403F91" />
        }
      >
        <Text style={styles.gridSectionHeading}>SUB-ADMINISTRATIVE ACTIONS</Text>

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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroHeader: {
    backgroundColor: '#403F91',
    paddingBottom: 22,
    position: 'relative',
    overflow: 'hidden',
    ...shadows.lifted,
    zIndex: 1,
  },
  heroSafeArea: {
    paddingHorizontal: 20,
    paddingTop: 8,
    position: 'relative',
    zIndex: 2,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: 14,
  },
  iconButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  topBarTitle: {
    fontSize: 24,
    fontFamily: fonts.serif,
    color: '#FFFFFF',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bellButtonWrapper: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberViewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    marginRight: 10,
  },
  memberViewButtonText: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  profileLogoDirect: {
    width: 60,
    height: 60,
    marginRight: 14,
  },
  profileDetailsCol: {
    flex: 1,
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 14,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 4,
  },
  welcomeAdminRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  welcomeAdminText: {
    fontSize: 15,
    fontFamily: fonts.serifSemiBold,
    color: '#FFFFFF',
  },
  memberViewButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  memberViewButtonText: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
  },
  translucentStatsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  statColumn: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  statNumber: {
    fontSize: 26,
    fontFamily: fonts.serif,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    marginVertical: 4,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },
  gridSectionHeading: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    letterSpacing: 1.2,
    marginBottom: 20,
    textAlign: 'center',
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridItemWrapper: {
    width: '30%',
    alignItems: 'center',
    marginBottom: 26,
  },
  actionCircleButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#403F91', // Royal Indigo Blue (#403F91)
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#403F91',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
    color: '#403F91',
    textAlign: 'center',
  },
});
