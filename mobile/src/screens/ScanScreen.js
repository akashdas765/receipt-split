import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, ScrollView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { parseReceiptImage } from '../services/mistral';
import { saveReceipt } from '../services/db';

const INDIGO  = '#6366f1';
const EMERALD = '#10b981';

export default function ScanScreen({ navigation }) {
  const [image,   setImage]   = useState(null);
  const [asset,   setAsset]   = useState(null);
  const [parsing, setParsing] = useState(false);
  const [error,   setError]   = useState('');

  const pickerOpts = { quality: 0.85, base64: true, mediaTypes: ImagePicker.MediaTypeOptions.Images };

  const pick = async (fromCamera) => {
    setError('');
    const { status } = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError(fromCamera ? 'Camera access is required.' : 'Library access is required.');
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync(pickerOpts)
      : await ImagePicker.launchImageLibraryAsync(pickerOpts);
    if (!result.canceled) {
      setImage(result.assets[0].uri);
      setAsset(result.assets[0]);
    }
  };

  const submit = async () => {
    if (!asset) return;
    setError('');
    setParsing(true);
    try {
      const mime   = asset.mimeType || (asset.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
      const parsed = await parseReceiptImage(asset.base64, mime);
      const items  = (parsed.items || []).map((item, idx) => ({
        ...item,
        id:            String(idx),
        quantity:      item.quantity || 1,
        amount:        parseFloat(item.amount) || 0,
        tax_exempt:    0,
        split_members: [],
      }));
      const receipt = {
        id:         String(Date.now()),
        scanned_at: new Date().toISOString(),
        merchant:   parsed.merchant || null,
        date:       parsed.date     || null,
        subtotal:   parseFloat(parsed.subtotal || 0),
        tax:        parseFloat(parsed.tax      || 0),
        tip:        parseFloat(parsed.tip      || 0),
        total:      parseFloat(parsed.total    || 0),
        approved:   false,
        items,
      };
      await saveReceipt(receipt);
      navigation.navigate('Detail', receipt);
    } catch (e) {
      setError(e?.message || 'Could not read receipt. Try a clearer photo.');
    } finally {
      setParsing(false);
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
          <Ionicons name="scan-outline" size={36} color="#fff" />
        </View>
        <Text style={styles.title}>ReceiptSplit</Text>
        <Text style={styles.subtitle}>Scan a receipt, split with Splitwise</Text>
      </View>

      {image ? (
        <View style={styles.preview}>
          <Image source={{ uri: image }} style={styles.previewImage} resizeMode="contain" />
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => { setImage(null); setAsset(null); setError(''); }}
          >
            <Ionicons name="close-circle" size={32} color="#ef4444" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.pickerRow}>
          <TouchableOpacity style={[styles.pickCard, { borderColor: INDIGO }]} onPress={() => pick(true)}>
            <Ionicons name="camera-outline" size={38} color={INDIGO} />
            <Text style={[styles.pickLabel, { color: INDIGO }]}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.pickCard, { borderColor: EMERALD }]} onPress={() => pick(false)}>
            <Ionicons name="images-outline" size={38} color={EMERALD} />
            <Text style={[styles.pickLabel, { color: EMERALD }]}>Library</Text>
          </TouchableOpacity>
        </View>
      )}

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={16} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {image && (
        <TouchableOpacity
          style={[styles.submitBtn, parsing && styles.submitDisabled]}
          onPress={submit}
          disabled={parsing}
          activeOpacity={0.85}
        >
          {parsing ? (
            <>
              <ActivityIndicator color="#fff" />
              <Text style={styles.submitText}>  Parsing…</Text>
            </>
          ) : (
            <>
              <Ionicons name="sparkles-outline" size={20} color="#fff" />
              <Text style={styles.submitText}>  Parse with AI</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {parsing && (
        <Text style={styles.hint}>Reading your receipt… this may take 10–20 seconds</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1, backgroundColor: '#f8faff',
    padding: 24, alignItems: 'center',
  },
  hero:     { alignItems: 'center', marginBottom: 36, marginTop: 24 },
  logoBox: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: INDIGO, alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 8,
  },
  title:    { fontSize: 26, fontWeight: '800', color: '#1e293b', marginTop: 4 },
  subtitle: { fontSize: 14, color: '#94a3b8', marginTop: 6 },
  pickerRow: { flexDirection: 'row', gap: 14, width: '100%', marginBottom: 8 },
  pickCard: {
    flex: 1, height: 140, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#fff',
  },
  pickLabel:    { fontSize: 15, fontWeight: '700' },
  preview:      { width: '100%', position: 'relative', marginBottom: 20 },
  previewImage: { width: '100%', height: 320, borderRadius: 20 },
  clearBtn: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: '#fff', borderRadius: 16,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef2f2', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    width: '100%', marginBottom: 12,
  },
  errorText: { flex: 1, color: '#ef4444', fontSize: 13, fontWeight: '600' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: INDIGO, borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 40, width: '100%', marginTop: 4,
    shadowColor: INDIGO, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 17, marginLeft: 6 },
  hint:       { color: '#94a3b8', fontSize: 13, marginTop: 16, textAlign: 'center' },
});
