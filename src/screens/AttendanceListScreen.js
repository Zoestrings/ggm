import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function AttendanceListScreen({ route, navigation }) {
  const { activity } = route.params || {};
  const [attendanceList, setAttendanceList] = useState([]);
  const [filteredList, setFilteredList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAttendance();
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredList(attendanceList);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredList(
        attendanceList.filter((item) => {
          const name = item.user?.name?.toLowerCase() || '';
          const instrument = item.user?.instrument?.toLowerCase() || '';
          return name.includes(q) || instrument.includes(q);
        })
      );
    }
  }, [searchQuery, attendanceList]);

  const fetchAttendance = async () => {
    try {
      setLoading(true);
      let targetActivityId = activity?.id;

      if (!targetActivityId) {
        const { data: latestActs } = await supabase
          .from('activities')
          .select('id, name')
          .order('opens_at', { ascending: false })
          .limit(1);
        if (latestActs && latestActs.length > 0) {
          targetActivityId = latestActs[0].id;
        }
      }

      if (!targetActivityId) {
        setAttendanceList([]);
        setFilteredList([]);
        return;
      }

      const { data: records, error } = await supabase
        .from('attendance')
        .select(`
          id,
          member_id,
          activity_id,
          checked_in_at,
          lat,
          lng,
          accuracy_m,
          selfie_url,
          verification_status,
          user:users!attendance_member_id_fkey (
            id,
            name,
            phone,
            email,
            instrument
          )
        `)
        .eq('activity_id', targetActivityId)
        .order('checked_in_at', { ascending: false });

      if (error) {
        const { data: rawAttendance } = await supabase
          .from('attendance')
          .select('*')
          .eq('activity_id', targetActivityId)
          .order('checked_in_at', { ascending: false });

        if (rawAttendance) {
          const userIds = rawAttendance.map((a) => a.member_id);
          const { data: usersData } = await supabase
            .from('users')
            .select('*')
            .in('id', userIds);

          const usersMap = {};
          (usersData || []).forEach((u) => {
            usersMap[u.id] = u;
          });

          const enriched = rawAttendance.map((a) => ({
            ...a,
            user: usersMap[a.member_id] || { name: 'Unknown Musician', instrument: 'Musician' },
          }));

          setAttendanceList(enriched);
          setFilteredList(enriched);
          return;
        }
      } else {
        setAttendanceList(records || []);
        setFilteredList(records || []);
      }
    } catch (err) {
      console.error('Error fetching attendance:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const renderBadge = (status) => {
    const s = (status || 'verified').toUpperCase();
    if (s === 'VERIFIED') {
      return (
        <View style={styles.badgeVerified}>
          <Text style={styles.badgeTextVerified}>VERIFIED</Text>
        </View>
      );
    }
    if (s === 'MANUAL') {
      return (
        <View style={styles.badgeManual}>
          <Text style={styles.badgeTextManual}>MANUAL</Text>
        </View>
      );
    }
    return (
      <View style={styles.badgePending}>
        <Text style={styles.badgeTextPending}>PENDING</Text>
      </View>
    );
  };

  const renderItem = ({ item }) => {
    const memberName = item.user?.name || 'Instrumentalist';
    const instrument = item.user?.instrument || 'Musician';
    const timeFormatted = item.checked_in_at
      ? new Date(item.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'N/A';

    return (
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => navigation.navigate('AttendanceDetail', { record: item, activity })}
        activeOpacity={0.7}
      >
        <View style={styles.itemAvatar}>
          <Text style={styles.itemAvatarText}>{memberName.charAt(0).toUpperCase()}</Text>
        </View>

        <View style={styles.itemMeta}>
          <Text style={styles.itemName}>{memberName}</Text>
          <Text style={styles.itemInstrument}>{instrument} • {timeFormatted}</Text>
        </View>

        <View style={styles.itemRight}>
          {renderBadge(item.verification_status)}
          <Ionicons name="chevron-forward" size={16} color={colors.textLight} style={{ marginLeft: 6 }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Background Subtle Watermark */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* Clean White Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Attendance Ledger</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
      </View>

      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.activityNameText} numberOfLines={1}>
          {activity?.name || 'Current Session'}
        </Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{filteredList.length} Verified</Text>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by musician name or instrument..."
          placeholderTextColor={colors.textLight}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading && !refreshing ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchAttendance();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={40} color={colors.textLight} style={{ marginBottom: 10 }} />
              <Text style={styles.emptyTitle}>No attendance records</Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery
                  ? 'No musicians match your search query.'
                  : 'No members have checked in for this activity yet.'}
              </Text>
            </View>
          }
        />
      )}
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
    marginRight: 10,
    backgroundColor: '#FFFFFF',
  },
  headerLogo: {
    width: 38,
    height: 38,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activityNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
    marginRight: 10,
  },
  countBadge: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.pagePadding,
    marginTop: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    backgroundColor: '#FFFFFF',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.textPrimary,
  },
  listContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 8,
    paddingBottom: 24,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  itemAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemAvatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  itemMeta: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  itemInstrument: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeVerified: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTextVerified: {
    color: colors.successText,
    fontSize: 10,
    fontWeight: '700',
  },
  badgeManual: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTextManual: {
    color: colors.warningText,
    fontSize: 10,
    fontWeight: '700',
  },
  badgePending: {
    backgroundColor: colors.neutralBg,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTextPending: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 50,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptySubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
  },
});
