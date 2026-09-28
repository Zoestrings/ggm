import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function MemberHistoryScreen({ navigation }) {
  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Selected Detail Modal
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [signedImageUrl, setSignedImageUrl] = useState(null);
  const [loadingImage, setLoadingImage] = useState(false);

  useEffect(() => {
    loadMemberHistory();
  }, []);

  const loadMemberHistory = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('attendance')
        .select(`
          id,
          checked_in_at,
          lat,
          lng,
          accuracy_m,
          selfie_url,
          verification_status,
          activity:activities!attendance_activity_id_fkey (
            id,
            name,
            activity_date,
            location_name
          )
        `)
        .eq('member_id', user.id)
        .order('checked_in_at', { ascending: false });

      if (error) {
        const { data: rawAtt } = await supabase
          .from('attendance')
          .select('*')
          .eq('member_id', user.id)
          .order('checked_in_at', { ascending: false });

        if (rawAtt) {
          const actIds = rawAtt.map((a) => a.activity_id);
          const { data: acts } = await supabase.from('activities').select('*').in('id', actIds);
          const actMap = {};
          (acts || []).forEach((a) => { actMap[a.id] = a; });
          const enriched = rawAtt.map((a) => ({ ...a, activity: actMap[a.activity_id] || {} }));
          setHistoryList(enriched);
          return;
        }
      }

      setHistoryList(data || []);
    } catch (err) {
      console.error('Error loading member history:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleOpenDetail = async (record) => {
    setSelectedRecord(record);
    setSignedImageUrl(null);
    setLoadingImage(true);

    if (record.selfie_url) {
      try {
        const { data, error } = await supabase.storage
          .from('selfies')
          .createSignedUrl(record.selfie_url, 3600);

        if (!error && data?.signedUrl) {
          setSignedImageUrl(data.signedUrl);
        }
      } catch (err) {
        console.warn('Error fetching signed selfie:', err);
      }
    }
    setLoadingImage(false);
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
    if (s === 'ADMIN_APPROVED') {
      return (
        <View style={styles.badgeApproved}>
          <Text style={styles.badgeTextApproved}>APPROVED</Text>
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
    const actName = item.activity?.name || 'Musician Session';
    const dateFormatted = item.checked_in_at
      ? new Date(item.checked_in_at).toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : 'N/A';
    const timeFormatted = item.checked_in_at
      ? new Date(item.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'N/A';

    return (
      <TouchableOpacity
        style={styles.itemCard}
        onPress={() => handleOpenDetail(item)}
        activeOpacity={0.7}
      >
        <View style={styles.itemCalendarIcon}>
          <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        </View>

        <View style={styles.itemMeta}>
          <Text style={styles.itemDate}>{dateFormatted}</Text>
          <Text style={styles.itemActivityName} numberOfLines={1}>{actName}</Text>
          <Text style={styles.itemTime}>Verified at {timeFormatted}</Text>
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
          <Text style={styles.headerTitle}>Attendance History</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
      </View>

      {/* Summary Count Bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>Total Department Verified Sessions</Text>
        <Text style={styles.summaryCount}>{historyList.length}</Text>
      </View>

      {/* List */}
      {loading && !refreshing ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={historyList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadMemberHistory();
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="document-text-outline" size={44} color={colors.textLight} style={{ marginBottom: 10 }} />
              <Text style={styles.emptyTitle}>No Attendance Records Yet</Text>
              <Text style={styles.emptySubtitle}>
                Your verified check-ins at instrument cleaning sessions will appear here.
              </Text>
            </View>
          }
        />
      )}

      {/* Detail Modal */}
      <Modal visible={!!selectedRecord} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalTopRow}>
                <Text style={styles.modalHeaderTitle}>Session Verification</Text>
                <TouchableOpacity onPress={() => setSelectedRecord(null)} activeOpacity={0.7}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Selfie Image */}
              <View style={styles.modalImageWrapper}>
                {loadingImage ? (
                  <ActivityIndicator size="large" color={colors.primary} />
                ) : signedImageUrl ? (
                  <Image source={{ uri: signedImageUrl }} style={styles.modalSelfie} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Ionicons name="camera-outline" size={32} color={colors.textLight} />
                    <Text style={styles.noPhotoText}>Photo verification on file</Text>
                  </View>
                )}
              </View>

              {/* Details */}
              <View style={styles.modalInfoBox}>
                <Text style={styles.modalActName}>
                  {selectedRecord?.activity?.name || 'Department Activity'}
                </Text>
                
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Check-In Time</Text>
                  <Text style={styles.modalVal}>
                    {selectedRecord?.checked_in_at
                      ? new Date(selectedRecord.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : 'N/A'}
                  </Text>
                </View>

                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Date</Text>
                  <Text style={styles.modalVal}>
                    {selectedRecord?.checked_in_at
                      ? new Date(selectedRecord.checked_in_at).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'N/A'}
                  </Text>
                </View>

                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Status</Text>
                  <Text style={styles.modalValHighlight}>
                    {(selectedRecord?.verification_status || 'VERIFIED').toUpperCase()}
                  </Text>
                </View>

                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>GPS Accuracy</Text>
                  <Text style={styles.modalValMono}>
                    {selectedRecord?.accuracy_m ? `±${Math.round(selectedRecord.accuracy_m)}m` : 'N/A'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.doneButton}
                onPress={() => setSelectedRecord(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.doneButtonText}>Close</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  summaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  summaryCount: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primary,
  },
  listContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 12,
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
  itemCalendarIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemMeta: {
    flex: 1,
  },
  itemDate: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  itemActivityName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 1,
  },
  itemTime: {
    fontSize: 12,
    color: colors.textSecondary,
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
  badgeApproved: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTextApproved: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  badgePending: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTextPending: {
    color: colors.warningText,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: spacing.pagePadding,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    maxHeight: '90%',
  },
  modalTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalImageWrapper: {
    height: 220,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalSelfie: {
    width: '100%',
    height: '100%',
  },
  noPhotoText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
  modalInfoBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  modalActName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 6,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  modalLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  modalVal: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalValHighlight: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.successText,
  },
  modalValMono: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: colors.textSecondary,
  },
  doneButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
