import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { colors, spacing } from '../theme';

export default function AdminManagementScreen({ navigation }) {
  const [currentSuperAdmin, setCurrentSuperAdmin] = useState(null);
  const [adminsList, setAdminsList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Add Admin Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminPhone, setNewAdminPhone] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [creating, setCreating] = useState(false);

  // Newly Created Admin Credential Banner
  const [createdCredentials, setCreatedCredentials] = useState(null);

  useEffect(() => {
    loadAdmins();
  }, []);

  const loadAdmins = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentSuperAdmin(user);

      const { data, error } = await supabase
        .from('users')
        .select('*')
        .in('role', ['admin', 'super_admin'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setAdminsList(data || []);
    } catch (err) {
      console.error('Error loading admins:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    const randomTempPass = 'GGM' + Math.floor(100000 + Math.random() * 900000);
    setNewAdminName('');
    setNewAdminUsername('');
    setNewAdminPhone('');
    setNewAdminEmail('');
    setTempPassword(randomTempPass);
    setCreatedCredentials(null);
    setModalVisible(true);
  };

  const handleCreateAdmin = async () => {
    if (!newAdminName.trim() || !newAdminUsername.trim() || !newAdminPhone.trim()) {
      Alert.alert('Incomplete Fields', 'Please fill in the admin full name, username, and phone number.');
      return;
    }

    setCreating(true);
    try {
      const authEmail = newAdminEmail.trim() || `${newAdminUsername.trim().toLowerCase()}@ggm-admin.internal`;
      
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: authEmail,
        password: tempPassword,
        options: {
          data: {
            full_name: newAdminName.trim(),
            username: newAdminUsername.trim().toLowerCase(),
            phone: newAdminPhone.trim(),
            role: 'admin',
          },
        },
      });

      if (authError) throw authError;

      const newUserId = authData?.user?.id;
      const nowIso = new Date().toISOString();

      if (newUserId) {
        const { error: dbError } = await supabase.from('users').upsert({
          id: newUserId,
          name: newAdminName.trim(),
          username: newAdminUsername.trim().toLowerCase(),
          phone: newAdminPhone.trim(),
          email: authEmail,
          role: 'admin',
          must_change_pw: true,
          created_by: currentSuperAdmin?.id,
          provisioned_at: nowIso,
          created_at: nowIso,
        });

        if (dbError) throw dbError;
      }

      await logAudit({
        actorId: currentSuperAdmin?.id,
        action: 'create_admin',
        entity: 'users',
        entityId: newUserId,
        newValue: { name: newAdminName, username: newAdminUsername, role: 'admin' },
        reason: 'Super Admin provisioned new departmental admin',
      });

      setCreatedCredentials({
        name: newAdminName,
        username: newAdminUsername,
        phone: newAdminPhone,
        tempPassword: tempPassword,
      });

      setModalVisible(false);
      loadAdmins();
    } catch (err) {
      Alert.alert('Creation Failed', err.message || 'Could not provision new admin.');
    } finally {
      setCreating(false);
    }
  };

  const handleAdminActionPrompt = (admin) => {
    if (admin.id === currentSuperAdmin?.id) {
      Alert.alert('Your Account', 'This is your primary administrator account.');
      return;
    }

    Alert.alert(
      `Manage Admin: ${admin.name}`,
      `Username: @${admin.username || 'admin'}\nPhone: ${admin.phone}\nRole: ${admin.role.toUpperCase()}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Temporary Password',
          onPress: () => handleResetTempPass(admin),
        },
        {
          text: 'Revoke Admin Privileges',
          style: 'destructive',
          onPress: () => handleRevokeAdmin(admin),
        },
      ]
    );
  };

  const handleResetTempPass = async (admin) => {
    const newPass = 'GGM' + Math.floor(100000 + Math.random() * 900000);
    try {
      const { error } = await supabase
        .from('users')
        .update({ must_change_pw: true })
        .eq('id', admin.id);

      if (error) throw error;

      await logAudit({
        actorId: currentSuperAdmin?.id,
        action: 'reset_admin_password',
        entity: 'users',
        entityId: admin.id,
        reason: 'Super Admin forced password reset',
      });

      Alert.alert(
        'Password Reset Generated',
        `Admin: ${admin.name}\nUsername: ${admin.username}\nTemporary Password: ${newPass}\n\nPlease share these credentials securely.`
      );
      loadAdmins();
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const handleRevokeAdmin = async (admin) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ role: 'member' })
        .eq('id', admin.id);

      if (error) throw error;

      await logAudit({
        actorId: currentSuperAdmin?.id,
        action: 'revoke_admin',
        entity: 'users',
        entityId: admin.id,
        oldValue: { role: 'admin' },
        newValue: { role: 'member' },
        reason: 'Super Admin demoted admin to standard member',
      });

      Alert.alert('Admin Revoked', `${admin.name} has been returned to member status.`);
      loadAdmins();
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  const renderItem = ({ item }) => {
    const isSuper = item.role === 'super_admin';
    const isPending = item.must_change_pw;

    return (
      <TouchableOpacity
        style={styles.adminCard}
        onPress={() => handleAdminActionPrompt(item)}
        activeOpacity={0.7}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.name?.charAt(0).toUpperCase() || 'A'}</Text>
        </View>

        <View style={styles.adminMeta}>
          <View style={styles.nameRow}>
            <Text style={styles.adminName}>{item.name || 'Admin User'}</Text>
            {isSuper && (
              <Ionicons name="shield-checkmark" size={14} color={colors.primary} style={{ marginLeft: 4 }} />
            )}
          </View>
          <Text style={styles.adminHandle}>@{item.username || 'admin'} • {item.phone || 'No phone'}</Text>
        </View>

        <View style={styles.badgeContainer}>
          {isPending ? (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>PENDING SETUP</Text>
            </View>
          ) : (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>{isSuper ? 'SUPER ADMIN' : 'ACTIVE ADMIN'}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
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
          <Text style={styles.headerTitle}>Department Admins</Text>
          <Text style={styles.headerSubtitle}>GGM Instrumentalists</Text>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={handleOpenAddModal} activeOpacity={0.8}>
          <Ionicons name="add" size={16} color="#FFFFFF" style={{ marginRight: 2 }} />
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Temporary Credentials Banner if created */}
      {createdCredentials && (
        <View style={styles.credsBanner}>
          <View style={styles.credsHeaderRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.successText} />
            <Text style={styles.credsTitle}>Admin Provisioned Successfully</Text>
          </View>
          <Text style={styles.credsDesc}>Share these initial login credentials with {createdCredentials.name}:</Text>
          <View style={styles.credsBox}>
            <Text style={styles.credsRow}>Username: <Text style={styles.credsVal}>@{createdCredentials.username}</Text></Text>
            <Text style={styles.credsRow}>Phone: <Text style={styles.credsVal}>{createdCredentials.phone}</Text></Text>
            <Text style={styles.credsRow}>Temp Password: <Text style={styles.credsValHighlight}>{createdCredentials.tempPassword}</Text></Text>
          </View>
          <TouchableOpacity
            style={styles.dismissCredsButton}
            onPress={() => setCreatedCredentials(null)}
            activeOpacity={0.7}
          >
            <Text style={styles.dismissCredsText}>Done Sharing</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={[styles.container, styles.centered]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={adminsList}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}

      {/* Add Admin Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Provision New Admin</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)} activeOpacity={0.7}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalSubtitle}>
                Create an administrator account for GGM Instrumentalists department management.
              </Text>

              <Text style={styles.modalLabel}>Full Name</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. David Okon"
                placeholderTextColor={colors.textLight}
                value={newAdminName}
                onChangeText={setNewAdminName}
                autoCapitalize="words"
              />

              <Text style={styles.modalLabel}>Username (for login)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. david_okon"
                placeholderTextColor={colors.textLight}
                value={newAdminUsername}
                onChangeText={setNewAdminUsername}
                autoCapitalize="none"
              />

              <Text style={styles.modalLabel}>Phone Number</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 08012345678"
                placeholderTextColor={colors.textLight}
                value={newAdminPhone}
                onChangeText={setNewAdminPhone}
                keyboardType="phone-pad"
              />

              <Text style={styles.modalLabel}>Email (Optional)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. david@gmail.com"
                placeholderTextColor={colors.textLight}
                value={newAdminEmail}
                onChangeText={setNewAdminEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.modalLabel}>Generated Temp Password</Text>
              <TextInput
                style={[styles.modalInput, styles.tempPassInput]}
                value={tempPassword}
                editable={false}
              />

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => setModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalSubmitButton}
                  onPress={handleCreateAdmin}
                  disabled={creating}
                  activeOpacity={0.85}
                >
                  {creating ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.modalSubmitText}>Provision Admin</Text>
                  )}
                </TouchableOpacity>
              </View>
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  credsBanner: {
    marginHorizontal: spacing.pagePadding,
    marginTop: 12,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: 10,
    padding: 14,
  },
  credsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  credsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    marginLeft: 6,
  },
  credsDesc: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  credsBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 10,
  },
  credsRow: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 3,
  },
  credsVal: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  credsValHighlight: {
    color: colors.primary,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  dismissCredsButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 4,
  },
  dismissCredsText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: 12,
    paddingBottom: 24,
  },
  adminCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  adminMeta: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  adminName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  adminHandle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  badgeContainer: {
    marginLeft: 8,
  },
  pendingBadge: {
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pendingBadgeText: {
    color: colors.warningText,
    fontSize: 10,
    fontWeight: '700',
  },
  activeBadge: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  activeBadgeText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: spacing.pagePadding,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 14,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
    marginTop: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
  },
  tempPassInput: {
    backgroundColor: colors.surface,
    color: colors.primary,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  modalCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  modalCancelText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  modalSubmitButton: {
    flex: 1.5,
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
