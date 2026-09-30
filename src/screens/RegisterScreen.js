import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';
import PasswordField from '../components/PasswordField';

export default function RegisterScreen({ navigation }) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordValid, setIsPasswordValid] = useState(false);
  const [instrument, setInstrument] = useState('Keyboard');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // OTP Verification Step State
  const [isOtpStep, setIsOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const instrumentsList = [
    'Keyboard',
    'Drums',
    'Lead Guitar',
    'Bass Guitar',
    'Saxophone',
    'Vocals',
    'Trumpet',
    'Other',
  ];

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleRegisterSubmit = async () => {
    if (!fullName.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter your full name and password.');
      return;
    }
    if (!email.trim() && !phone.trim()) {
      Alert.alert('Missing Fields', 'Please provide an email address or phone number.');
      return;
    }
    if (!isPasswordValid) {
      Alert.alert('Incomplete Password', 'Please ensure your password has at least 6 characters, including letters and numbers.');
      return;
    }

    setLoading(true);
    try {
      // 1. Check total existing users count
      const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      const count = totalUsers || 0;

      // 2. If 1000+ members and email provided, trigger OTP verification
      if (count >= 1000 && email.trim()) {
        const { data, error } = await supabase.functions.invoke('send-otp', {
          body: { email: email.trim() },
        });

        if (error) {
          console.warn('Edge function fallback:', error.message);
        }

        setIsOtpStep(true);
        setResendCooldown(60);
        Alert.alert(
          'Verification Code Sent',
          `A 6-digit verification code has been sent to ${email.trim()}. Please enter it below to complete registration.`
        );
        return;
      }

      // If under 1000 members, proceed directly
      await completeRegistration(false);
    } catch (error) {
      Alert.alert(
        'Registration Failed',
        error.message || 'Something went wrong. Please check your details.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit numeric code sent to your email.');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-otp', {
        body: { email: email.trim(), code: otpCode.trim() },
      });

      if (error || (data && !data.success)) {
        throw new Error(data?.error || error?.message || 'Invalid or expired code. Try again.');
      }

      await completeRegistration(true);
    } catch (err) {
      Alert.alert('Verification Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      await supabase.functions.invoke('send-otp', {
        body: { email: email.trim() },
      });
      setResendCooldown(60);
      Alert.alert('Code Resent', `A fresh 6-digit verification code was sent to ${email.trim()}.`);
    } catch (err) {
      Alert.alert('Resend Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const completeRegistration = async (isEmailVerified = false) => {
    const authEmail = email.trim() || `${phone.replace(/[^0-9]/g, '')}@instrumentalists.local`;

    // 1. Sign up in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: authEmail,
      password: password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.trim(),
          instrument: instrument,
          role: 'member',
          email_verified: isEmailVerified,
        },
      },
    });

    if (authError) throw authError;

    const userId = authData?.user?.id;

    // 2. Insert into public.users table
    if (userId) {
      const profilePayload = {
        id: userId,
        name: fullName.trim(),
        phone: phone.trim(),
        email: authEmail,
        instrument: instrument,
        role: 'member',
        email_verified: isEmailVerified,
        password_hash: 'managed_by_supabase_auth',
        created_at: new Date().toISOString(),
      };

      await supabase.from('users').upsert(profilePayload);
    }

    Alert.alert(
      'Account Created',
      'Your instrumentalist profile has been registered successfully. You can now sign in.',
      [
        {
          text: 'Proceed to Sign In',
          onPress: () => navigation.navigate('Login'),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Background Subtle Watermark */}
      <Image
        source={require('../../assets/logo.png')}
        style={styles.watermark}
        resizeMode="contain"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.orgName}>GODS MINISTRY INC.</Text>
            <Text style={styles.title}>
              {isOtpStep ? 'Verify Email' : 'Member Registration'}
            </Text>
            <Text style={styles.subtitle}>
              {isOtpStep
                ? `Enter the 6-digit code sent to ${email}`
                : 'GGM Instrumentalists Attendance Management'}
            </Text>
          </View>

          {isOtpStep ? (
            /* OTP Input View */
            <View style={styles.formCard}>
              <Text style={styles.label}>6-Digit Verification Code</Text>
              <TextInput
                style={[styles.input, styles.otpInput]}
                placeholder="123456"
                placeholderTextColor={colors.textLight}
                value={otpCode}
                onChangeText={setOtpCode}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />

              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={handleVerifyOtp}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>Verify & Complete Registration</Text>
                )}
              </TouchableOpacity>

              <View style={styles.resendRow}>
                <TouchableOpacity
                  onPress={handleResendOtp}
                  disabled={resendCooldown > 0 || loading}
                >
                  <Text style={[styles.resendText, resendCooldown > 0 && styles.resendDisabled]}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.cancelOtpButton}
                onPress={() => setIsOtpStep(false)}
              >
                <Text style={styles.cancelOtpText}>‹ Back to Edit Details</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Main Registration Form */
            <View style={styles.formCard}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons
                    name="person-outline"
                    size={18}
                    color={colors.textMuted}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. John Okonkwo"
                    placeholderTextColor={colors.textLight}
                    value={fullName}
                    onChangeText={setFullName}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons
                    name="call-outline"
                    size={18}
                    color={colors.textMuted}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="08012345678"
                    placeholderTextColor={colors.textLight}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons
                    name="mail-outline"
                    size={18}
                    color={colors.textMuted}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="member@example.com"
                    placeholderTextColor={colors.textLight}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Primary Instrument</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.instrumentPicker}
                >
                  {instrumentsList.map((item) => (
                    <TouchableOpacity
                      key={item}
                      style={[
                        styles.instrumentChip,
                        instrument === item && styles.instrumentChipActive,
                      ]}
                      onPress={() => setInstrument(item)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.instrumentChipText,
                          instrument === item && styles.instrumentChipTextActive,
                        ]}
                      >
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <PasswordField
                value={password}
                onChangeText={setPassword}
                onValidityChange={setIsPasswordValid}
                placeholder="At least 6 characters"
                label="Password"
              />

              {/* Primary Register Button */}
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  (loading || !isPasswordValid) && styles.buttonDisabled,
                ]}
                onPress={handleRegisterSubmit}
                disabled={loading || !isPasswordValid}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Create Account</Text>
                )}
              </TouchableOpacity>

              <View style={styles.divider} />

              <View style={styles.footerRow}>
                <Text style={styles.footerText}>Already have an account? </Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate('Login')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.footerLink}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
  scrollContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 24,
    paddingBottom: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: 64,
    height: 64,
    marginBottom: 10,
  },
  orgName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  inputIcon: {
    paddingLeft: 12,
    paddingRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    padding: 4,
  },
  otpInput: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 8,
    color: colors.primary,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: 16,
  },
  instrumentPicker: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  instrumentChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: colors.neutralBg,
    borderWidth: 1,
    borderColor: colors.neutralBorder,
    borderRadius: 6,
    marginRight: 8,
  },
  instrumentChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  instrumentChipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  instrumentChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    minHeight: 52,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: 16,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  footerLink: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  resendRow: {
    alignItems: 'center',
    marginTop: 14,
  },
  resendText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  resendDisabled: {
    color: colors.textLight,
  },
  cancelOtpButton: {
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 4,
  },
  cancelOtpText: {
    color: colors.textMuted,
    fontSize: 13,
  },
});
