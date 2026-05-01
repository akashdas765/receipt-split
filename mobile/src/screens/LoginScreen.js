import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { login } from '../services/auth';

const INDIGO = '#6366f1';

export default function LoginScreen({ navigation }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setError(e.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <View style={styles.logoBox}>
          <Ionicons name="receipt-outline" size={40} color="#fff" />
        </View>
        <Text style={styles.appName}>ReceiptSplit</Text>
        <Text style={styles.tagline}>Sign in to your account</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <View style={styles.inputRow}>
          <Ionicons name="mail-outline" size={18} color="#94a3b8" />
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={v => { setEmail(v); setError(''); }}
            placeholder="you@example.com"
            placeholderTextColor="#cbd5e1"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>

        <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
        <View style={styles.inputRow}>
          <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={v => { setPassword(v); setError(''); }}
            placeholder="••••••••"
            placeholderTextColor="#cbd5e1"
            secureTextEntry={!showPw}
            autoComplete="current-password"
          />
          <TouchableOpacity onPress={() => setShowPw(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.btn, loading && { opacity: 0.6 }]}
          onPress={submit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.btnText}>Sign In</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.switchRow} onPress={() => navigation.navigate('Signup')}>
        <Text style={styles.switchText}>Don't have an account? </Text>
        <Text style={[styles.switchText, { color: INDIGO, fontWeight: '700' }]}>Sign Up</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#f8faff', padding: 24, justifyContent: 'center' },
  hero:      { alignItems: 'center', marginBottom: 32 },
  logoBox: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: INDIGO, alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 8,
  },
  appName:  { fontSize: 26, fontWeight: '800', color: '#1e293b' },
  tagline:  { fontSize: 14, color: '#94a3b8', marginTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
    marginBottom: 20,
  },
  label:    { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#f8faff',
  },
  input:    { flex: 1, fontSize: 15, color: '#1e293b', padding: 0 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef2f2', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 12,
  },
  errorText: { flex: 1, color: '#ef4444', fontSize: 13, fontWeight: '600' },
  btn: {
    backgroundColor: INDIGO, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 20,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  btnText:    { color: '#fff', fontSize: 16, fontWeight: '700' },
  switchRow:  { flexDirection: 'row', justifyContent: 'center' },
  switchText: { fontSize: 14, color: '#64748b' },
});
