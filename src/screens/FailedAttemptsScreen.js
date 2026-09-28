import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function FailedAttemptsScreen({ route, navigation }) {
  const { activity } = route.params || {};
  const [attemptsList, setAttemptsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    fetchFailedAttempts();
  }, []);

  const fetchFailedAttempts = async () => {
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
        setAttemptsList([]);
        return;
      }

      const { data: attempts, error } = await supabase
        .from('verification_attempts')
        .select('*')
        .eq('activity_id', targetActivityId)
        .order('attempted_at', { ascending: false });

      if (error) throw error;

      if (attempts && attempts.length > 0) {
        const userIds = attempts.filter((a) => a.member_id).map((a) => a.member_id);
        const { data: usersData } = await supabase
          .from('users')
          .select('id, name, phone, instrument')
          .in('id', userIds);

        const userMap = {};
        (usersData || []).forEach((u) => {
          userMap[u.id] = u;
        });

        const enriched = attempts.map((a) => ({
          ...a,
          user: userMap[a.member_id] || { name: 'Unknown / Unregistered' },
        }));

        setAttemptsList(enriched);
      } else {
        setAttemptsList([]);
      }
    } catch (err) {
      console.error('Error fetching failed attempts:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const formatReason = (reason) => {
    switch (reason) {
      case 'outside_geofence':
        return 'Outside Venue Boundaries';
      case 'poor_accuracy':
        return 'Poor GPS Signal';
      case 'outside_time':
        return 'Outside Session Window';
      case 'duplicate_attempt':
        return 'Duplicate Attendance';
      case 'location_permission_denied':
        return 'Location Permission Denied';
      default:
        return (reason || 'Verification Failed').replace(/_/g, ' ');
    }
  };

  const getReasonCounts = () => {
    const counts = {};
    attemptsList.forEach((a) => {
      const r = formatReason(a.reason);
      counts[r] = (counts[r] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([reason, count]) => `${count} ${reason.toLowerCase()}`)
      .join(' • ');
  };

  const renderItem = ({ item }) => {
    const isExpanded = expandedId === item.id;
    const memberName = item.user?.name || 'Unknown Musician';
    const timeFormatted = item.attempted_at
      ? new Date(item.attempted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'N/A';

    return (
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        activeOpacity={0.8}
      >
        <View style={styles.itemHeader}>
          <View style={styles.itemIconWrapper}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.errorText} />
          </View>
          <View style={styles.itemMeta}>
            <Text style={styles.itemName}>{memberName}</Text>
            <Text style={styles.itemReason}>{formatReason(item.reason)}</Text>
          </View>
          <Text style={styles.itemTime}>{timeFormatted}</Text>
        </View>

        {isExpanded && item.metadata && (
          <View style={styles.expandedBox}>
            <Text style={styles.expandedTitle}>Verification Details</Text>
            {item.metadata.distance !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>Distance from venue:</Text>
                <Text style={styles.metaVal}>{item.metadata.distance} meters</Text>
              </View>
            )}
            {item.metadata.accuracy !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>GPS Accuracy:</Text>
                <Text style={styles.metaVal}>±{item.metadata.accuracy}m</Text>
              </View>
            )}
            {item.metadata.userLat !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaKey}>Attempt Coordinates:</Text>
                <Text style={styles.metaVal}>
                  {item.metadata.userLat.toFixed(5)}, {item.metadata.userLng.toFixed(5)}
                </Text>
              </View>
            )}
          </View>
        )}
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

      {/* Top Header */}
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
          <Text style={styles.headerTitle}>Verification Violations</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
      </View>

      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryTitle}>
          {attemptsList.length} Failed Verification Attempt{attemptsList.length === 1 ? '' : 's'}
        </Text>
        <Text style={styles.summaryBreakdown}>
          {attemptsList.length > 0 ? getReasonCounts() : 'No issues recorded for this activity.'}
        </Text>
      </View>

      {/* List */}
      {loading && !refreshing ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={attemptsList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchFailedAttempts();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-done-circle-outline" size={44} color={colors.success} style={{ marginBottom: 10 }} />
              <Text style={styles.emptyTitle}>Zero Violations</Text>
              <Text style={styles.emptySubtitle}>
                All member check-in attempts for this session met geofence and accuracy criteria.
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
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  summaryBreakdown: {
    fontSize: 12,
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 12,
    paddingBottom: 24,
  },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.errorBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemMeta: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  itemReason: {
    fontSize: 12,
    color: colors.errorText,
    fontWeight: '600',
    marginTop: 2,
  },
  itemTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  expandedBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  expandedTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  metaKey: {
    fontSize: 12,
    color: colors.textMuted,
  },
  metaVal: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
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
