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
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function AuditLogScreen({ navigation }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchAuditLogs();
  }, []);

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('audit_logs')
        .select(`
          id,
          action,
          entity,
          entity_id,
          old_value,
          new_value,
          reason,
          created_at,
          actor:users!audit_logs_actor_id_fkey(
            id,
            name,
            role,
            phone
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        // Fallback query if foreign key alias fails
        const { data: fallbackData, error: fbError } = await supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);

        if (fbError) throw fbError;
        setLogs(fallbackData || []);
      } else {
        setLogs(data || []);
      }
    } catch (err) {
      console.error('AuditLogScreen error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchAuditLogs();
  };

  const getActionBadgeColor = (action = '') => {
    const act = action.toLowerCase();
    if (act.includes('promote') || act.includes('create') || act.includes('approve')) {
      return { bg: '#DCFCE7', text: '#15803D' };
    }
    if (act.includes('demote') || act.includes('delete') || act.includes('reject')) {
      return { bg: '#FEE2E2', text: '#B91C1C' };
    }
    if (act.includes('transfer') || act.includes('update')) {
      return { bg: '#FEF3C7', text: '#B45309' };
    }
    return { bg: colors.primaryLight, text: colors.primary };
  };

  const renderItem = ({ item }) => {
    const badge = getActionBadgeColor(item.action);
    const actorName = item.actor?.name || 'System / Admin';
    const timeFormatted = item.created_at
      ? new Date(item.created_at).toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

    return (
      <TouchableOpacity
        style={styles.logCard}
        onPress={() => setSelectedLog(item)}
        activeOpacity={0.7}
      >
        <View style={styles.logCardTop}>
          <View style={[styles.actionBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.actionBadgeText, { color: badge.text }]}>
              {item.action || 'LOG ENTRY'}
            </Text>
          </View>
          <Text style={styles.timeText}>{timeFormatted}</Text>
        </View>

        <Text style={styles.entityText}>
          Target: <Text style={styles.entityValue}>{item.entity || 'general'}</Text>
        </Text>

        <View style={styles.actorRow}>
          <Ionicons name="person-circle-outline" size={15} color={colors.textMuted} />
          <Text style={styles.actorText}>Actor: {actorName}</Text>
        </View>

        {item.reason ? (
          <Text style={styles.reasonText} numberOfLines={2}>
            Reason: {item.reason}
          </Text>
        ) : null}
      </TouchableOpacity>
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
          <Text style={styles.headerTitle}>System Audit Log</Text>
          <Text style={styles.headerSubtitle}>Security Definer Actions</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshHeaderBtn}
          onPress={fetchAuditLogs}
          activeOpacity={0.7}
        >
          <Ionicons name="reload-outline" size={19} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Fetching security audit logs...</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="shield-outline" size={48} color={colors.border} />
              <Text style={styles.emptyTitle}>No audit logs found</Text>
              <Text style={styles.emptySub}>
                Administrative actions like role promotions and report runs will appear here.
              </Text>
            </View>
          }
        />
      )}

      {/* Detail Modal */}
      <Modal
        visible={!!selectedLog}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedLog(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Audit Entry Details</Text>
              <TouchableOpacity
                onPress={() => setSelectedLog(null)}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {selectedLog && (
              <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Action:</Text>
                  <Text style={styles.modalValueBold}>{selectedLog.action}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Entity:</Text>
                  <Text style={styles.modalValue}>{selectedLog.entity}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Actor:</Text>
                  <Text style={styles.modalValue}>
                    {selectedLog.actor?.name || selectedLog.actor_id || 'System'}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Timestamp:</Text>
                  <Text style={styles.modalValue}>
                    {selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString() : '—'}
                  </Text>
                </View>

                {selectedLog.reason ? (
                  <View style={styles.modalBlock}>
                    <Text style={styles.modalLabel}>Reason / Notes:</Text>
                    <Text style={styles.modalBlockValue}>{selectedLog.reason}</Text>
                  </View>
                ) : null}

                {selectedLog.old_value && (
                  <View style={styles.modalBlock}>
                    <Text style={styles.modalLabel}>Previous Value:</Text>
                    <View style={styles.codeBlock}>
                      <Text style={styles.codeText}>
                        {JSON.stringify(selectedLog.old_value, null, 2)}
                      </Text>
                    </View>
                  </View>
                )}

                {selectedLog.new_value && (
                  <View style={styles.modalBlock}>
                    <Text style={styles.modalLabel}>New Value:</Text>
                    <View style={styles.codeBlock}>
                      <Text style={styles.codeText}>
                        {JSON.stringify(selectedLog.new_value, null, 2)}
                      </Text>
                    </View>
                  </View>
                )}
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setSelectedLog(null)}
              activeOpacity={0.8}
            >
              <Text style={styles.modalCloseButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 13, color: colors.textMuted },
  listContent: { padding: spacing.pagePadding, paddingBottom: 40 },
  logCard: {
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
  logCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  actionBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  timeText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  entityText: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  entityValue: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  actorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  actorText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginLeft: 4,
  },
  reasonText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 6,
    paddingLeft: 6,
    borderLeftWidth: 2,
    borderLeftColor: colors.borderLight,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  modalBody: { marginVertical: 14 },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  modalLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  modalValue: { fontSize: 13, color: colors.textPrimary },
  modalValueBold: { fontSize: 13, fontWeight: '700', color: colors.primary },
  modalBlock: { marginTop: 10 },
  modalBlockValue: { fontSize: 13, color: colors.textPrimary, marginTop: 4 },
  codeBlock: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
  },
  codeText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.textPrimary,
  },
  modalCloseButton: {
    backgroundColor: colors.primary,
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  modalCloseButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
