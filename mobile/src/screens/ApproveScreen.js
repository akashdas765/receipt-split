import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { postExpense } from '../services/splitwise';
import { saveReceipt } from '../services/db';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#10b981','#f97316','#06b6d4','#84cc16','#a855f7'];
function memberColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export default function ApproveScreen({ route, navigation }) {
  const { receiptId, groupId, members, personTotals, grandTotal, merchant } = route.params;
  const [paidBy,     setPaidBy]     = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const membersWithAmounts = members
    .map(m => ({ ...m, amount: personTotals[String(m.id)] || 0 }))
    .filter(m => m.amount > 0);

  const submit = async () => {
    if (!paidBy) {
      setError('Choose who paid the bill.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const activeMembers = members.filter(m => (personTotals[String(m.id)] || 0) > 0);
      await postExpense({
        description:  merchant || 'Receipt',
        groupId,
        paidById:     paidBy,
        personTotals: Object.fromEntries(
          Object.entries(personTotals).map(([k, v]) => [k, Math.round(v * 100) / 100])
        ),
        members: activeMembers,
      });
      if (receiptId) await saveReceipt({ ...route.params, approved: true });
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (e) {
      setError(e?.message || 'Could not post to Splitwise. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        <View style={styles.totalCard}>
          <Ionicons name="receipt-outline" size={32} color={INDIGO} />
          <Text style={styles.totalLabel}>{merchant || 'Receipt'}</Text>
          <Text style={styles.totalAmount}>${grandTotal.toFixed(2)}</Text>
          <Text style={styles.totalSub}>Total including tax</Text>
        </View>

        <Text style={styles.sectionTitle}>Split breakdown</Text>
        {membersWithAmounts.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="information-circle-outline" size={20} color="#94a3b8" />
            <Text style={styles.hint}>No items assigned — go back and assign members to items.</Text>
          </View>
        ) : membersWithAmounts.map(m => {
          const color = memberColor(m.name);
          return (
            <View key={m.id} style={styles.memberRow}>
              <View style={[styles.avatar, { backgroundColor: color }]}>
                <Text style={styles.avatarText}>{m.name?.[0]?.toUpperCase()}</Text>
              </View>
              <Text style={styles.memberName}>{m.name}</Text>
              <Text style={[styles.memberAmount, { color }]}>${m.amount.toFixed(2)}</Text>
            </View>
          );
        })}

        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Who paid?</Text>
        <View style={styles.payerGrid}>
          {members.map(m => {
            const color    = memberColor(m.name);
            const selected = paidBy === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.payerCard, selected && { borderColor: color, backgroundColor: color + '15' }]}
                onPress={() => { setPaidBy(m.id); setError(''); }}
                activeOpacity={0.8}
              >
                <View style={[styles.avatar, { backgroundColor: color }]}>
                  <Text style={styles.avatarText}>{m.name?.[0]?.toUpperCase()}</Text>
                </View>
                <Text style={[styles.payerName, selected && { color }]}>{m.name}</Text>
                {selected && <Ionicons name="checkmark-circle" size={16} color={color} />}
              </TouchableOpacity>
            );
          })}
        </View>

      </ScrollView>

      {/* Footer — natural flow, not absolute */}
      <View style={styles.footer}>
        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.postBtn, submitting && { opacity: 0.6 }]}
          onPress={submit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <><Ionicons name="cloud-upload-outline" size={22} color="#fff" /><Text style={styles.postBtnText}>  Post to Splitwise</Text></>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#f8faff' },
  scroll:       { flex: 1 },
  scrollContent:{ padding: 20, paddingBottom: 8 },
  totalCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    alignItems: 'center', marginBottom: 28,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  totalLabel:  { fontSize: 16, fontWeight: '700', color: '#1e293b', marginTop: 10 },
  totalAmount: { fontSize: 36, fontWeight: '800', color: INDIGO, marginTop: 4 },
  totalSub:    { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  sectionTitle:{ fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  emptyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8faff', borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: '#e2e8f0',
  },
  hint:        { flex: 1, color: '#94a3b8', fontSize: 13 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  avatar:       { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText:   { color: '#fff', fontWeight: '800', fontSize: 15 },
  memberName:   { flex: 1, fontSize: 15, fontWeight: '600', color: '#1e293b' },
  memberAmount: { fontSize: 16, fontWeight: '800' },
  payerGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  payerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff',
  },
  payerName:   { fontSize: 14, fontWeight: '600', color: '#64748b' },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'web' ? 16 : 28,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef2f2', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10,
  },
  errorText: { flex: 1, color: '#ef4444', fontSize: 13, fontWeight: '600' },
  postBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: INDIGO, borderRadius: 16, paddingVertical: 16,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  postBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
