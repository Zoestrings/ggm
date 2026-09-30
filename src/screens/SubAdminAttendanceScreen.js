import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function SubAdminAttendanceScreen({ navigation, route }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [targetActivity, setTargetActivity] = useState(route.params?.activity || null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      // 1. Get current auth user & profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      setCurrentUser(user);

      const { data: profile } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();
      setUserProfile(profile);

      // 2. Identify target activity: either passed, currently open, or latest non-finalized / recent within 30 days
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

      // 3. Fetch attendance for this activity (RLS enforces sub_admin reading current/recent activity only)
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
        .order('checked_in_at', { ascending: true });

      if (error) {
        console.warn('SubAdmin attendance fetch error:', error.message);
      }

      const rows = records || [];

      // 4. Generate signed URLs for selfies so photos load securely
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
      console.error('SubAdminAttendanceScreen error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const adminName = userProfile?.name || 'Officer';
  const activityDateFormatted = targetActivity?.activity_date
    ? new Date(targetActivity.activity_date).toLocaleDateString([], {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Today';

  const renderAttendanceRow = ({ item, index }) => {
    const memberName = item.user?.name || 'Musician';
    const instrument = item.user?.instrument || 'Instrumentalist';
    const timeFormatted = item.checked_in_at
      ? new Date(item.checked_in_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

    return (
      <View style={styles.recordCard}>
        <View style={styles.photoContainer}>
          {item.signedPhotoUrl ? (
            <Image source={{ uri: item.signedPhotoUrl }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Ionicons name="person" size={20} color={colors.textLight} />
            </View>
          )}
        </View>

        <View style={styles.infoCol}>
          <Text style={styles.memberName} numberOfLines={1}>
            {memberName}
          </Text>
          <Text style={styles.memberInstrument} numberOfLines={1}>
            {instrument}
          </Text>
        </View>

        <View style={styles.timeBadge}>
          <Ionicons name="time-outline" size={13} color={colors.textMuted} style={{ marginRight: 4 }} />
          <Text style={styles.timeText}>{timeFormatted}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Background Watermark */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Attendance List</Text>
          <Text style={styles.headerSubtitle}>Sub-Admin View Only</Text>
        </View>
        <View style={styles.subAdminBadge}>
          <Text style={styles.subAdminBadgeText}>VIEW ONLY</Text>
        </View>
      </View>

      {/* Activity Context Banner */}
      <View style={styles.banner}>
        <Text style={styles.welcomeText}>Welcome, {adminName}</Text>
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={15} color={colors.primary} style={{ marginRight: 6 }} />
          <Text style={styles.dateText}>
            {targetActivity?.name || 'Departmental Session'} • {activityDateFormatted}
          </Text>
        </View>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading today's attendance...</Text>
        </View>
      ) : (
        <FlatList
          data={attendanceRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderAttendanceRow}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeaderRow}>
              <Text style={styles.sectionLabel}>PEOPLE WHO CAME TODAY</Text>
              <Text style={styles.countBadge}>{attendanceRecords.length}</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons
                name={!targetActivity ? "calendar-outline" : "people-outline"}
                size={48}
                color={colors.borderDark}
              />
              <Text style={styles.emptyTitle}>
                {!targetActivity ? "No Active Session" : "No Check-Ins Yet"}
              </Text>
              <Text style={styles.emptySubtitle}>
                {!targetActivity
                  ? "There is no scheduled session open right now, nor recent activity within the last 30 days."
                  : "Members will appear here with photos as they check in at church."}
              </Text>
            </View>
          }
          ListFooterComponent={
            attendanceRecords.length > 0 ? (
              <View style={styles.footerNoteBox}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} style={{ marginRight: 6 }} />
                <Text style={styles.footerNoteText}>
                  This list is read-only for yearly compilation and verification.
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* Bottom Summary Bar */}
      <View style={styles.bottomBar}>
        <Text style={styles.bottomBarLabel}>Total Attended Today:</Text>
        <Text style={styles.bottomBarCount}>{attendanceRecords.length}</Text>
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: colors.textMuted,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  subAdminBadge: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  subAdminBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  banner: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  welcomeText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  dateText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 16,
    paddingBottom: 24,
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  countBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  recordCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  photoContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 12,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoCol: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  memberInstrument: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  timeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 30,
    lineHeight: 18,
  },
  footerNoteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  footerNoteText: {
    fontSize: 11,
    color: colors.textMuted,
    flex: 1,
    lineHeight: 16,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomBarLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  bottomBarCount: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
});
