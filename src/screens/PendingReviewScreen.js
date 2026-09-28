import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { colors, spacing } from '../theme';

export default function PendingReviewScreen({ navigation }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [pendingList, setPendingList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [signedUrls, setSignedUrls] = useState({});

  useEffect(() => {
    loadPendingCheckins();
  }, []);

  const loadPendingCheckins = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);

      const { data, error } = await supabase
        .from('pending_checkins')
        .select('*')
        .eq('status', 'pending')
        .order('captured_at', { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        const memberIds = data.filter((d) => d.member_id).map((d) => d.member_id);
        const { data: usersData } = await supabase
          .from('users')
          .select('id, name, phone, instrument')
          .in('id', memberIds);

        const userMap = {};
        (usersData || []).forEach((u) => { userMap[u.id] = u; });

        const enriched = data.map((d) => ({
          ...d,
          user: userMap[d.member_id] || { name: 'Unknown Musician' },
        }));

        setPendingList(enriched);

        const urls = {};
        for (const item of enriched) {
          if (item.selfie_storage_path) {
            try {
              const { data: urlData } = await supabase.storage
                .from('selfies')
                .createSignedUrl(item.selfie_storage_path, 3600);
              if (urlData?.signedUrl) {
                urls[item.id] = urlData.signedUrl;
              }
            } catch (e) { /* skip */ }
          }
        }
        setSignedUrls(urls);
      } else {
        setPendingList([]);
      }
    } catch (err) {
      console.error('Error loading pending checkins:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleApprove = async (item) => {
    Alert.alert(
      'Approve Offline Check-In',
      `Approve attendance for ${item.user?.name || 'this musician'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            try {
              const { error: attError } = await supabase.from('attendance').insert({
                member_id: item.member_id,
                activity_id: item.activity_id,
                checked_in_at: item.captured_at,
                lat: item.lat,
                lng: item.lng,
                accuracy_m: item.accuracy_m,
                selfie_url: item.selfie_storage_path || null,
                verification_status: 'admin_approved',
              });

              if (attError && attError.code !== '23505') throw attError;

              await supabase
                .from('pending_checkins')
                .update({
                  status: 'approved',
                  approved_by: currentUser?.id,
                  approved_at: new Date().toISOString(),
                })
                .eq('id', item.id);

              await logAudit({
                actorId: currentUser?.id,
                action: 'approve_pending_checkin',
                entity: 'pending_checkins',
                entityId: item.id,
                newValue: { member_name: item.user?.name, status: 'approved' },
                reason: 'Admin approved offline check-in submission',
              });

              Alert.alert('Approved', `Attendance recorded for ${item.user?.name}.`);
              loadPendingCheckins();
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  const handleReject = async (item) => {
    Alert.alert(
      'Reject Submission',
      `Are you sure you want to reject this offline check-in from ${item.user?.name || 'this musician'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase
                .from('pending_checkins')
                .update({
                  status: 'rejected',
                  approved_by: currentUser?.id,
                  approved_at: new Date().toISOString(),
                })
                .eq('id', item.id);

              await logAudit({
                actorId: currentUser?.id,
                action: 'reject_pending_checkin',
                entity: 'pending_checkins',
                entityId: item.id,
                newValue: { member_name: item.user?.name, status: 'rejected' },
                reason: 'Admin rejected offline check-in submission',
              });

              Alert.alert('Submission Rejected', 'The offline record has been flagged as rejected.');
              loadPendingCheckins();
            } catch (err) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }) => {
    const memberName = item.user?.name || 'Musician';
    const instrument = item.user?.instrument || 'Instrumentalist';
    const selfieUrl = signedUrls[item.id];
    const capturedDate = item.captured_at
      ? new Date(item.captured_at).toLocaleDateString([], { month: 'short', day: 'numeric' })
      : 'N/A';
    const capturedTime = item.captured_at
      ? new Date(item.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'N/A';

    return (
      <View style={styles.itemCard}>
        {/* Header Row */}
        <View style={styles.itemHeaderRow}>
          <View style={styles.itemAvatarWrapper}>
            {selfieUrl ? (
              <Image source={{ uri: selfieUrl }} style={styles.selfieThumb} resizeMode="cover" />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarLetter}>{memberName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>

          <View style={styles.itemMeta}>
            <Text style={styles.itemName}>{memberName}</Text>
            <Text style={styles.itemInstrument}>{instrument}</Text>
            <Text style={styles.itemTimestamp}>{capturedDate} at {capturedTime}</Text>
          </View>

          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>OFFLINE</Text>
          </View>
        </View>

        {/* Location & Failure Details */}
        <View style={styles.detailsBox}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Location:</Text>
            <Text style={styles.detailVal}>
              {item.lat ? `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}` : 'Not captured'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Accuracy:</Text>
            <Text style={styles.detailVal}>
              {item.accuracy_m ? `±${Math.round(item.accuracy_m)}m` : 'N/A'}
            </Text>
          </View>
          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Offline Reason:</Text>
            <Text style={styles.detailValReason}>
              {(item.failure_reason || 'network_error').replace(/_/g, ' ')}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.rejectButton}
            onPress={() => handleReject(item)}
            activeOpacity={0.8}
          >
            <Text style={styles.rejectButtonText}>Reject</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.approveButton}
            onPress={() => handleApprove(item)}
            activeOpacity={0.85}
          >
            <Text style={styles.approveButtonText}>Approve Attendance</Text>
          </TouchableOpacity>
        </View>
      </View>
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
          <Text style={styles.headerTitle}>Pending Reviews</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
      </View>

      {/* Summary */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {pendingList.length} offline check-in{pendingList.length !== 1 ? 's' : ''} awaiting review
        </Text>
      </View>

      {/* List */}
      {loading && !refreshing ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={pendingList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadPendingCheckins();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="checkmark-done-circle-outline" size={44} color={colors.success} style={{ marginBottom: 10 }} />
              <Text style={styles.emptyTitle}>Queue Clean</Text>
              <Text style={styles.emptySubtitle}>
                There are no pending offline check-in submissions requiring review.
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
  summaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
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
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemAvatarWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    marginRight: 12,
  },
  selfieThumb: {
    width: 44,
    height: 44,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: {
    color: '#FFFFFF',
    fontSize: 18,
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
    fontWeight: '600',
    color: colors.primary,
    marginTop: 1,
  },
  itemTimestamp: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  offlineBadge: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  offlineBadgeText: {
    color: colors.warningText,
    fontSize: 10,
    fontWeight: '700',
  },
  detailsBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  detailLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  detailVal: {
    fontSize: 12,
    color: colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  detailValReason: {
    fontSize: 12,
    color: colors.warningText,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rejectButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rejectButtonText: {
    color: colors.errorText,
    fontSize: 13,
    fontWeight: '700',
  },
  approveButton: {
    flex: 1.5,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approveButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
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
