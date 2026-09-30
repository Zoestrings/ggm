import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function SuperAdminDashboardScreen({ navigation }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [activeActivity, setActiveActivity] = useState(null);
  const [checkedInCount, setCheckedInCount] = useState(0);
  const [latestCheckins, setLatestCheckins] = useState([]);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [superAdminCount, setSuperAdminCount] = useState(0);
  const [subAdminCount, setSubAdminCount] = useState(0);
  const [totalMembersCount, setTotalMembersCount] = useState(0);
  const [latestReport, setLatestReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const fetchAdminStats = async () => {
        try {
          setLoading(true);
          // 1. Get current auth user
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            navigation.replace('Login');
            return;
          }
          if (isMounted) setCurrentUser(user);

          // 2. Fetch profile & role check
          const { data: profile } = await supabase
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

          if (isMounted) setUserProfile(profile);

          // 3. User counts
          const { count: memberCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
          if (isMounted) setTotalMembersCount(memberCount || 0);

          const { count: saCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('role', 'super_admin');
          if (isMounted) setSuperAdminCount(saCount || 0);

          const { count: subCount } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('role', 'sub_admin');
          if (isMounted) setSubAdminCount(subCount || 0);

          // 4. Query current activity
          const { data: activities } = await supabase
            .from('activities')
            .select('*')
            .order('opens_at', { ascending: false })
            .limit(1);

          const currentAct = activities && activities.length > 0 ? activities[0] : null;
          if (isMounted) setActiveActivity(currentAct);

          if (currentAct) {
            // Count checked-in
            const { count: attCount } = await supabase
              .from('attendance')
              .select('*', { count: 'exact', head: true })
              .eq('activity_id', currentAct.id);
            if (isMounted) setCheckedInCount(attCount || 0);

            // Latest 5 check-ins preview
            const { data: previewAtt } = await supabase
              .from('attendance')
              .select(`
                id,
                checked_in_at,
                selfie_url,
                user:users!attendance_member_id_fkey (
                  id,
                  name,
                  instrument
                )
              `)
              .eq('activity_id', currentAct.id)
              .order('checked_in_at', { ascending: false })
              .limit(5);

            if (isMounted) setLatestCheckins(previewAtt || []);

            // Check if PDF report exists
            try {
              const { data: repData } = await supabase
                .from('reports')
                .select('*')
                .eq('activity_id', currentAct.id)
                .order('generated_at', { ascending: false })
                .limit(1);

              if (isMounted && repData && repData.length > 0) {
                setLatestReport(repData[0]);
              } else if (isMounted) {
                setLatestReport(null);
              }
            } catch (_rErr) {
              // reports table optional
            }

            // Pending offline reviews
            const { count: pendCount } = await supabase
              .from('pending_checkins')
              .select('*', { count: 'exact', head: true })
              .eq('status', 'pending');
            if (isMounted) setPendingReviewCount(pendCount || 0);
          }
        } catch (err) {
          console.error('SuperAdminDashboard load error:', err);
        } finally {
          if (isMounted) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      };

      fetchAdminStats();

      return () => {
        isMounted = false;
      };
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
  };

  const handleDownloadPDF = async () => {
    if (!latestReport?.storage_path) {
      Alert.alert(
        'Report Not Ready',
        'No finalized monthly PDF report has been archived yet for this period. Official reports are generated once the monthly session is completed and finalized.'
      );
      return;
    }

    try {
      setDownloadingPdf(true);
      const { data: signedData, error: signErr } = await supabase.storage
        .from('reports')
        .createSignedUrl(latestReport.storage_path, 3600);

      if (signErr || !signedData?.signedUrl) {
        throw new Error(signErr?.message || 'Could not generate download link.');
      }

      const fileUrl = signedData.signedUrl;
      const fileName = `GGM_Attendance_${latestReport.activity_id.slice(0, 8)}.pdf`;
      const localUri = `${FileSystem.documentDirectory}${fileName}`;

      const downloadResult = await FileSystem.downloadAsync(fileUrl, localUri);

      if (downloadResult.status !== 200) {
        throw new Error('PDF download failed.');
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadResult.uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Attendance PDF',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Downloaded', `Saved to ${downloadResult.uri}`);
      }
    } catch (err) {
      Alert.alert('Download Error', err.message || 'Failed to download report.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const adminName = userProfile?.name || 'Super Admin';

  if (loading && !userProfile) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

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
        <View style={styles.headerLeft}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.headerOrgTitle}>Super Admin Portal</Text>
            <Text style={styles.headerOrgSubtitle}>Gods Ministry Inc. • Warri HQ</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.switchButton}
          onPress={() => navigation.navigate('Home')}
          activeOpacity={0.7}
        >
          <Text style={styles.switchButtonText}>Member View</Text>
        </TouchableOpacity>
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
        {/* Welcome Banner */}
        <View style={styles.welcomeBanner}>
          <Text style={styles.welcomeGreeting}>Welcome, {adminName}</Text>
          <Text style={styles.welcomeRole}>Super Administrator • Full Oversight</Text>
        </View>

        {/* ── 1. Today's Summary Card ── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleWrap}>
              <Ionicons name="calendar" size={17} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.cardTitle}>Current Session Attendance</Text>
            </View>
            <View style={styles.statusBadgeOpen}>
              <Text style={styles.statusTextOpen}>● ACTIVE</Text>
            </View>
          </View>

          <Text style={styles.activityNameText}>
            {activeActivity?.name || 'No session open currently'}
          </Text>

          <View style={styles.countRow}>
            <View style={styles.countBox}>
              <Text style={styles.countNumber}>{checkedInCount}</Text>
              <Text style={styles.countLabel}>Checked In</Text>
            </View>
            <View style={styles.countDivider} />
            <View style={styles.countBox}>
              <Text style={styles.countNumber}>{totalMembersCount}</Text>
              <Text style={styles.countLabel}>Total Members</Text>
            </View>
          </View>

          {/* Latest checkins preview */}
          {latestCheckins.length > 0 && (
            <View style={styles.previewContainer}>
              <Text style={styles.previewHeading}>LATEST ENTRIES</Text>
              {latestCheckins.map((item, idx) => (
                <View key={item.id || idx} style={styles.previewRow}>
                  <View style={styles.avatarMini}>
                    <Ionicons name="person" size={12} color="#FFFFFF" />
                  </View>
                  <Text style={styles.previewName} numberOfLines={1}>
                    {item.user?.name || 'Musician'}
                  </Text>
                  <Text style={styles.previewTime}>
                    {item.checked_in_at
                      ? new Date(item.checked_in_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.cardActionLink}
            onPress={() => navigation.navigate('AttendanceList', { activity: activeActivity })}
            activeOpacity={0.7}
          >
            <Text style={styles.cardActionLinkText}>View Full Attendance List →</Text>
          </TouchableOpacity>
        </View>

        {/* ── 2. Download / Generate PDF Card ── */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleWrap}>
              <Ionicons name="document-text" size={17} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.cardTitle}>Official Monthly PDF Report</Text>
            </View>
            {latestReport ? (
              <View style={styles.badgeSuccess}>
                <Text style={styles.badgeTextSuccess}>READY</Text>
              </View>
            ) : (
              <View style={styles.badgePending}>
                <Text style={styles.badgeTextPending}>UNFINALIZED</Text>
              </View>
            )}
          </View>

          <Text style={styles.cardDescription}>
            {latestReport
              ? `Report generated for ${latestReport.count || checkedInCount} participants with embedded verification photos.`
              : 'Generate and finalize the attendance report for this session.'}
          </Text>

          <TouchableOpacity
            style={[styles.primaryButton, downloadingPdf && { opacity: 0.6 }]}
            onPress={handleDownloadPDF}
            disabled={downloadingPdf}
            activeOpacity={0.85}
          >
            {downloadingPdf ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons
                  name={latestReport ? 'download-outline' : 'document-text-outline'}
                  size={18}
                  color="#FFFFFF"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.primaryButtonText}>
                  {latestReport ? 'Download Attendance PDF' : 'Generate & Review PDF'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ── 3. Top Performers Card (3-Month Report) ── */}
        <TouchableOpacity
          style={[styles.card, styles.highlightCard]}
          onPress={() => navigation.navigate('TopPerformers')}
          activeOpacity={0.85}
        >
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleWrap}>
              <Ionicons name="trophy" size={18} color="#D97706" style={{ marginRight: 6 }} />
              <Text style={[styles.cardTitle, { color: '#B45309' }]}>Top Performers Report</Text>
            </View>
            <View style={styles.tierPillsRow}>
              <Text style={styles.pillText}>🥇 100%</Text>
              <Text style={styles.pillText}>🥈 70%</Text>
              <Text style={styles.pillText}>🥉 40%</Text>
            </View>
          </View>
          <Text style={styles.cardDescription}>
            Evaluate member consistency across the last 3 completed sessions.
          </Text>
          <View style={styles.cardLinkRow}>
            <Text style={styles.highlightLinkText}>Open 3-Month Service Rankings →</Text>
          </View>
        </TouchableOpacity>

        {/* ── 4. Manage Roles Card ── */}
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('ManageRoles')}
          activeOpacity={0.85}
        >
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardTitleWrap}>
              <Ionicons name="people" size={17} color={colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.cardTitle}>Role Management</Text>
            </View>
          </View>
          <Text style={styles.cardDescription}>
            Manage church leadership roles. Current assignment:
          </Text>
          <View style={styles.rolesRow}>
            <View style={styles.roleStatPill}>
              <Ionicons name="shield-checkmark" size={14} color={colors.primary} style={{ marginRight: 4 }} />
              <Text style={styles.roleStatText}>{superAdminCount} Super Admin{superAdminCount !== 1 ? 's' : ''}</Text>
            </View>
            <View style={styles.roleStatPill}>
              <Ionicons name="eye" size={14} color={colors.textSecondary} style={{ marginRight: 4 }} />
              <Text style={styles.roleStatText}>{subAdminCount} Sub Admin{subAdminCount !== 1 ? 's' : ''}</Text>
            </View>
          </View>
          <View style={styles.cardLinkRow}>
            <Text style={styles.cardActionLinkText}>Manage Department Roles →</Text>
          </View>
        </TouchableOpacity>

        {/* ── 5. Secondary Quick Links (All Attendance & Audit Log) ── */}
        <View style={styles.twoColumnRow}>
          <TouchableOpacity
            style={styles.halfCard}
            onPress={() => navigation.navigate('AllAttendance')}
            activeOpacity={0.8}
          >
            <Ionicons name="calendar-outline" size={22} color={colors.primary} />
            <Text style={styles.halfCardTitle}>All Records</Text>
            <Text style={styles.halfCardSub}>Filter by date & instrument</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.halfCard}
            onPress={() => navigation.navigate('AuditLog')}
            activeOpacity={0.8}
          >
            <Ionicons name="shield-outline" size={22} color={colors.primary} />
            <Text style={styles.halfCardTitle}>Audit Log</Text>
            <Text style={styles.halfCardSub}>Track administrative actions</Text>
          </TouchableOpacity>
        </View>

        {/* ── 6. Pending Review Banner if items waiting ── */}
        {pendingReviewCount > 0 && (
          <TouchableOpacity
            style={styles.pendingReviewBanner}
            onPress={() => navigation.navigate('PendingReview')}
            activeOpacity={0.85}
          >
            <Ionicons name="alert-circle" size={20} color="#B45309" style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingBannerTitle}>
                {pendingReviewCount} Offline Check-in{pendingReviewCount !== 1 ? 's' : ''} Pending
              </Text>
              <Text style={styles.pendingBannerSub}>Tap to review and approve submissions</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#B45309" />
          </TouchableOpacity>
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
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 40,
    height: 40,
    marginRight: 10,
  },
  headerOrgTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerOrgSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  switchButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  switchButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scrollContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 16,
    paddingBottom: 24,
  },
  welcomeBanner: {
    marginBottom: 16,
  },
  welcomeGreeting: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  welcomeRole: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
  },
  highlightCard: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  activityNameText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 12,
  },
  cardDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: 12,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    marginBottom: 12,
  },
  countBox: {
    flex: 1,
    alignItems: 'center',
  },
  countNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.primary,
  },
  countLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  countDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.border,
  },
  previewContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 10,
    marginBottom: 8,
  },
  previewHeading: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  avatarMini: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  previewName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
  },
  previewTime: {
    fontSize: 11,
    color: colors.textMuted,
  },
  cardActionLink: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  cardActionLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  tierPillsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    color: '#92400E',
  },
  cardLinkRow: {
    marginTop: 4,
  },
  highlightLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  rolesRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  roleStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleStatText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  twoColumnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  halfCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
  },
  halfCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 8,
    marginBottom: 2,
  },
  halfCardSub: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
  },
  pendingReviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  pendingBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  pendingBannerSub: {
    fontSize: 11,
    color: '#92400E',
    marginTop: 1,
  },
  statusBadgeOpen: {
    backgroundColor: colors.successBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  statusTextOpen: {
    color: colors.successText,
    fontSize: 10,
    fontWeight: '700',
  },
  badgeSuccess: {
    backgroundColor: colors.successBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTextSuccess: {
    color: colors.successText,
    fontSize: 10,
    fontWeight: '700',
  },
  badgePending: {
    backgroundColor: colors.warningBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeTextPending: {
    color: colors.warningText,
    fontSize: 10,
    fontWeight: '700',
  },
});
