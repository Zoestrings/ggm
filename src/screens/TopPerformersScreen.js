import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function TopPerformersScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reportData, setReportData] = useState([]);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [totalActivities, setTotalActivities] = useState(3);

  useEffect(() => {
    loadTopPerformers();
  }, []);

  const loadTopPerformers = async () => {
    try {
      setLoading(true);

      // 1. Try querying via RPC function get_top_performers
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_top_performers');

      if (!rpcError && rpcData) {
        processResults(rpcData);
        return;
      }

      // 2. Client-side fallback if RPC is not yet created or migration pending
      console.log('Falling back to client-side Top Performers query:', rpcError?.message);

      // Fetch last 3 finalized activities
      const { data: activities, error: actErr } = await supabase
        .from('activities')
        .select('id, activity_date, name')
        .not('finalized_at', 'is', null)
        .order('activity_date', { ascending: false })
        .limit(3);

      if (actErr || !activities || activities.length === 0) {
        setReportData([]);
        setTotalActivities(0);
        return;
      }

      const actCount = activities.length;
      setTotalActivities(actCount);

      const dates = activities.map((a) => new Date(a.activity_date).getTime());
      const minDate = new Date(Math.min(...dates)).toISOString().slice(0, 10);
      const maxDate = new Date(Math.max(...dates)).toISOString().slice(0, 10);
      setStartDate(minDate);
      setEndDate(maxDate);

      const activityIds = activities.map((a) => a.id);

      // Fetch active members
      const { data: members, error: memErr } = await supabase
        .from('users')
        .select('id, name')
        .eq('role', 'member')
        .order('name', { ascending: true });

      if (memErr || !members) {
        setReportData([]);
        return;
      }

      // Fetch attendance for these activities
      const { data: attendanceData } = await supabase
        .from('attendance')
        .select('member_id, activity_id')
        .in('activity_id', activityIds);

      // Map member counts
      const countsMap = {};
      (attendanceData || []).forEach((row) => {
        if (!countsMap[row.member_id]) {
          countsMap[row.member_id] = new Set();
        }
        countsMap[row.member_id].add(row.activity_id);
      });

      const processed = members.map((m) => {
        const attended = countsMap[m.id]?.size || 0;
        let tier = 0;
        if (attended >= 3) tier = 100;
        else if (attended === 2) tier = 70;
        else if (attended === 1) tier = 40;

        return {
          member_id: m.id,
          member_name: m.name || 'Member',
          months_attended: attended,
          total_activities: actCount,
          percentage_tier: tier,
        };
      });

      // Sort descending by months attended, then name
      processed.sort((a, b) => b.months_attended - a.months_attended || a.member_name.localeCompare(b.member_name));
      setReportData(processed);
    } catch (err) {
      console.error('Error loading top performers:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const processResults = (data) => {
    if (!data || data.length === 0) {
      setReportData([]);
      setTotalActivities(0);
      return;
    }

    const first = data[0];
    setTotalActivities(first.total_activities || 0);
    setStartDate(first.start_date || null);
    setEndDate(first.end_date || null);
    setReportData(data);
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadTopPerformers();
  };

  // Group tiers
  const tier100 = reportData.filter((r) => r.percentage_tier === 100);
  const tier70 = reportData.filter((r) => r.percentage_tier === 70);
  const tier40 = reportData.filter((r) => r.percentage_tier === 40);
  const unservedCount = reportData.filter((r) => r.percentage_tier === 0 || r.months_attended === 0).length;

  const formatDateRange = () => {
    if (!startDate || !endDate) return 'Last 3 Finalized Sessions';
    const s = new Date(startDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const e = new Date(endDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    return `${s} – ${e}`;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Watermark */}
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
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Top Performers</Text>
          <Text style={styles.headerSubtitle}>3-Month Service Evaluation</Text>
        </View>
        <View style={styles.badgeSuperAdmin}>
          <Text style={styles.badgeSuperAdminText}>SUPER ADMIN</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {/* Banner Card */}
        <View style={styles.reportBanner}>
          <View style={styles.reportIconCircle}>
            <Ionicons name="trophy" size={26} color="#D97706" />
          </View>
          <Text style={styles.reportHeading}>3-MONTH SERVICE REPORT</Text>
          <Text style={styles.reportSubheading}>{formatDateRange()}</Text>
          <Text style={styles.reportEvaluationNote}>
            Evaluation based on attendance across the last {totalActivities || 3} finalized monthly sessions.
          </Text>
        </View>

        {loading && !refreshing ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Calculating service percentages...</Text>
          </View>
        ) : totalActivities === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="hourglass-outline" size={48} color={colors.borderDark} />
            <Text style={styles.emptyTitle}>No Finalized Activities Yet</Text>
            <Text style={styles.emptySubtitle}>
              The report will become available once monthly attendance sessions have been officially finalized by a Super Admin.
            </Text>
          </View>
        ) : (
          <>
            {/* ── 1. Gold Tier: 100% ── */}
            <View style={styles.tierSection}>
              <View style={styles.tierHeaderRow}>
                <Text style={styles.tierBadgeEmoji}>🥇</Text>
                <View style={styles.tierTextGroup}>
                  <Text style={styles.tierTitleGold}>100% — 3 of 3 months</Text>
                  <Text style={styles.tierSubtitle}>Perfect Attendance • Gold Honour</Text>
                </View>
                <Text style={styles.tierCountBadge}>{tier100.length}</Text>
              </View>

              {tier100.length > 0 ? (
                <View style={styles.memberListCard}>
                  {tier100.map((member, idx) => (
                    <View
                      key={member.member_id || idx}
                      style={[
                        styles.memberRow,
                        idx === tier100.length - 1 && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={styles.memberInfoCol}>
                        <Text style={styles.memberName}>{member.member_name}</Text>
                      </View>
                      <View style={styles.attendedPillGold}>
                        <Text style={styles.attendedPillTextGold}>
                          {member.months_attended}/{totalActivities}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.tierEmptyBox}>
                  <Text style={styles.tierEmptyText}>No members in this tier for this period.</Text>
                </View>
              )}
            </View>

            {/* ── 2. Silver Tier: 70% ── */}
            <View style={styles.tierSection}>
              <View style={styles.tierHeaderRow}>
                <Text style={styles.tierBadgeEmoji}>🥈</Text>
                <View style={styles.tierTextGroup}>
                  <Text style={styles.tierTitleSilver}>70% — 2 of 3 months</Text>
                  <Text style={styles.tierSubtitle}>Consistent Attendance • Silver Honour</Text>
                </View>
                <Text style={styles.tierCountBadge}>{tier70.length}</Text>
              </View>

              {tier70.length > 0 ? (
                <View style={styles.memberListCard}>
                  {tier70.map((member, idx) => (
                    <View
                      key={member.member_id || idx}
                      style={[
                        styles.memberRow,
                        idx === tier70.length - 1 && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={styles.memberInfoCol}>
                        <Text style={styles.memberName}>{member.member_name}</Text>
                      </View>
                      <View style={styles.attendedPillSilver}>
                        <Text style={styles.attendedPillTextSilver}>
                          {member.months_attended}/{totalActivities}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.tierEmptyBox}>
                  <Text style={styles.tierEmptyText}>No members in this tier for this period.</Text>
                </View>
              )}
            </View>

            {/* ── 3. Bronze Tier: 40% ── */}
            <View style={styles.tierSection}>
              <View style={styles.tierHeaderRow}>
                <Text style={styles.tierBadgeEmoji}>🥉</Text>
                <View style={styles.tierTextGroup}>
                  <Text style={styles.tierTitleBronze}>40% — 1 of 3 months</Text>
                  <Text style={styles.tierSubtitle}>Partial Attendance • Bronze Honour</Text>
                </View>
                <Text style={styles.tierCountBadge}>{tier40.length}</Text>
              </View>

              {tier40.length > 0 ? (
                <View style={styles.memberListCard}>
                  {tier40.map((member, idx) => (
                    <View
                      key={member.member_id || idx}
                      style={[
                        styles.memberRow,
                        idx === tier40.length - 1 && { borderBottomWidth: 0 },
                      ]}
                    >
                      <View style={styles.memberInfoCol}>
                        <Text style={styles.memberName}>{member.member_name}</Text>
                      </View>
                      <View style={styles.attendedPillBronze}>
                        <Text style={styles.attendedPillTextBronze}>
                          {member.months_attended}/{totalActivities}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.tierEmptyBox}>
                  <Text style={styles.tierEmptyText}>No members in this tier for this period.</Text>
                </View>
              )}
            </View>

            {/* ── 4. Unserved Count Banner (Hidden members) ── */}
            <View style={styles.unservedBox}>
              <Ionicons name="people-outline" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <Text style={styles.unservedText}>
                <Text style={styles.unservedHighlight}>{unservedCount}</Text> active member{unservedCount !== 1 ? 's' : ''} did not attend any sessions in this period.
              </Text>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
  badgeSuperAdmin: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeSuperAdminText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  scrollContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 16,
    paddingBottom: 24,
  },
  reportBanner: {
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 18,
    alignItems: 'center',
    marginBottom: 20,
  },
  reportIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  reportHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#92400E',
    letterSpacing: 0.5,
  },
  reportSubheading: {
    fontSize: 13,
    fontWeight: '600',
    color: '#B45309',
    marginTop: 4,
  },
  reportEvaluationNote: {
    fontSize: 11,
    color: '#78350F',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  },
  tierSection: {
    marginBottom: 20,
  },
  tierHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tierBadgeEmoji: {
    fontSize: 22,
    marginRight: 8,
  },
  tierTextGroup: {
    flex: 1,
  },
  tierTitleGold: {
    fontSize: 15,
    fontWeight: '700',
    color: '#B45309',
  },
  tierTitleSilver: {
    fontSize: 15,
    fontWeight: '700',
    color: '#475569',
  },
  tierTitleBronze: {
    fontSize: 15,
    fontWeight: '700',
    color: '#9A3412',
  },
  tierSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
  },
  tierCountBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  memberListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  memberInfoCol: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  attendedPillGold: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attendedPillTextGold: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },
  attendedPillSilver: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attendedPillTextSilver: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  attendedPillBronze: {
    backgroundColor: '#FFEDD5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  attendedPillTextBronze: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9A3412',
  },
  tierEmptyBox: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  tierEmptyText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  unservedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    padding: 14,
    marginTop: 6,
  },
  unservedText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 18,
  },
  unservedHighlight: {
    fontWeight: '700',
    color: colors.textPrimary,
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
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
