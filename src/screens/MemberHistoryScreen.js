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
import { colors, fonts, shadows } from '../theme';

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

  const safeGoBack = () => {
    if (navigation.canGoBack && navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('HomeTab');
    }
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
          onPress={safeGoBack}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color="#173B70" />
        </TouchableOpacity>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.headerLogo}
          resizeMode="contain"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Attendance History</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists Ministry</Text>
        </View>
      </View>

      {/* Summary Count Bar */}
      <View style={styles.summaryBar}>
        <View>
          <Text style={styles.summaryLabel}>RECORDED ATTENDANCE</Text>
          <Text style={styles.summarySub}>Total Verified Ministry Sessions</Text>
        </View>
        <View style={styles.summaryCountBadge}>
          <Text style={styles.summaryCountText}>{historyList.length}</Text>
        </View>
      </View>

      {/* History Table Container */}
      <View style={styles.tableCard}>
        {/* Table Column Headers */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Activity</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.3 }]}>Date</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.2 }]}>Check-in</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1, textAlign: 'right' }]}>Status</Text>
        </View>

        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#173B70" />
            <Text style={styles.loadingText}>Loading attendance records...</Text>
          </View>
        ) : (
          <FlatList
            data={historyList}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  loadMemberHistory();
                }}
                tintColor="#173B70"
              />
            }
            renderItem={({ item, index }) => {
              const checkInDate = item.checked_in_at ? new Date(item.checked_in_at) : null;
              const actName = item.activity?.name || 'Musician Session';
              const dateStr = checkInDate
                ? checkInDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
                : 'N/A';
              const timeStr = checkInDate
                ? checkInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'N/A';

              const isLast = index === historyList.length - 1;

              return (
                <TouchableOpacity
                  style={[styles.tableRow, isLast && { borderBottomWidth: 0 }]}
                  onPress={() => handleOpenDetail(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tableCellName, { flex: 2 }]} numberOfLines={1}>
                    {actName}
                  </Text>
                  <Text style={[styles.tableCell, { flex: 1.3 }]}>{dateStr}</Text>
                  <Text style={[styles.tableCell, { flex: 1.2 }]}>{timeStr}</Text>
                  <View style={[styles.statusWrapper, { flex: 1 }]}>
                    <Text style={styles.tableCellStatus}>Present</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={44} color="#94A3B8" style={{ marginBottom: 10 }} />
                <Text style={styles.emptyTitle}>No Attendance Records Yet</Text>
                <Text style={styles.emptySubtitle}>
                  Your verified check-ins will appear here as soon as you record attendance.
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* Detail Modal */}
      <Modal visible={!!selectedRecord} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalTopRow}>
                <Text style={styles.modalHeaderTitle}>Session Verification</Text>
                <TouchableOpacity onPress={() => setSelectedRecord(null)} activeOpacity={0.7}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              {/* Selfie Image */}
              <View style={styles.modalImageWrapper}>
                {loadingImage ? (
                  <ActivityIndicator size="small" color="#173B70" />
                ) : signedImageUrl ? (
                  <Image source={{ uri: signedImageUrl }} style={styles.modalSelfie} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Ionicons name="camera-outline" size={32} color="#94A3B8" />
                    <Text style={styles.noPhotoText}>No verification photo</Text>
                  </View>
                )}
              </View>

              <View style={styles.modalInfoBox}>
                <Text style={styles.modalActName}>
                  {selectedRecord?.activity?.name || 'Musician Session'}
                </Text>

                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Checked In</Text>
                  <Text style={styles.modalVal}>
                    {selectedRecord?.checked_in_at
                      ? new Date(selectedRecord.checked_in_at).toLocaleString([], {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'N/A'}
                  </Text>
                </View>

                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Status</Text>
                  <Text style={styles.modalValHighlight}>Verified (Present)</Text>
                </View>

                {selectedRecord?.accuracy_m && (
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>GPS Accuracy</Text>
                    <Text style={styles.modalVal}>±{Math.round(selectedRecord.accuracy_m)}m</Text>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={styles.doneButton}
                onPress={() => setSelectedRecord(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.doneButtonText}>Done</Text>
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
    backgroundColor: '#FFFFFF', // Strict Pure White
  },
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
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerLogo: {
    width: 38,
    height: 38,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: fonts.serifSemiBold,
    color: '#173B70',
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: '#D4AF37', // Gold Accent
    marginTop: 1,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 14,
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  summaryLabel: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#173B70',
    letterSpacing: 0.8,
  },
  summarySub: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#64748B',
    marginTop: 2,
  },
  summaryCountBadge: {
    backgroundColor: '#173B70',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D4AF37',
  },
  summaryCountText: {
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: '#FFFFFF',
  },

  // Table Card Styles
  tableCard: {
    flex: 1,
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    ...shadows.card,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: '#E2E8F0',
    marginBottom: 4,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontFamily: fonts.sansBold,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  tableCellName: {
    fontSize: 13,
    fontFamily: fonts.sansSemiBold,
    color: '#0F172A',
  },
  tableCell: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#475569',
  },
  statusWrapper: {
    alignItems: 'flex-end',
  },
  tableCellStatus: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#10B981', // Clean Emerald Present
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    fontFamily: fonts.sans,
    color: '#64748B',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 15,
    fontFamily: fonts.sansBold,
    color: '#173B70',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 260,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: '#D4AF37', // Gold border on modal
    ...shadows.lifted,
  },
  modalTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontFamily: fonts.serifSemiBold,
    color: '#173B70',
  },
  modalImageWrapper: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalSelfie: {
    width: '100%',
    height: '100%',
  },
  noPhotoText: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#94A3B8',
    marginTop: 6,
  },
  modalInfoBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
  },
  modalActName: {
    fontSize: 15,
    fontFamily: fonts.sansBold,
    color: '#173B70',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 8,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  modalLabel: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: '#64748B',
  },
  modalVal: {
    fontSize: 12,
    fontFamily: fonts.sansSemiBold,
    color: '#0F172A',
  },
  modalValHighlight: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: '#10B981',
  },
  doneButton: {
    backgroundColor: '#173B70',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: fonts.sansBold,
  },
});
