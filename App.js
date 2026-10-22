import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet, Image, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';

import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';

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
import UpdateModal from './src/components/UpdateModal';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarBackground: () => (
          <View style={{ flex: 1, backgroundColor: '#173B70' }} />
        ),
        tabBarStyle: {
          backgroundColor: '#173B70', // Solid Navy (#173B70)
          borderTopWidth: 1.5,
          borderTopColor: '#D4AF37', // Crisp Gold Top Border
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 24 : 8,
          elevation: 10,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.12,
          shadowRadius: 4,
        },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          paddingVertical: 2,
        },
        tabBarIconStyle: {
          marginTop: 2,
          marginBottom: 2,
        },
        tabBarActiveTintColor: '#D4AF37', // Active Gold
        tabBarInactiveTintColor: '#94A3B8', // Inactive Silver/Gray
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: 'Inter_600SemiBold',
          marginTop: 1,
          marginBottom: 2,
        },
      }}
    >
      <Tab.Screen
        name="HomeScreen"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="MemberHistoryTab"
        component={MemberHistoryScreen}
        options={{
          tabBarLabel: 'History',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'time' : 'time-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={AccountSettingsScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    PlayfairDisplay_400Regular,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
  });

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

  if (!fontsLoaded || loading) {
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
    <View style={styles.appContainer}>
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
          <Stack.Screen name="Home" component={MainTabs} />
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
      <UpdateModal />
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
