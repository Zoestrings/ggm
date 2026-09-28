import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function AttendanceDetailScreen({ route, navigation }) {
  const { record, activity } = route.params || {};
  const [signedImageUrl, setSignedImageUrl] = useState(null);
  const [loadingImage, setLoadingImage] = useState(true);

  useEffect(() => {
    fetchSignedSelfieUrl();
  }, []);

  const fetchSignedSelfieUrl = async () => {
    if (!record?.selfie_url) {
      setLoadingImage(false);
      return;
    }

    try {
      const { data, error } = await supabase.storage
        .from('selfies')
        .createSignedUrl(record.selfie_url, 3600);

      if (error) {
        console.warn('Error creating signed URL:', error.message);
      } else if (data?.signedUrl) {
        setSignedImageUrl(data.signedUrl);
      }
    } catch (err) {
      console.error('Signed URL fetch error:', err);
    } finally {
      setLoadingImage(false);
    }
  };

  const user = record?.user || {};
  const memberName = user.name || 'Instrumentalist';
  const phone = user.phone || 'Not provided';
  const email = user.email || 'Not provided';
  const instrument = user.instrument || 'Musician';

  const checkInDate = record?.checked_in_at ? new Date(record.checked_in_at) : null;
  const timeFormatted = checkInDate
    ? checkInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'N/A';
  const dateFormatted = checkInDate
    ? checkInDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : 'N/A';

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
          <Text style={styles.headerTitle}>Verification Record</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Selfie Photo Card */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>VERIFICATION SELFIE</Text>
          <View style={styles.imageWrapper}>
            {loadingImage ? (
              <View style={styles.imageLoadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.imageLoadingText}>Loading verified photo...</Text>
              </View>
            ) : signedImageUrl ? (
              <Image source={{ uri: signedImageUrl }} style={styles.selfieImage} resizeMode="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="camera-outline" size={36} color={colors.textLight} />
                <Text style={styles.placeholderText}>Verification photo not found</Text>
              </View>
            )}
          </View>
        </View>

        {/* Member Profile Details */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>MUSICIAN INFORMATION</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Full Name</Text>
            <Text style={styles.detailValue}>{memberName}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Instrument</Text>
            <View style={styles.instrumentBadge}>
              <Text style={styles.instrumentBadgeText}>{instrument}</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Phone Number</Text>
            <Text style={styles.detailValue}>{phone}</Text>
          </View>

          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Email</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{email}</Text>
          </View>
        </View>

        {/* Verification & GPS Metadata */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>SESSION & LOCATION METADATA</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Status</Text>
            <View style={styles.statusVerifiedBadge}>
              <Text style={styles.statusVerifiedText}>● {(record?.verification_status || 'VERIFIED').toUpperCase()}</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Activity</Text>
            <Text style={styles.detailValue} numberOfLines={1}>{activity?.name || 'Musician Session'}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>{dateFormatted}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Time</Text>
            <Text style={styles.detailValueHighlight}>{timeFormatted}</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>GPS Coordinates</Text>
            <Text style={styles.detailValueMono}>
              {record?.lat ? `${record.lat.toFixed(5)}, ${record.lng.toFixed(5)}` : 'N/A'}
            </Text>
          </View>

          <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.detailLabel}>Accuracy</Text>
            <Text style={styles.detailValueMono}>
              {record?.accuracy_m ? `±${Math.round(record.accuracy_m)} meters` : 'N/A'}
            </Text>
          </View>
        </View>

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
    marginBottom: 16,
  },
  cardSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  imageWrapper: {
    height: 280,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selfieImage: {
    width: '100%',
    height: '100%',
  },
  imageLoadingContainer: {
    alignItems: 'center',
  },
  imageLoadingText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  imagePlaceholder: {
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    maxWidth: '65%',
    textAlign: 'right',
  },
  detailValueHighlight: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  detailValueMono: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: colors.textSecondary,
  },
  instrumentBadge: {
    backgroundColor: colors.neutralBg,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  instrumentBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.neutralText,
  },
  statusVerifiedBadge: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusVerifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.successText,
  },
});
