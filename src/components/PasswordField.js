import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

/**
 * Reusable PasswordField component with live strength bar and checklist.
 * 
 * Required rules:
 * - At least 6 characters
 * - Contains a lowercase letter
 * - Contains a number
 * 
 * Optional rules (boost strength):
 * - Contains an uppercase letter
 * - Contains a special character
 * 
 * Props:
 * @param {string} value - Current password text
 * @param {function} onChangeText - Callback when password text changes
 * @param {function} [onValidityChange] - Callback notifying parent if all required rules pass
 * @param {string} [placeholder="Enter password"] - Input placeholder
 * @param {string} [label="Password"] - Input label
 * @param {boolean} [showStrengthBar=true] - Whether to show the live strength bar
 * @param {boolean} [showChecklist=true] - Whether to show the live checklist
 */
export default function PasswordField({
  value = '',
  onChangeText,
  onValidityChange,
  placeholder = 'Enter password',
  label = 'Password',
  showStrengthBar = true,
  showChecklist = true,
  style,
  ...rest
}) {
  const [showPassword, setShowPassword] = useState(false);

  // Criteria evaluation
  const hasMinLength = value.length >= 6;
  const hasLowercase = /[a-z]/.test(value);
  const hasUppercase = /[A-Z]/.test(value);
  const hasNumber = /[0-9]/.test(value);
  const hasSpecial = /[^a-zA-Z0-9]/.test(value);
  const hasGoodLength = value.length >= 8;

  // Required rules pass
  const isRequiredValid = hasMinLength && hasLowercase && hasNumber;

  // Strength score out of 6
  let score = 0;
  if (hasMinLength) score++;
  if (hasLowercase) score++;
  if (hasUppercase) score++;
  if (hasNumber) score++;
  if (hasSpecial) score++;
  if (hasGoodLength) score++;

  useEffect(() => {
    if (onValidityChange) {
      onValidityChange(isRequiredValid);
    }
  }, [isRequiredValid, onValidityChange]);

  // Determine strength label and color
  let strengthLabel = 'Weak';
  let strengthColor = '#DC2626'; // Red
  let strengthPercent = '20%';

  if (value.length === 0) {
    strengthLabel = 'None';
    strengthColor = colors.border;
    strengthPercent = '0%';
  } else if (score <= 2) {
    strengthLabel = 'Weak';
    strengthColor = '#DC2626';
    strengthPercent = '25%';
  } else if (score === 3) {
    strengthLabel = 'Fair';
    strengthColor = '#D97706'; // Orange
    strengthPercent = '50%';
  } else if (score === 4) {
    strengthLabel = 'Good';
    strengthColor = '#CA8A04'; // Yellow
    strengthPercent = '75%';
  } else {
    strengthLabel = 'Strong';
    strengthColor = '#16A34A'; // Green
    strengthPercent = '100%';
  }

  const checklistItems = [
    { label: 'At least 6 characters', valid: hasMinLength, required: true },
    { label: 'Contains a lowercase letter', valid: hasLowercase, required: true },
    { label: 'Contains an uppercase letter', valid: hasUppercase, required: false },
    { label: 'Contains a number', valid: hasNumber, required: true },
    { label: 'Contains a special character', valid: hasSpecial, required: false },
  ];

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      {/* Input wrapper */}
      <View style={styles.inputWrapper}>
        <Ionicons
          name="lock-closed-outline"
          size={18}
          color={colors.textMuted}
          style={styles.inputIcon}
        />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textLight}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
        />
        <TouchableOpacity
          style={styles.eyeButton}
          onPress={() => setShowPassword(!showPassword)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={showPassword ? 'eye-off-outline' : 'eye-outline'}
            size={18}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      </View>

      {/* Strength Bar */}
      {showStrengthBar && value.length > 0 && (
        <View style={styles.strengthContainer}>
          <View style={styles.strengthBarBackground}>
            <View
              style={[
                styles.strengthBarFill,
                { width: strengthPercent, backgroundColor: strengthColor },
              ]}
            />
          </View>
          <Text style={[styles.strengthText, { color: strengthColor }]}>
            {strengthLabel}
          </Text>
        </View>
      )}

      {/* Checklist */}
      {showChecklist && value.length > 0 && (
        <View style={styles.checklistContainer}>
          {checklistItems.map((item, index) => (
            <View key={index} style={styles.checklistItem}>
              <Ionicons
                name={item.valid ? 'checkmark-circle' : 'ellipse-outline'}
                size={14}
                color={item.valid ? '#16A34A' : colors.textLight}
                style={styles.checkIcon}
              />
              <Text
                style={[
                  styles.checklistLabel,
                  item.valid && styles.checklistLabelPassed,
                ]}
              >
                {item.label} {!item.required ? '(optional)' : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
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
    paddingLeft: 14,
    paddingRight: 6,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  eyeButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 10,
  },
  strengthBarBackground: {
    flex: 1,
    height: 4,
    backgroundColor: colors.borderLight,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthText: {
    fontSize: 11,
    fontWeight: '700',
    minWidth: 46,
    textAlign: 'right',
  },
  checklistContainer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkIcon: {
    marginRight: 6,
  },
  checklistLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  checklistLabelPassed: {
    color: colors.textPrimary,
    fontWeight: '500',
  },
});
