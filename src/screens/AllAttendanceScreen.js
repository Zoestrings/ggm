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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

const INSTRUMENT_FILTERS = ['All', 'Piano / Keyboard', 'Bass Guitar', 'Lead Guitar', 'Drums', 'Saxophone', 'Trumpet', 'Vocals'];

export default function AllAttendanceScreen({ navigation }) {
  const [activities, setActivities] = useState([]);
  const [selectedActivityId, setSelectedActivityId] = useState('all');
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [selectedInstrument, setSelectedInstrument] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadActivitiesAndAttendance();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [searchQuery, selectedInstrument, selectedActivityId, attendanceRecords]);

  const loadActivitiesAndAttendance = async () => {
    try {
      setLoading(true);

      // 1. Fetch all past and active activities
      const { data: actList } = await supabase
        .from('activities')
        .select('id, name, activity_date, finalized_at')
        .order('activity_date', { ascending: false });

      setActivities(actList || []);

      // 2. Fetch all attendance records with user and activity joins
      const { data: records, error } = await supabase
        .from('attendance')
        .select(`
          id,
          member_id,
          activity_id,
          checked_in_at,
          verification_status,
          check_in_method,
          selfie_url,
          user:users!attendance_member_id_fkey (
            id,
            name,
            phone,
            instrument,
            avatar_url
          ),
          activity:activities!attendance_activity_id_fkey (
            id,
            name,
            activity_date
          )
        `)
        .order('checked_in_at', { ascending: false })
        .limit(300);

      if (error) {
        console.warn('Error fetching all attendance:', error.message);
      }

      setAttendanceRecords(records || []);
    } catch (err) {
      console.error('AllAttendanceScreen load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadActivitiesAndAttendance();
  };

  const applyFilters = () => {
    let result = [...attendanceRecords];

    // Filter by activity
    if (selectedActivityId !== 'all') {
      result = result.filter((r) => r.activity_id === selectedActivityId);
    }

    // Filter by instrument
    if (selectedInstrument !== 'All') {
      result = result.filter((r) => {
        const inst = r.user?.instrument || '';
        return inst.toLowerCase() === selectedInstrument.toLowerCase();
      });
    }

    // Filter by search query (name or phone)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((r) => {
        const name = r.user?.name?.toLowerCase() || '';
        const phone = r.user?.phone || '';
        const actName = r.activity?.name?.toLowerCase() || '';
        return name.includes(q) || phone.includes(q) || actName.includes(q);
      });
    }

    setFilteredRecords(result);
  };

  const renderAttendanceItem = ({ item }) => {
    const memberName = item.user?.name || 'Musician';
    const instrument = item.user?.instrument || 'Instrumentalist';
    const activityName = item.activity?.name || 'Session';
    const timeFormatted = item.checked_in_at
      ? new Date(item.checked_in_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';
    const dateFormatted = item.checked_in_at
      ? new Date(item.checked_in_at).toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : '—';

    const isOffline = item.check_in_method === 'offline_sync';

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatarWrap}>
            <Ionicons name="person" size={16} color={colors.primary} />
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{memberName}</Text>
            <Text style={styles.memberInstrument}>{instrument}</Text>
          </View>
          <View style={[styles.methodBadge, isOffline ? styles.methodBadgeOffline : styles.methodBadgeLive]}>
            <Text style={[styles.methodBadgeText, isOffline ? styles.methodTextOffline : styles.methodTextLive]}>
              {isOffline ? 'OFFLINE SYNC' : 'LIVE'}
            </Text>
          </View>
        </View>

        <View style={styles.cardDivider} />

        <View style={styles.cardMetaRow}>
          <View style={styles.metaLeft}>
            <Ionicons name="calendar-outline" size={13} color={colors.textMuted} style={{ marginRight: 4 }} />
            <Text style={styles.metaActivityText} numberOfLines={1}>{activityName}</Text>
          </View>
          <Text style={styles.metaTimeText}>{dateFormatted} • {timeFormatted}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>All Attendance Records</Text>
          <Text style={styles.headerSubtitle}>Super Admin Portal</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshHeaderBtn}
          onPress={loadActivitiesAndAttendance}
          activeOpacity={0.7}
        >
          <Ionicons name="reload-outline" size={19} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search member, phone, or activity..."
            placeholderTextColor={colors.textLight}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Instrument Filter Chips */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {INSTRUMENT_FILTERS.map((inst) => {
            const isSelected = selectedInstrument === inst;
            return (
              <TouchableOpacity
                key={inst}
                style={[styles.filterChip, isSelected && styles.filterChipActive]}
                onPress={() => setSelectedInstrument(inst)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                  {inst}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Activity Filter Dropdown / Horizontal Selector */}
      {activities.length > 0 && (
        <View style={styles.activityFilterBar}>
          <Text style={styles.activityFilterLabel}>SESSION:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityScroll}>
            <TouchableOpacity
              style={[styles.activityPill, selectedActivityId === 'all' && styles.activityPillActive]}
              onPress={() => setSelectedActivityId('all')}
              activeOpacity={0.7}
            >
              <Text style={[styles.activityPillText, selectedActivityId === 'all' && styles.activityPillTextActive]}>
                All Sessions
              </Text>
            </TouchableOpacity>
            {activities.map((act) => {
              const isSelected = selectedActivityId === act.id;
              const dateStr = act.activity_date
                ? new Date(act.activity_date).toLocaleDateString([], { month: 'short', day: 'numeric' })
                : '';
              return (
                <TouchableOpacity
                  key={act.id}
                  style={[styles.activityPill, isSelected && styles.activityPillActive]}
                  onPress={() => setSelectedActivityId(act.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.activityPillText, isSelected && styles.activityPillTextActive]}>
                    {dateStr ? `${dateStr} - ` : ''}{act.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Main List */}
      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Fetching attendance records...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => item.id}
          renderItem={renderAttendanceItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeaderRow}>
              <Text style={styles.resultsCount}>
                Showing <Text style={{ fontWeight: '700', color: colors.primary }}>{filteredRecords.length}</Text> record{filteredRecords.length !== 1 ? 's' : ''}
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="calendar-outline" size={48} color={colors.border} />
              <Text style={styles.emptyTitle}>No Records Found</Text>
              <Text style={styles.emptySubtitle}>
                No attendance entries match your search criteria.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  watermark: {
    position: 'absolute',
    width: 320,
    height: 320,
    alignSelf: 'center',
    top: '30%',
    opacity: 0.04,
    zIndex: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    zIndex: 10,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  refreshHeaderBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, letterSpacing: -0.2 },
  headerSubtitle: { fontSize: 11, color: colors.textMuted, fontWeight: '500', marginTop: 1 },

  // Search
  searchSection: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 12,
    paddingBottom: 6,
    backgroundColor: '#FFFFFF',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },

  // Filter Bar
  filterBar: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  filterScroll: {
    paddingHorizontal: spacing.pagePadding,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Activity Filter Bar
  activityFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 8,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activityFilterLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    marginRight: 8,
    letterSpacing: 0.5,
  },
  activityScroll: {
    paddingRight: 20,
  },
  activityPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 6,
  },
  activityPillActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  activityPillText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  activityPillTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  // List
  listContent: {
    padding: spacing.pagePadding,
    paddingBottom: 40,
  },
  listHeaderRow: {
    marginBottom: 10,
  },
  resultsCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 13, color: colors.textMuted },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  memberInfo: {
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
    marginTop: 1,
  },
  methodBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },
  methodBadgeLive: {
    backgroundColor: '#DCFCE7',
  },
  methodBadgeOffline: {
    backgroundColor: '#FEF3C7',
  },
  methodBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  methodTextLive: {
    color: '#15803D',
  },
  methodTextOffline: {
    color: '#B45309',
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 10,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  metaActivityText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  metaTimeText: {
    fontSize: 11,
    color: colors.textMuted,
  },

  // Empty
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
  },
});
