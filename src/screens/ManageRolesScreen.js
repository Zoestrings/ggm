import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

export default function ManageRolesScreen({ navigation }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [usersList, setUsersList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigation.replace('Login');
        return;
      }
      setCurrentUser(user);

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('role', { ascending: false })
        .order('name', { ascending: true });

      if (error) throw error;
      setUsersList(data || []);
    } catch (err) {
      console.error('Error loading users for role management:', err);
      Alert.alert('Error', err.message || 'Failed to load user directory.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadUsers();
  };

  const superAdmins = usersList.filter((u) => u.role === 'super_admin');
  const subAdmins = usersList.filter((u) => u.role === 'sub_admin');
  const members = usersList.filter((u) => u.role !== 'super_admin' && u.role !== 'sub_admin');

  // Filter members based on search
  const filteredMembers = members.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = m.name?.toLowerCase().includes(q);
    const phoneMatch = m.phone?.includes(q);
    const emailMatch = m.email?.toLowerCase().includes(q);
    const instMatch = m.instrument?.toLowerCase().includes(q);
    return nameMatch || phoneMatch || emailMatch || instMatch;
  });

  const handlePromoteToSubAdmin = (user) => {
    Alert.alert(
      'Promote to Sub Admin',
      `Assign ${user.name || 'this member'} as a Sub Admin? They will have view-only access to monthly attendance lists.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Promote',
          onPress: async () => {
            setActionLoadingId(user.id);
            try {
              const { error } = await supabase.rpc('promote_to_sub_admin', { target: user.id });
              if (error) throw error;
              Alert.alert('Success', `${user.name} is now a Sub Admin.`);
              loadUsers();
            } catch (err) {
              Alert.alert('Promotion Error', err.message || 'Could not promote user.');
            } finally {
              setActionLoadingId(null);
            }
          },
        },
      ]
    );
  };

  const handleDemoteToMember = (user) => {
    if (user.role === 'super_admin' && superAdmins.length <= 1) {
      Alert.alert('Action Blocked', 'Cannot demote the last remaining Super Admin. At least 1 super admin must exist at all times.');
      return;
    }

    Alert.alert(
      'Demote to Member',
      `Demote ${user.name || 'this user'} to regular Member status?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Demote',
          style: 'destructive',
          onPress: async () => {
            setActionLoadingId(user.id);
            try {
              const { error } = await supabase.rpc('demote_to_member', { target: user.id });
              if (error) throw error;
              Alert.alert('Success', `${user.name} has been set to Member.`);
              loadUsers();
            } catch (err) {
              Alert.alert('Demotion Error', err.message || 'Could not demote user.');
            } finally {
              setActionLoadingId(null);
            }
          },
        },
      ]
    );
  };

  const handlePromoteToSuperAdmin = (user) => {
    const isAddingThird = superAdmins.length >= 2;
    const warningMessage = isAddingThird
      ? `You currently have ${superAdmins.length} Super Admins. Adding more is allowed, but 2 is recommended for the department.\n\nPromote ${user.name} to Super Admin?`
      : `Promote ${user.name} to Super Admin? They will receive full administrative access.`;

    Alert.alert('Assign Super Admin', warningMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm Promotion',
        onPress: async () => {
          setActionLoadingId(user.id);
          try {
            const { error } = await supabase.rpc('transfer_super_admin', { target: user.id });
            if (error) throw error;
            Alert.alert('Success', `${user.name} is now a Super Admin.`);
            loadUsers();
          } catch (err) {
            Alert.alert('Action Error', err.message || 'Failed to assign super admin role.');
          } finally {
            setActionLoadingId(null);
          }
        },
      },
    ]);
  };

  const renderAdminItem = (item, isSuper) => {
    const isLoading = actionLoadingId === item.id;
    const isSelf = currentUser?.id === item.id;

    return (
      <View key={item.id} style={styles.userCard}>
        <View style={styles.userCardHeader}>
          <View style={[styles.roleIconCircle, isSuper ? styles.roleIconSuper : styles.roleIconSub]}>
            <Ionicons
              name={isSuper ? 'shield-checkmark' : 'eye'}
              size={16}
              color={isSuper ? colors.primary : '#334155'}
            />
          </View>
          <View style={styles.userInfoCol}>
            <View style={styles.nameRow}>
              <Text style={styles.userName}>{item.name || 'User'}</Text>
              {isSelf && <Text style={styles.selfBadge}>(You)</Text>}
            </View>
            <Text style={styles.userSub}>{item.instrument || 'Instrumentalist'} • {item.phone || item.email || ''}</Text>
          </View>
        </View>

        {/* Action Controls */}
        <View style={styles.actionRow}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              {!isSuper && (
                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={() => handlePromoteToSuperAdmin(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.btnSecondaryText}>Make Super Admin</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.btnDanger}
                onPress={() => handleDemoteToMember(item)}
                activeOpacity={0.7}
                disabled={isSuper && superAdmins.length <= 1}
              >
                <Text style={[styles.btnDangerText, isSuper && superAdmins.length <= 1 && { opacity: 0.4 }]}>
                  Demote to Member
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderMemberItem = ({ item }) => {
    const isLoading = actionLoadingId === item.id;

    return (
      <View style={styles.memberCard}>
        <View style={styles.memberInfoCol}>
          <Text style={styles.memberName}>{item.name || 'Member'}</Text>
          <Text style={styles.memberDetails}>
            {item.instrument || 'Instrumentalist'} • {item.phone || item.email || '—'}
          </Text>
        </View>

        <View style={styles.memberActionCol}>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <TouchableOpacity
              style={styles.btnPromote}
              onPress={() => handlePromoteToSubAdmin(item)}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-up" size={12} color={colors.primary} style={{ marginRight: 2 }} />
              <Text style={styles.btnPromoteText}>Make Sub Admin</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
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
          <Text style={styles.headerTitle}>Manage Roles</Text>
          <Text style={styles.headerSubtitle}>Super Admin Control Panel</Text>
        </View>
      </View>

      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading role directory...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredMembers}
          keyExtractor={(item) => item.id}
          renderItem={renderMemberItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <View>
              {/* Soft Warning Banner if 3+ super admins */}
              {superAdmins.length > 2 && (
                <View style={styles.warningBanner}>
                  <Ionicons name="information-circle" size={18} color="#B45309" style={{ marginRight: 6 }} />
                  <Text style={styles.warningBannerText}>
                    You currently have {superAdmins.length} Super Admins. 2 is recommended for the department.
                  </Text>
                </View>
              )}

              {/* ── 1. Super Admins Section ── */}
              <View style={styles.sectionHeader}>
                <Ionicons name="shield-checkmark" size={16} color={colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>SUPER ADMINS ({superAdmins.length})</Text>
              </View>
              <Text style={styles.sectionDesc}>Full departmental control, role management & PDF generation.</Text>
              {superAdmins.map((item) => renderAdminItem(item, true))}

              {/* ── 2. Sub Admins Section ── */}
              <View style={[styles.sectionHeader, { marginTop: 20 }]}>
                <Ionicons name="eye" size={16} color={colors.textSecondary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>SUB ADMINS ({subAdmins.length})</Text>
              </View>
              <Text style={styles.sectionDesc}>Read-only access to current attendance sessions for yearly compilation.</Text>
              {subAdmins.length > 0 ? (
                subAdmins.map((item) => renderAdminItem(item, false))
              ) : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyCardText}>No Sub Admins assigned yet. Promote members below.</Text>
                </View>
              )}

              {/* ── 3. Members Directory Header & Search ── */}
              <View style={[styles.sectionHeader, { marginTop: 24 }]}>
                <Ionicons name="people" size={16} color={colors.textMuted} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>MEMBERS DIRECTORY ({members.length})</Text>
              </View>

              <View style={styles.searchWrapper}>
                <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search members to promote..."
                  placeholderTextColor={colors.textLight}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="none"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyListWrap}>
              <Text style={styles.emptyListText}>No matching members found.</Text>
            </View>
          }
        />
      )}
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
  listContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 16,
    paddingBottom: 40,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  warningBannerText: {
    fontSize: 12,
    color: '#92400E',
    flex: 1,
    lineHeight: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  sectionDesc: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 10,
  },
  userCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  userCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  roleIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  roleIconSuper: {
    backgroundColor: colors.primaryLight,
  },
  roleIconSub: {
    backgroundColor: colors.surfaceAlt,
  },
  userInfoCol: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  selfBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    marginLeft: 6,
  },
  userSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  btnSecondary: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  btnDanger: {
    backgroundColor: colors.errorBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  btnDangerText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.errorText,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
  },
  emptyCardText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
  },
  memberCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  memberInfoCol: {
    flex: 1,
    marginRight: 10,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  memberDetails: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  memberActionCol: {
    alignItems: 'flex-end',
  },
  btnPromote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  btnPromoteText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  emptyListWrap: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyListText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
