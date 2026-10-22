import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, fonts, shadows, spacing } from '../theme';
import GeometricHeader from '../components/GeometricHeader';

export default function SubAdminAttendanceScreen({ navigation, route }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [targetActivity, setTargetActivity] = useState(route.params?.activity || null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 1. Initial Load
  useEffect(() => {
    loadData(true);
  }, []);

  // 2. Real-time Subscription for Live Updates on Cleaning Day
  useEffect(() => {
    if (!targetActivity?.id) return;

    const channel = supabase
      .channel(`subadmin-live-attendance-${targetActivity.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance',
          filter: `activity_id=eq.${targetActivity.id}`,
        },
        () => {
          // Instantly refresh list when any check-in occurs
          loadData(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [targetActivity?.id]);

  const loadData = async (showLoader = false) => {
    try {
      if (showLoader) setLoading(true);

      // 1. Verify current auth user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        navigation.replace('Login');
        return;
      }
      setCurrentUser(user);

      // 2. Fetch User Profile
      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      setUserProfile(profile);

      // 3. Determine target activity
      let act = targetActivity;
      if (!act) {
        const { data: acts } = await supabase
          .from('activities')
          .select('*')
          .order('opens_at', { ascending: false })
          .limit(1);

        if (acts && acts.length > 0) {
          act = acts[0];
          setTargetActivity(act);
        }
      }

      if (!act) {
        setAttendanceRecords([]);
        return;
      }

      // 4. Fetch attendance records for this activity
      const { data: records, error } = await supabase
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
        .eq('activity_id', act.id)
        .order('checked_in_at', { ascending: false });

      let rows = records || [];
      if (error || rows.length === 0) {
        const { data: rawAtt } = await supabase
          .from('attendance')
          .select('*')
          .eq('activity_id', act.id)
          .order('checked_in_at', { ascending: false });
        if (rawAtt && rawAtt.length > 0) {
          rows = rawAtt;
        }
      }

      // Fallback for missing member names
      const missingUserIds = rows
        .filter((r) => (!r.user || !r.user.name) && r.member_id)
        .map((r) => r.member_id);

      if (missingUserIds.length > 0) {
        try {
          const { data: usersData } = await supabase
            .from('users')
            .select('id, name, phone, email, instrument')
            .in('id', missingUserIds);

          if (usersData) {
            const usersMap = {};
            usersData.forEach((u) => {
              usersMap[u.id] = u;
            });
            rows = rows.map((r) => {
              if (r.user && r.user.name) return r;
              return {
                ...r,
                user: usersMap[r.member_id] || r.user || null,
              };
            });
          }
        } catch (_uErr) {
          console.warn('SubAdminAttendance fallback error:', _uErr);
        }
      }

      // 5. Generate secure signed URLs for member selfies
      const enriched = await Promise.all(
        rows.map(async (row) => {
          let signedUrl = null;
          if (row.selfie_url) {
            try {
              const { data: signedData } = await supabase.storage
                .from('selfies')
                .createSignedUrl(row.selfie_url, 3600);
              signedUrl = signedData?.signedUrl || null;
            } catch (storageErr) {
              console.warn('Signed selfie url error:', storageErr);
            }
          }
          return {
            ...row,
            signedPhotoUrl: signedUrl,
          };
        })
      );

      setAttendanceRecords(enriched);
    } catch (err) {
      console.error('SubAdminAttendanceScreen loadData error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(false);
  }, [targetActivity?.id]);

  // Format initials fallback
  const getInitials = (name) => {
    if (!name) return 'GM';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Format 12-hour check-in time (e.g. "6:42 AM")
  const formatTime = (isoString) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch (_e) {
      return '—';
    }
  };

  // Real-time filtering by Member Name or Instrument
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return attendanceRecords;
    const query = searchQuery.toLowerCase().trim();
    return attendanceRecords.filter((record) => {
      const memberName = (record.user?.name || '').toLowerCase();
      const instrument = (record.user?.instrument || '').toLowerCase();
      return memberName.includes(query) || instrument.includes(query);
    });
  }, [attendanceRecords, searchQuery]);

  // Render individual member attendance card
  const renderItem = ({ item }) => {
    const memberName =
      item.user?.name ||
      (item.member_id === currentUser?.id ? userProfile?.name || 'You' : 'Church Member');
    const rawInstrument = item.user?.instrument;
    const instrument =
      rawInstrument && rawInstrument !== 'Musician' && rawInstrument !== 'Instrumentalist'
        ? rawInstrument
        : 'Instrumentalist';
    const checkInTime = formatTime(item.checked_in_at);

    return (
      <View style={styles.card}>
        {/* Left: Circular Avatar (Photo or Initials) */}
        <View style={styles.avatarContainer}>
          {item.signedPhotoUrl ? (
            <Image
              source={{ uri: item.signedPhotoUrl }}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.initialsCircle}>
              <Text style={styles.initialsText}>{getInitials(memberName)}</Text>
            </View>
          )}
        </View>

        {/* Middle: Member Name (Navy, Bold) & Instrument (Gray) */}
        <View style={styles.infoCol}>
          <Text style={styles.memberName} numberOfLines={1}>
            {memberName}
          </Text>
          <Text style={styles.memberInstrument} numberOfLines={1}>
            {instrument}
          </Text>
        </View>

        {/* Right: Check-in Time & Green PRESENT Badge */}
        <View style={styles.statusCol}>
          <Text style={styles.timeText}>{checkInTime}</Text>
          <View style={styles.presentBadge}>
            <Text style={styles.presentBadgeText}>PRESENT</Text>
          </View>
        </View>
      </View>
    );
  };

  const activityName = targetActivity?.name || 'Cleaning & Service';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#173B70" />

      {/* 1. The Navy Hero Header */}
      <View style={styles.heroHeader}>
        {/* Reusable FirstBank-Style Geometric Pattern */}
        <GeometricHeader />
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.heroSafeArea}>
          {/* Top Bar: Back Button, Title, Live Indicator */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.titleWrap}>
              <Text style={styles.heroTitle}>Live Attendance</Text>
              <Text style={styles.heroSubtitle} numberOfLines={1}>
                {activityName}
              </Text>
            </View>

            <View style={styles.liveIndicatorBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveIndicatorText}>LIVE</Text>
            </View>
          </View>

          {/* Quick Stat: Large White Number & Label */}
          <View style={styles.quickStatContainer}>
            <Text style={styles.quickStatNumber}>{attendanceRecords.length}</Text>
            <Text style={styles.quickStatLabel}>Total Present Today</Text>
          </View>
        </SafeAreaView>
      </View>

      {/* 2. The Floating Search Bar (overlaps Navy Header) */}
      <View style={styles.searchBarWrapper}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#94A3B8" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search member name..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 3. The Attendance List (Strict Read-Only) */}
      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#173B70" />
          <Text style={styles.loadingText}>Syncing live attendance...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#173B70']}
              tintColor="#173B70"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="time-outline" size={56} color="#94A3B8" />
              <Text style={styles.emptyTitle}>
                {searchQuery ? 'No Results Found' : 'No Check-Ins Yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? `No checked-in member matching "${searchQuery}".`
                  : 'No check-ins yet. The list will update in real-time.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },

  // 1. Navy Hero Header
  heroHeader: {
    backgroundColor: '#173B70',
    paddingBottom: 36, // Space for the floating search bar overlap
    position: 'relative',
    overflow: 'hidden',
  },
  heroSafeArea: {
    paddingHorizontal: 20,
    zIndex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 16,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  titleWrap: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontFamily: fonts.serif,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: '#94A3B8',
    marginTop: 2,
  },
  liveIndicatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  liveIndicatorText: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#34D399',
    letterSpacing: 0.5,
  },

  // Quick Stat
  quickStatContainer: {
    alignItems: 'flex-start',
    marginTop: 6,
    marginBottom: 4,
  },
  quickStatNumber: {
    fontSize: 38,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
    lineHeight: 44,
  },
  quickStatLabel: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: '#94A3B8',
    marginTop: 2,
    letterSpacing: 0.2,
  },

  // 2. Floating Search Bar
  searchBarWrapper: {
    paddingHorizontal: 18,
    marginTop: -22,
    zIndex: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    height: 48,
    ...shadows.card,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    fontFamily: fonts.sans,
    color: '#173B70',
  },

  // 3. Attendance List
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 40,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12, // 12px gap between cards
    ...shadows.card,
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    marginRight: 14,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  initialsCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    backgroundColor: '#EEF4FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    justifyContent: 'center',
    alignItems: 'center',
  },
  initialsText: {
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: '#173B70',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 10,
  },
  memberName: {
    fontSize: 15,
    fontFamily: fonts.sansBold,
    color: '#173B70',
    letterSpacing: -0.2,
  },
  memberInstrument: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: '#64748B',
    marginTop: 3,
  },
  statusCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  timeText: {
    fontSize: 13,
    fontFamily: fonts.sansBold,
    color: '#173B70',
    letterSpacing: -0.2,
  },
  presentBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 5,
  },
  presentBadgeText: {
    fontSize: 10,
    fontFamily: fonts.sansBold,
    color: '#15803D',
    letterSpacing: 0.6,
  },

  // 4. Empty State & Loader
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: '#64748B',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 70,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: fonts.sansBold,
    color: '#173B70',
    marginTop: 14,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 19,
  },
});
