import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet, Image } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

import { supabase } from './src/lib/supabase';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import HomeScreen from './src/screens/HomeScreen';
import CheckInScreen from './src/screens/CheckInScreen';
import CompleteProfileScreen from './src/screens/CompleteProfileScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import AttendanceListScreen from './src/screens/AttendanceListScreen';
import AttendanceDetailScreen from './src/screens/AttendanceDetailScreen';
import FailedAttemptsScreen from './src/screens/FailedAttemptsScreen';
import AdminManagementScreen from './src/screens/AdminManagementScreen';
import GenerateReportScreen from './src/screens/GenerateReportScreen';
import MemberHistoryScreen from './src/screens/MemberHistoryScreen';
import PendingReviewScreen from './src/screens/PendingReviewScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AccountSettingsScreen from './src/screens/AccountSettingsScreen';

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

        {/* Phase 3 Admin Screens */}
        <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
        <Stack.Screen name="AttendanceList" component={AttendanceListScreen} />
        <Stack.Screen name="AttendanceDetail" component={AttendanceDetailScreen} />
        <Stack.Screen name="FailedAttempts" component={FailedAttemptsScreen} />
        <Stack.Screen name="AdminManagement" component={AdminManagementScreen} />
        <Stack.Screen name="GenerateReport" component={GenerateReportScreen} />
        <Stack.Screen name="MemberHistory" component={MemberHistoryScreen} />
        <Stack.Screen name="PendingReview" component={PendingReviewScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
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
