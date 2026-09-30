import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet, Image } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

import { supabase } from './src/lib/supabase';

// Core & Member Screens
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import CheckInScreen from './src/screens/CheckInScreen';
import CompleteProfileScreen from './src/screens/CompleteProfileScreen';
import MemberHistoryScreen from './src/screens/MemberHistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AccountSettingsScreen from './src/screens/AccountSettingsScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';

// Phase 3 & Historical Screens
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import AttendanceListScreen from './src/screens/AttendanceListScreen';
import AttendanceDetailScreen from './src/screens/AttendanceDetailScreen';
import FailedAttemptsScreen from './src/screens/FailedAttemptsScreen';
import AdminManagementScreen from './src/screens/AdminManagementScreen';
import GenerateReportScreen from './src/screens/GenerateReportScreen';
import PendingReviewScreen from './src/screens/PendingReviewScreen';

// Upgrade Screens (Sub-Admin & Super-Admin)
import SubAdminAttendanceScreen from './src/screens/SubAdminAttendanceScreen';
import SuperAdminDashboardScreen from './src/screens/SuperAdminDashboardScreen';
import TopPerformersScreen from './src/screens/TopPerformersScreen';
import ManageRolesScreen from './src/screens/ManageRolesScreen';
import AuditLogScreen from './src/screens/AuditLogScreen';
import AllAttendanceScreen from './src/screens/AllAttendanceScreen';

const Stack = createStackNavigator();

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check initial auth state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Image
          source={require('./assets/logo.png')}
          style={{ width: 90, height: 90, resizeMode: 'contain', marginBottom: 20 }}
        />
        <ActivityIndicator size="large" color="#173B70" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" />
      <Stack.Navigator
        initialRouteName={session ? "Home" : "Login"}
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: '#FFFFFF' },
        }}
      >
        {/* Auth & Member Screens */}
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="CheckIn" component={CheckInScreen} />
        <Stack.Screen name="CompleteProfile" component={CompleteProfileScreen} />
        <Stack.Screen name="MemberHistory" component={MemberHistoryScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />

        {/* Sub-Admin Screens */}
        <Stack.Screen name="SubAdminAttendance" component={SubAdminAttendanceScreen} />

        {/* Super-Admin Screens */}
        <Stack.Screen name="SuperAdminDashboard" component={SuperAdminDashboardScreen} />
        <Stack.Screen name="TopPerformers" component={TopPerformersScreen} />
        <Stack.Screen name="ManageRoles" component={ManageRolesScreen} />
        <Stack.Screen name="AuditLog" component={AuditLogScreen} />

        {/* Attendance & Management Screens */}
        <Stack.Screen name="AttendanceList" component={AttendanceListScreen} />
        <Stack.Screen name="AllAttendance" component={AllAttendanceScreen} />
        <Stack.Screen name="AttendanceDetail" component={AttendanceDetailScreen} />
        <Stack.Screen name="PendingReview" component={PendingReviewScreen} />
        <Stack.Screen name="GenerateReport" component={GenerateReportScreen} />
        <Stack.Screen name="FailedAttempts" component={FailedAttemptsScreen} />
        <Stack.Screen name="AdminManagement" component={AdminManagementScreen} />

        {/* Backward-compatibility route for older navigation calls */}
        <Stack.Screen name="AdminDashboard" component={SuperAdminDashboardScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
