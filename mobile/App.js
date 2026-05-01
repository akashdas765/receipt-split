import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

import { onAuthChange, logout } from './src/services/auth';
import { getDoc, doc } from 'firebase/firestore';
import { db } from './src/services/firebase';
import { session } from './src/services/session';

import LoginScreen   from './src/screens/LoginScreen';
import SignupScreen  from './src/screens/SignupScreen';
import HomeScreen    from './src/screens/HomeScreen';
import ScanScreen    from './src/screens/ScanScreen';
import DetailScreen  from './src/screens/DetailScreen';
import ApproveScreen from './src/screens/ApproveScreen';

const Stack  = createStackNavigator();
const INDIGO = '#6366f1';

export default function App() {
  const [user,     setUser]     = useState(undefined);
  const [hydrated, setHydrated] = useState(false);
  const [fontsLoaded] = useFonts(Ionicons.font);

  useEffect(() => {
    const unsub = onAuthChange(async (firebaseUser) => {
      if (firebaseUser) {
        if (!session.getKey()) {
          try {
            const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
            if (snap.exists()) {
              session.setKey(snap.data().splitwise_api_key);
              session.setUserId(firebaseUser.uid);
            }
          } catch {}
        }
        setUser(firebaseUser);
      } else {
        setUser(null);
      }
      setHydrated(true);
    });
    return unsub;
  }, []);

  if (!hydrated || !fontsLoaded) return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color={INDIGO} />
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.frame}>
        <NavigationContainer>
          <StatusBar style="dark" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: {
                backgroundColor: '#fff', elevation: 0, shadowOpacity: 0,
                borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
              },
              headerTintColor:  '#1e293b',
              headerTitleStyle: { fontWeight: '800', fontSize: 17 },
              cardStyle:        { backgroundColor: '#f8faff' },
            }}
          >
            {user ? (
              <>
                <Stack.Screen
                  name="Home"
                  component={HomeScreen}
                  options={({ navigation }) => ({
                    title: 'ReceiptSplit',
                    headerRight: () => (
                      <View style={styles.headerRight}>
                        <TouchableOpacity onPress={() => navigation.navigate('Scan')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="add-circle" size={28} color={INDIGO} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={logout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="log-out-outline" size={24} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    ),
                  })}
                />
                <Stack.Screen name="Scan"    component={ScanScreen}    options={{ headerShown: false }} />
                <Stack.Screen name="Detail"  component={DetailScreen}  options={{ title: 'Assign & Split' }} />
                <Stack.Screen name="Approve" component={ApproveScreen} options={{ title: 'Review & Post' }} />
              </>
            ) : (
              <>
                <Stack.Screen name="Login"  component={LoginScreen}  options={{ headerShown: false }} />
                <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8faff' },
  root: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? '#e0e7ff' : '#f8faff',
  },
  frame: {
    flex: 1,
    ...(Platform.OS === 'web' ? {
      maxWidth: 480,
      width: '100%',
      alignSelf: 'center',
      overflow: 'hidden',
      shadowColor: '#6366f1',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.15,
      shadowRadius: 40,
    } : {}),
  },
  headerRight: {
    flexDirection: 'row', alignItems: 'center',
    marginRight: 16, gap: 16,
  },
});
