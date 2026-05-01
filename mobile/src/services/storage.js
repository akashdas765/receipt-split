import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'receipts_v1';

export async function loadReceipts() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveReceipt(receipt) {
  try {
    const list = await loadReceipts();
    // newest first
    const updated = [receipt, ...list.filter(r => r.id !== receipt.id)];
    await AsyncStorage.setItem(KEY, JSON.stringify(updated));
  } catch {}
}

export async function deleteReceipt(id) {
  try {
    const list = await loadReceipts();
    await AsyncStorage.setItem(KEY, JSON.stringify(list.filter(r => r.id !== id)));
  } catch {}
}
