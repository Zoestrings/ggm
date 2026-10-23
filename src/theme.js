export const colors = {
  // Pure White Canvas (as approved)
  background: '#FFFFFF',
  surface: '#FFFFFF',          // Crisp floating card surface
  surfaceAlt: '#F1F4F9',       // Subtle section backing
  card: '#FFFFFF',

  // Primary Royal Brand (Official Royal Indigo Blue from GGM Logo)
  primary: '#403F91',          // Official GGM Royal Indigo Blue
  navy: '#403F91',             // Primary brand base
  primaryRoyal: '#403F91',     // Logo Royal Indigo
  primaryGradient: ['#403F91', '#2D2C6F'], // Rich gradient
  primaryLight: '#F3F2FC',
  primaryBorder: '#D8D5F5',

  // Subtle header gradient
  headerGradient: ['#ECEBFA', '#FFFFFF'],

  // Borders (ultra light & refined)
  border: '#E9EEF5',
  borderLight: '#F3F6FA',
  borderDark: '#CBD5E1',

  // Typography
  textPrimary: '#0F172A',      // Midnight Slate
  textSecondary: '#475569',    // Refined body text
  textMuted: '#64748B',        // Subtle caption gray
  textLight: '#94A3B8',

  // Accents & Badges
  goldAccent: '#D4AF37',       // Gold accent
  goldLight: '#FEF3C7',
  goldLine: '#D4AF37',
  success: '#10B981',
  successBg: '#ECFDF5',
  successBorder: '#A7F3D0',
  successText: '#047857',

  error: '#EF4444',
  errorBg: '#FEF2F2',
  errorBorder: '#FECACA',
  errorText: '#B91C1C',

  warning: '#F59E0B',
  warningBg: '#FFFBEB',
  warningBorder: '#FDE68A',
  warningText: '#B45309',

  neutralBg: '#F1F5F9',
  neutralBorder: '#E2E8F0',
  neutralText: '#475569',
};

export const fonts = {
  // Elegant serif for titles, greetings, and formal headings
  serif: 'PlayfairDisplay_700Bold',
  serifSemiBold: 'PlayfairDisplay_600SemiBold',
  serifRegular: 'PlayfairDisplay_400Regular',

  // Clean, high-legibility geometric sans-serif for UI & body
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
};

export const shadows = {
  // Floating Card Shadow with soft indigo tint
  card: {
    shadowColor: '#403F91',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  // Button & Active Card Lift
  lifted: {
    shadowColor: '#403F91',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 5,
  },
  // Subtle pill/chip shadow
  soft: {
    shadowColor: '#403F91',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pagePadding: 18,
};

export const typography = {
  headerTitle: {
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: colors.textPrimary,
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
    color: colors.textMuted,
  },
  pageTitle: {
    fontSize: 24,
    fontFamily: fonts.serif,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: fonts.sansBold,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: fonts.sansSemiBold,
    color: colors.textPrimary,
  },
  body: {
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  bodyBold: {
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
    color: colors.textPrimary,
  },
  caption: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.textMuted,
  },
};

export const globalStyles = {
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  watermark: {
    position: 'absolute',
    width: 320,
    height: 320,
    alignSelf: 'center',
    top: '28%',
    opacity: 0.06,
    zIndex: 0,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    ...shadows.card,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
    ...shadows.lifted,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: fonts.sansBold,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.textPrimary,
  },
};
