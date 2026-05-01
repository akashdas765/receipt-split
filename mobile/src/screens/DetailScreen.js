import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Switch, Modal, Pressable, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchGroups } from '../services/splitwise';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';
const CATS    = ['food', 'drink', 'alcohol', 'fee', 'tip', 'other'];

const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#10b981','#f97316','#06b6d4','#84cc16','#a855f7'];
function memberColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const FOOD_CATS = ['food', 'drink'];
function isTaxable(item, isGrocery) {
  if (item.tax_exempt) return false;
  if (isGrocery && FOOD_CATS.includes((item.category || '').toLowerCase())) return false;
  return true;
}

function CatDropdown({ visible, onSelect, onClose, current }) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={dd.backdrop} onPress={onClose}>
        <View style={dd.sheet}>
          <Text style={dd.title}>Category</Text>
          {CATS.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[dd.option, current === cat && dd.optionActive]}
              onPress={() => { onSelect(cat); onClose(); }}
            >
              <Text style={[dd.optionText, current === cat && { color: INDIGO, fontWeight: '700' }]}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </Text>
              {current === cat && <Ionicons name="checkmark" size={16} color={INDIGO} />}
            </TouchableOpacity>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

export default function DetailScreen({ route, navigation }) {
  const receipt = route.params;

  const [items,         setItems]         = useState(receipt.items || []);
  const [merchant,      setMerchant]      = useState(receipt.merchant || '');
  const [date,          setDate]          = useState(receipt.date     || '');
  const [groups,        setGroups]        = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [members,       setMembers]       = useState([]);
  const [isGrocery,     setIsGrocery]     = useState(false);
  const [taxRate,       setTaxRate]       = useState('7');
  const [loading,       setLoading]       = useState(true);
  const [swError,       setSwError]       = useState('');
  const [dropdownItem,  setDropdownItem]  = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    fetchGroups()
      .then(grps => {
        setGroups(grps);
        if (grps.length > 0) {
          setSelectedGroup(grps[0].id);
          setMembers(grps[0].members);
        }
      })
      .catch(() => setSwError('Could not load Splitwise groups. Check your API key.'))
      .finally(() => setLoading(false));
  }, []);

  const switchGroup = (gid) => {
    const grp = groups.find(g => g.id === gid);
    setSelectedGroup(gid);
    setMembers(grp?.members || []);
    setItems(prev => prev.map(i => ({ ...i, split_members: [] })));
  };

  const updateItem = (id, field, value) =>
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));

  const deleteItem = (id) =>
    setItems(prev => prev.filter(item => item.id !== id));

  const addItem = () =>
    setItems(prev => [...prev, {
      id: String(Date.now()), description: 'New item', quantity: 1,
      amount: 0, category: 'other', tax_exempt: 0, split_members: [],
    }]);

  const toggleMember = (itemId, memberId) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const ids = item.split_members || [];
      const mid = String(memberId);
      return { ...item, split_members: ids.includes(mid) ? ids.filter(x => x !== mid) : [...ids, mid] };
    }));
  };

  const splitAll = (itemId) => {
    const allIds = members.map(m => String(m.id));
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const cur = item.split_members || [];
      return { ...item, split_members: cur.length === allIds.length ? [] : allIds };
    }));
  };

  const toggleTaxExempt = (id) =>
    setItems(prev => prev.map(item => item.id === id ? { ...item, tax_exempt: item.tax_exempt ? 0 : 1 } : item));

  const txRate = parseFloat(taxRate) / 100 || 0;

  const subtotalBeforeTax = () =>
    items.reduce((s, item) => s + (parseFloat(item.amount) || 0), 0);

  const totalTaxAmount = () =>
    items.reduce((s, item) => {
      const base = parseFloat(item.amount) || 0;
      return s + (isTaxable(item, isGrocery) ? base * txRate : 0);
    }, 0);

  const grandTotal = () =>
    items.reduce((s, item) => {
      const base = parseFloat(item.amount) || 0;
      return s + (isTaxable(item, isGrocery) ? base * (1 + txRate) : base);
    }, 0);

  const calcPersonTotals = () => {
    const totals = {};
    items.forEach(item => {
      const ids = item.split_members || [];
      if (!ids.length) return;
      const base  = parseFloat(item.amount) || 0;
      const total = isTaxable(item, isGrocery) ? base * (1 + txRate) : base;
      const share = total / ids.length;
      ids.forEach(id => { totals[id] = (totals[id] || 0) + share; });
    });
    return totals;
  };

  if (loading) return (
    <View style={styles.center}><ActivityIndicator size="large" color={INDIGO} /></View>
  );

  const ddItem = items.find(i => i.id === dropdownItem);

  return (
    <View style={styles.screen}>
      <CatDropdown
        visible={!!dropdownItem}
        current={ddItem?.category}
        onSelect={cat => updateItem(dropdownItem, 'category', cat)}
        onClose={() => setDropdownItem(null)}
      />

      <Modal transparent visible={showBreakdown} animationType="fade" onRequestClose={() => setShowBreakdown(false)}>
        <Pressable style={dd.backdrop} onPress={() => setShowBreakdown(false)}>
          <View style={dd.sheet}>
            <Text style={dd.title}>Total Breakdown</Text>
            <View style={bk.row}>
              <Text style={bk.label}>Subtotal (before tax)</Text>
              <Text style={bk.value}>${subtotalBeforeTax().toFixed(2)}</Text>
            </View>
            <View style={bk.row}>
              <Text style={bk.label}>Tax ({taxRate}%)</Text>
              <Text style={[bk.value, { color: '#f59e0b' }]}>+${totalTaxAmount().toFixed(2)}</Text>
            </View>
            <View style={[bk.row, bk.totalRow]}>
              <Text style={bk.totalLabel}>Total after tax</Text>
              <Text style={bk.totalValue}>${grandTotal().toFixed(2)}</Text>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Scrollable content — flex: 1 so it fills space above footer */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {swError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={15} color="#ef4444" />
            <Text style={styles.errorText}>{swError}</Text>
          </View>
        ) : null}

        {/* Stats 2×2 grid */}
        <View style={styles.statsGrid}>
          {/* Row 1 */}
          <View style={styles.statsRow}>
            <View style={[styles.statBox, { flex: 1 }]}>
              <View style={styles.statHeader}>
                <Ionicons name="storefront-outline" size={14} color={INDIGO} />
                <Text style={styles.statLabel}>Merchant</Text>
              </View>
              <TextInput
                style={styles.statInput}
                value={merchant}
                onChangeText={setMerchant}
                placeholder="Enter merchant"
                placeholderTextColor="#cbd5e1"
              />
            </View>
            <View style={[styles.statBox, { flex: 1 }]}>
              <View style={styles.statHeader}>
                <Ionicons name="calendar-outline" size={14} color={INDIGO} />
                <Text style={styles.statLabel}>Date</Text>
              </View>
              <TextInput
                style={styles.statInput}
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#cbd5e1"
              />
            </View>
          </View>
          {/* Row 2 */}
          <View style={styles.statsRow}>
            <View style={[styles.statBox, { flex: 1 }]}>
              <View style={styles.statHeader}>
                <Ionicons name="list-outline" size={14} color={INDIGO} />
                <Text style={styles.statLabel}>Items</Text>
              </View>
              <Text style={styles.statValue}>{items.length}</Text>
            </View>
            <TouchableOpacity
              style={[styles.statBox, styles.statBoxTappable, { flex: 1 }]}
              onPress={() => setShowBreakdown(true)}
              activeOpacity={0.75}
            >
              <View style={styles.statHeader}>
                <Ionicons name="cash-outline" size={14} color={INDIGO} />
                <Text style={[styles.statLabel, { color: INDIGO }]}>Total ↗</Text>
              </View>
              <Text style={[styles.statValue, { color: INDIGO }]}>${grandTotal().toFixed(2)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Group selector */}
        <Text style={styles.sectionTitle}>Splitwise Group</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll}>
          {groups.map(g => (
            <TouchableOpacity
              key={g.id}
              style={[styles.groupPill, selectedGroup === g.id && styles.groupPillActive]}
              onPress={() => switchGroup(g.id)}
            >
              <Text style={[styles.groupPillText, selectedGroup === g.id && { color: '#fff' }]}>{g.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Tax & Grocery controls */}
        <View style={styles.controlsRow}>
          <View style={styles.taxInput}>
            <Ionicons name="pricetag-outline" size={14} color="#64748b" />
            <TextInput
              style={styles.taxField}
              value={taxRate}
              onChangeText={setTaxRate}
              keyboardType="decimal-pad"
              maxLength={5}
            />
            <Text style={styles.taxLabel}>% tax</Text>
          </View>
          <View style={styles.groceryToggle}>
            <Ionicons name="basket-outline" size={14} color={isGrocery ? EMERALD : '#64748b'} />
            <Text style={[styles.groceryLabel, isGrocery && { color: EMERALD }]}>Grocery</Text>
            <Switch
              value={isGrocery}
              onValueChange={setIsGrocery}
              trackColor={{ false: '#e2e8f0', true: EMERALD }}
              thumbColor="#fff"
              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
            />
          </View>
        </View>

        {/* Items */}
        <View style={styles.itemsHeader}>
          <Text style={styles.sectionTitle}>Items</Text>
          <TouchableOpacity style={styles.addBtn} onPress={addItem}>
            <Ionicons name="add" size={16} color={INDIGO} />
            <Text style={styles.addBtnText}>Add item</Text>
          </TouchableOpacity>
        </View>

        {items.map(item => {
          const taxable   = isTaxable(item, isGrocery);
          const base      = parseFloat(item.amount) || 0;
          const lineTotal = taxable ? base * (1 + txRate) : base;
          const assigned  = item.split_members || [];

          return (
            <View key={item.id} style={styles.txnCard}>
              <View style={styles.editRow}>
                <TextInput
                  style={[styles.editInput, { flex: 1, fontWeight: '700', fontSize: 14 }]}
                  value={item.description}
                  onChangeText={v => updateItem(item.id, 'description', v)}
                  placeholder="Item name"
                  placeholderTextColor="#cbd5e1"
                />
                <TouchableOpacity onPress={() => deleteItem(item.id)} style={styles.deleteBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              </View>

              <View style={styles.amountRow}>
                <View style={styles.numField}>
                  <Text style={styles.fieldLabel}>Qty</Text>
                  <TextInput
                    style={styles.numInput}
                    value={String(item.quantity)}
                    onChangeText={v => updateItem(item.id, 'quantity', parseInt(v) || 1)}
                    keyboardType="number-pad"
                    maxLength={3}
                  />
                </View>
                <Text style={styles.fieldSep}>×</Text>
                <View style={styles.numField}>
                  <Text style={styles.fieldLabel}>$</Text>
                  <TextInput
                    style={[styles.numInput, { minWidth: 56 }]}
                    value={String(item.amount)}
                    onChangeText={v => updateItem(item.id, 'amount', v)}
                    keyboardType="decimal-pad"
                    maxLength={8}
                  />
                </View>
                <Text style={styles.lineTotal}>${lineTotal.toFixed(2)}</Text>
                <TouchableOpacity onPress={() => toggleTaxExempt(item.id)}>
                  <View style={[styles.taxBadge, item.tax_exempt && styles.taxBadgeFree]}>
                    <Text style={styles.taxBadgeText}>{item.tax_exempt ? 'Tax-free' : 'Taxed'}</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.catTrigger} onPress={() => setDropdownItem(item.id)}>
                <Ionicons name="grid-outline" size={13} color="#64748b" />
                <Text style={styles.catTriggerText}>
                  {(item.category || 'other').charAt(0).toUpperCase() + (item.category || 'other').slice(1)}
                </Text>
                <Ionicons name="chevron-down" size={13} color="#94a3b8" />
              </TouchableOpacity>

              <View style={styles.memberRow}>
                {members.map(m => {
                  const active = assigned.includes(String(m.id));
                  const color  = memberColor(m.name);
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.memberPill, active && { backgroundColor: color, borderColor: color }]}
                      onPress={() => toggleMember(item.id, m.id)}
                    >
                      {active && (
                        <View style={[styles.avatar, { backgroundColor: color + '33' }]}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color }}>{m.name?.[0]?.toUpperCase()}</Text>
                        </View>
                      )}
                      <Text style={[styles.memberPillText, active && { color: '#fff' }]}>{m.name}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={styles.splitAllBtn} onPress={() => splitAll(item.id)}>
                  <Text style={styles.splitAllText}>{assigned.length === members.length ? 'Clear' : 'All'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Footer — natural flow, not absolute */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.approveBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Approve', {
            receiptId:    receipt.id,
            groupId:      selectedGroup,
            members,
            personTotals: calcPersonTotals(),
            grandTotal:   grandTotal(),
            merchant:     merchant || receipt.merchant,
          })}
        >
          <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
          <Text style={styles.approveBtnText}>  Review & Approve</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const dd = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  title:       { fontSize: 16, fontWeight: '800', color: '#1e293b', marginBottom: 16 },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  optionActive: { backgroundColor: '#f0f1fe', borderRadius: 10, paddingHorizontal: 10 },
  optionText:   { fontSize: 15, color: '#475569' },
});

const bk = StyleSheet.create({
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  label:      { fontSize: 15, color: '#64748b' },
  value:      { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  totalRow:   { borderBottomWidth: 0, marginTop: 4 },
  totalLabel: { fontSize: 17, fontWeight: '800', color: '#1e293b' },
  totalValue: { fontSize: 22, fontWeight: '800', color: INDIGO },
});

const styles = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: '#f8faff' },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll:       { flex: 1 },
  scrollContent:{ padding: 16, paddingBottom: 8 },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef2f2', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
  },
  errorText:    { flex: 1, color: '#ef4444', fontSize: 13, fontWeight: '600' },
  statsGrid:    { marginBottom: 20, gap: 8 },
  statsRow:     { flexDirection: 'row', gap: 8 },
  statBox: {
    backgroundColor: '#fff', borderRadius: 14, padding: 12,
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  statBoxTappable: { borderWidth: 1.5, borderColor: '#e0e7ff' },
  statHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  statLabel:  { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  statInput: {
    fontSize: 14, fontWeight: '700', color: '#1e293b',
    padding: 0, borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    paddingBottom: 2,
  },
  statValue: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 10 },
  pillScroll:   { marginBottom: 16 },
  groupPill: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', marginRight: 8,
  },
  groupPillActive: { backgroundColor: INDIGO, borderColor: INDIGO },
  groupPillText:   { fontSize: 13, fontWeight: '600', color: '#64748b' },
  controlsRow:  { flexDirection: 'row', gap: 12, marginBottom: 16, alignItems: 'center' },
  taxInput: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#e2e8f0', flex: 1,
  },
  taxField:     { flex: 1, fontSize: 15, fontWeight: '700', color: '#1e293b', padding: 0 },
  taxLabel:     { color: '#64748b', fontSize: 13 },
  groceryToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  groceryLabel: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  itemsHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  addBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  addBtnText:   { fontSize: 13, fontWeight: '700', color: INDIGO },
  txnCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 10,
    shadowColor: '#6366f1', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  editRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editInput:  { borderBottomWidth: 1, borderBottomColor: '#e2e8f0', color: '#1e293b', paddingVertical: 2 },
  deleteBtn:  { padding: 4 },
  amountRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  numField:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  fieldLabel: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },
  fieldSep:   { fontSize: 13, color: '#cbd5e1', fontWeight: '600' },
  numInput: {
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
    fontSize: 14, fontWeight: '700', color: '#1e293b',
    paddingVertical: 2, minWidth: 32, textAlign: 'center',
  },
  lineTotal:    { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '800', color: '#1e293b' },
  taxBadge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#e2e8f0' },
  taxBadgeFree: { backgroundColor: '#d1fae5' },
  taxBadgeText: { fontSize: 10, fontWeight: '700', color: '#64748b' },
  catTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
    backgroundColor: '#f8faff', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  catTriggerText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  memberRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  memberPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#f8faff',
  },
  avatar:         { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  memberPillText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  splitAllBtn:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#e0e7ff' },
  splitAllText:   { fontSize: 12, fontWeight: '700', color: INDIGO },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'web' ? 16 : 28,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  approveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: EMERALD, borderRadius: 16, paddingVertical: 16,
    shadowColor: EMERALD, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  approveBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
