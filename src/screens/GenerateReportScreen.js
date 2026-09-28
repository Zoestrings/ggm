import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { LOGO_BASE64 } from '../lib/logoBase64';
import { colors, spacing } from '../theme';

export default function GenerateReportScreen({ route, navigation }) {
  const { activity } = route.params || {};
  const [currentActivity, setCurrentActivity] = useState(activity || null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    loadReportData();
  }, []);

  const loadReportData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);

      let actId = currentActivity?.id;
      if (!actId) {
        const { data: latestActs } = await supabase
          .from('activities')
          .select('*')
          .order('opens_at', { ascending: false })
          .limit(1);

        if (latestActs && latestActs.length > 0) {
          setCurrentActivity(latestActs[0]);
          actId = latestActs[0].id;
        }
      }

      if (actId) {
        const { data: attendanceData } = await supabase
          .from('attendance')
          .select(`
            id,
            checked_in_at,
            verification_status,
            lat,
            lng,
            user:users!attendance_member_id_fkey (
              id,
              name,
              phone,
              instrument
            )
          `)
          .eq('activity_id', actId)
          .order('checked_in_at', { ascending: true });

        if (attendanceData) {
          setAttendanceRecords(attendanceData);
        } else {
          const { data: rawAtt } = await supabase
            .from('attendance')
            .select('*')
            .eq('activity_id', actId);

          if (rawAtt) {
            const userIds = rawAtt.map((a) => a.member_id);
            const { data: usersData } = await supabase.from('users').select('*').in('id', userIds);
            const userMap = {};
            (usersData || []).forEach((u) => { userMap[u.id] = u; });
            const enriched = rawAtt.map((a) => ({ ...a, user: userMap[a.member_id] || {} }));
            setAttendanceRecords(enriched);
          }
        }
      }
    } catch (err) {
      console.error('Error loading report data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePDF = async () => {
    if (!currentActivity) return;

    setGeneratingPdf(true);
    try {
      const actDate = currentActivity.opens_at
        ? new Date(currentActivity.opens_at).toLocaleDateString([], {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'N/A';

      const opensTime = currentActivity.opens_at
        ? new Date(currentActivity.opens_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A';

      const closesTime = currentActivity.closes_at
        ? new Date(currentActivity.closes_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'N/A';

      const reportId = currentActivity.id.slice(0, 8).toUpperCase();
      const generationDate = new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

      const tableRowsHtml = attendanceRecords
        .map((rec, index) => {
          const name = rec.user?.name || 'Instrumentalist';
          const instrument = rec.user?.instrument || 'Musician';
          const time = rec.checked_in_at
            ? new Date(rec.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'N/A';
          const status = (rec.verification_status || 'VERIFIED').toUpperCase();

          return `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px 12px; font-weight: 600; color: #475569;">${index + 1}</td>
              <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">${name}</td>
              <td style="padding: 10px 12px; color: #173B70; font-weight: 600;">${instrument}</td>
              <td style="padding: 10px 12px; color: #1e293b;">${time}</td>
              <td style="padding: 10px 12px;">
                <span style="background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">
                  ● ${status}
                </span>
              </td>
            </tr>
          `;
        })
        .join('');

      const logoImgTag = LOGO_BASE64
        ? `<img src="${LOGO_BASE64}" class="header-logo" alt="GGM Logo" />`
        : '';

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Attendance Report - ${currentActivity.name}</title>
          <style>
            @page { margin: 20mm; size: A4 portrait; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              margin: 0;
              padding: 0;
            }
            .header {
              display: flex;
              align-items: center;
              border-bottom: 2px solid #173B70;
              padding-bottom: 16px;
              margin-bottom: 24px;
            }
            .header-logo {
              width: 72px;
              height: 72px;
              object-fit: contain;
              margin-right: 18px;
            }
            .header-text h1 {
              font-size: 20px;
              font-weight: 800;
              margin: 0 0 4px 0;
              color: #173B70;
              letter-spacing: -0.3px;
            }
            .header-text h2 {
              font-size: 13px;
              font-weight: 600;
              margin: 0 0 4px 0;
              color: #475569;
            }
            .header-text p {
              font-size: 11px;
              margin: 0;
              color: #64748b;
            }
            .doc-meta {
              display: flex;
              justify-content: space-between;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 14px 18px;
              margin-bottom: 24px;
            }
            .meta-group {
              font-size: 12px;
            }
            .meta-label {
              font-weight: 700;
              color: #64748b;
              text-transform: uppercase;
              font-size: 10px;
              margin-bottom: 4px;
            }
            .meta-value {
              font-weight: 700;
              color: #0f172a;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 24px;
              font-size: 13px;
            }
            thead th {
              background: #173B70;
              color: #ffffff;
              text-align: left;
              padding: 10px 12px;
              font-weight: 700;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .summary-box {
              display: flex;
              justify-content: flex-end;
              margin-top: 16px;
              margin-bottom: 36px;
            }
            .summary-label {
              font-weight: 700;
              font-size: 13px;
              margin-right: 12px;
              align-self: center;
            }
            .summary-count {
              background: #173B70;
              color: #ffffff;
              padding: 8px 16px;
              border-radius: 6px;
              font-weight: 800;
              font-size: 14px;
            }
            .signoff {
              display: flex;
              justify-content: space-between;
              margin-top: 50px;
              padding-top: 20px;
            }
            .sig-line {
              width: 42%;
              border-top: 1px solid #94a3b8;
              text-align: center;
              font-size: 12px;
              color: #475569;
              padding-top: 8px;
              font-weight: 600;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              font-size: 10px;
              color: #94a3b8;
              border-top: 1px solid #f1f5f9;
              padding-top: 12px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            ${logoImgTag}
            <div class="header-text">
              <h1>GODS MINISTRY INC.</h1>
              <h2>GGM Instrumentalists Attendance Management System</h2>
              <p>Gods Ministry Inc. HQ • Warri, Delta State</p>
            </div>
          </div>

          <div class="doc-meta">
            <div class="meta-group">
              <div class="meta-label">Activity Name</div>
              <div class="meta-value">${currentActivity.name}</div>
            </div>
            <div class="meta-group">
              <div class="meta-label">Session Date</div>
              <div class="meta-value">${actDate}</div>
            </div>
            <div class="meta-group">
              <div class="meta-label">Time Window</div>
              <div class="meta-value">${opensTime} – ${closesTime}</div>
            </div>
            <div class="meta-group">
              <div class="meta-label">Report ID</div>
              <div class="meta-value">#${reportId}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 35px;">#</th>
                <th>Musician Name</th>
                <th>Instrument</th>
                <th>Check-In Time</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml || '<tr><td colspan="5" style="text-align:center; padding: 20px; color:#94a3b8;">No verified participants recorded</td></tr>'}
            </tbody>
          </table>

          <div class="summary-box">
            <div class="summary-label">TOTAL VERIFIED ATTENDANCE:</div>
            <div class="summary-count">${attendanceRecords.length} Musicians</div>
          </div>

          <div class="signoff">
            <div class="sig-line">Department Administrator</div>
            <div class="sig-line">Director of Music / Pastor in Charge</div>
          </div>

          <div class="footer">
            Generated electronically on ${generationDate} • GGM Instrumentalists Attendance Management System
          </div>
        </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({
        html: htmlContent,
        base64: false,
      });

      await logAudit({
        actorId: currentUser?.id,
        action: 'generate_pdf_report',
        entity: 'activities',
        entityId: currentActivity.id,
        reason: `Generated PDF summary report for ${attendanceRecords.length} attendees`,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          UTI: '.pdf',
          mimeType: 'application/pdf',
          dialogTitle: `GGM Attendance Report - ${currentActivity.name}`,
        });
      } else {
        Alert.alert('PDF Ready', `Report generated at: ${uri}`);
      }
    } catch (err) {
      console.error('PDF generation error:', err);
      Alert.alert('Report Error', err.message || 'Failed to generate PDF document.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleFinalizeActivity = () => {
    if (currentActivity?.finalized_at) {
      Alert.alert('Already Finalized', 'This activity ledger is already locked and finalized.');
      return;
    }

    Alert.alert(
      'Finalize Activity Attendance',
      'This will lock all attendance records for this activity and make them permanent and read-only. Are you sure you want to finalize now?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finalize & Lock',
          style: 'destructive',
          onPress: performFinalize,
        },
      ]
    );
  };

  const performFinalize = async () => {
    setFinalizing(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('activities')
        .update({ finalized_at: nowIso })
        .eq('id', currentActivity.id);

      if (error) throw error;

      await logAudit({
        actorId: currentUser?.id,
        action: 'finalize_activity',
        entity: 'activities',
        entityId: currentActivity.id,
        newValue: { finalized_at: nowIso, total_attendance: attendanceRecords.length },
        reason: 'Administrator finalized and locked attendance ledger',
      });

      setCurrentActivity({ ...currentActivity, finalized_at: nowIso });
      Alert.alert(
        'Ledger Finalized',
        'Attendance records for this activity are now officially locked and verified.'
      );
    } catch (err) {
      Alert.alert('Finalize Error', err.message || 'Could not finalize activity.');
    } finally {
      setFinalizing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isFinalized = !!currentActivity?.finalized_at;

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
          <Text style={styles.headerTitle}>Generate Report</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Activity Preview Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.sectionHeading}>ACTIVITY OVERVIEW</Text>
            {isFinalized ? (
              <View style={styles.finalizedBadge}>
                <Text style={styles.finalizedBadgeText}>LOCKED / FINALIZED</Text>
              </View>
            ) : (
              <View style={styles.openBadge}>
                <Text style={styles.openBadgeText}>● ACTIVE LEDGER</Text>
              </View>
            )}
          </View>

          <Text style={styles.activityName}>{currentActivity?.name || 'Musician Activity'}</Text>
          <Text style={styles.activityLocation}>Gods Ministry Inc. • GGM Instrumentalists Dept.</Text>

          <View style={styles.divider} />

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Session Date</Text>
            <Text style={styles.metaValue}>
              {currentActivity?.opens_at
                ? new Date(currentActivity.opens_at).toLocaleDateString([], {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : 'N/A'}
            </Text>
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Time Window</Text>
            <Text style={styles.metaValue}>
              {currentActivity?.opens_at
                ? new Date(currentActivity.opens_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'N/A'}{' '}
              –{' '}
              {currentActivity?.closes_at
                ? new Date(currentActivity.closes_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : 'N/A'}
            </Text>
          </View>

          <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.metaLabel}>Verified Attendees</Text>
            <Text style={styles.metaValueHighlight}>{attendanceRecords.length} Musicians</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <TouchableOpacity
          style={[styles.pdfButton, generatingPdf && styles.buttonDisabled]}
          onPress={handleGeneratePDF}
          disabled={generatingPdf}
          activeOpacity={0.85}
        >
          {generatingPdf ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Ionicons name="document-text-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.pdfButtonText}>Export Official PDF Report</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.finalizeButton,
            isFinalized && styles.finalizeButtonDisabled,
            finalizing && styles.buttonDisabled,
          ]}
          onPress={handleFinalizeActivity}
          disabled={isFinalized || finalizing}
          activeOpacity={0.8}
        >
          {finalizing ? (
            <ActivityIndicator color={colors.errorText} size="small" />
          ) : (
            <Text style={[styles.finalizeButtonText, isFinalized && styles.finalizeButtonTextDisabled]}>
              {isFinalized ? 'Ledger Locked & Finalized' : 'Finalize & Lock Attendance Ledger'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={{ height: 30 }} />
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
  scrollContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
  finalizedBadge: {
    backgroundColor: colors.neutralBg,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  finalizedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  openBadge: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  openBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.successText,
  },
  activityName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  activityLocation: {
    fontSize: 12,
    color: colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  metaLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metaValueHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  pdfButton: {
    backgroundColor: colors.primary,
    minHeight: 52,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  pdfButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  finalizeButton: {
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    minHeight: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  finalizeButtonDisabled: {
    backgroundColor: colors.neutralBg,
    borderColor: colors.neutralBorder,
  },
  finalizeButtonText: {
    color: colors.errorText,
    fontSize: 13,
    fontWeight: '700',
  },
  finalizeButtonTextDisabled: {
    color: colors.textMuted,
  },
});
