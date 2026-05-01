import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { loadReceipts, deleteReceipt } from '../services/db';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';

export default function HomeScreen({ navigation }) {
  const [receipts,   setReceipts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const list = await loadReceipts();
      setReceipts(list);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, []));

  const confirmDelete = (id, merchant) => {
    const name = merchant || 'this receipt';
    if (Platform.OS === 'web') {
      if (window.confirm(`Remove "${name}"?`)) {
        deleteReceipt(id).then(() => setReceipts(r => r.filter(x => x.id !== id)));
      }
      return;
    }
    Alert.alert('Delete receipt', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteReceipt(id);
        setReceipts(r => r.filter(x => x.id !== id));
      }},
    ]);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => navigation.navigate('Detail', item)}>
      <View style={styles.cardLeft}>
        <View style={[styles.iconBox, { backgroundColor: item.approved ? EMERALD : INDIGO }]}>
          <Ionicons name={item.approved ? 'checkmark-done' : 'receipt-outline'} size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.merchant} numberOfLines={1}>
            {item.merchant || 'Unknown merchant'}
          </Text>
          <Text style={styles.meta}>
            {item.date || item.scanned_at?.slice(0, 10)}
            {' · '}
            <Text style={{ color: item.approved ? EMERALD : '#f59e0b', fontWeight: '700' }}>
              {item.approved ? 'Posted' : 'Pending'}
            </Text>
            {' · '}{item.items?.length || 0} items
          </Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        <Text style={styles.amount}>${(item.total || 0).toFixed(2)}</Text>
        <TouchableOpacity
          onPress={() => confirmDelete(item.id, item.merchant)}
          hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }}
          style={{ padding: 4 }}
        >
          <Ionicons name="trash-outline" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={INDIGO} /></View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={receipts}
        keyExtractor={r => r.id}
        renderItem={renderItem}
        contentContainerStyle={receipts.length === 0 ? styles.emptyContainer : styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={INDIGO} />
        }
        ListEmptyComponent={
          <View style={styles.emptyInner}>
            <Ionicons name="receipt-outline" size={72} color="#c7d2fe" />
            <Text style={styles.emptyTitle}>No receipts yet</Text>
            <Text style={styles.emptyHint}>Tap + above to scan your first one</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f8faff' },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent:    { padding: 16, paddingBottom: 32 },
  emptyContainer: { flexGrow: 1 },
  emptyInner:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle:     { fontSize: 18, fontWeight: '700', color: '#64748b', marginTop: 16 },
  emptyHint:      { fontSize: 14, color: '#94a3b8', marginTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  cardLeft:  { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  iconBox: {
    width: 42, height: 42, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
    flexShrink: 0,
  },
  merchant:  { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 3 },
  meta:      { fontSize: 12, color: '#94a3b8' },
  cardRight: { alignItems: 'flex-end', flexShrink: 0 },
  amount:    { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 6 },
});
