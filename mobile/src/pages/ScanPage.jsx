import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ImagePlus, Sparkles, X, AlertCircle, Loader2, FileText, Plus } from 'lucide-react';
import { parseReceiptImage } from '../services/groq';
import { saveReceipt, logNotification } from '../services/db';
import { loadPdfjs } from '../utils/pdfjsLoader';
import PageHeader from '../components/PageHeader';

const INDIGO = '#6366f1';

// Merge items from multiple parsed images, removing cross-image duplicates.
// Items within the same image are kept as-is (same item can legitimately
// appear twice on one page). Items from a later image that exactly match
// something already seen in an earlier image are treated as overlap and dropped.
function mergeAndDedup(results) {
  const seenInPrevious = new Set();
  const merged = [];

  for (const result of results) {
    const imageItems = result.items || [];
    const keysThisImage = new Set();

    for (const item of imageItems) {
      const key = `${(item.description || '').toLowerCase().trim()}|${(parseFloat(item.amount) || 0).toFixed(2)}`;
      if (!seenInPrevious.has(key)) merged.push(item);
      keysThisImage.add(key);
    }

    keysThisImage.forEach(k => seenInPrevious.add(k));
  }

  return merged;
}

async function pdfPageToBase64(file) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('PDF render timed out')), 20000)
  );
  const render = async () => {
    const pdfjsLib = await loadPdfjs();
    const arrayBuffer = await file.arrayBuffer();
    // isEvalSupported:false closes CVE-2024-4367 — a crafted PDF could
    // otherwise run arbitrary JS through pdf.js's font path. Users upload
    // untrusted PDFs here, so this must stay off.
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
    try {
      const page = await pdf.getPage(1);

      // Cap the rendered canvas size — mobile Safari silently hangs/crashes
      // the worker on very large canvases (multi-page scan apps often
      // produce oversized PDFs).
      let scale    = 2.5;
      let viewport = page.getViewport({ scale });
      const maxDim = 3000;
      if (Math.max(viewport.width, viewport.height) > maxDim) {
        scale   *= maxDim / Math.max(viewport.width, viewport.height);
        viewport = page.getViewport({ scale });
      }

      const canvas = document.createElement('canvas');
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
    } finally {
      pdf.destroy();
    }
  };
  return Promise.race([render(), timeout]);
}

async function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// A phone camera photo is routinely 3-10MB at full resolution — base64
// inflates that another ~33% before it even reaches the proxy's 12MB body
// cap (see shared/groqProxy.js's MAX_BODY_BYTES), and a multi-MB upload on
// a slow mobile connection eats into the request timeout for no OCR-quality
// benefit (receipt text is legible in the scan well below full camera
// resolution). Every image — HEIC included, which Groq's vision API
// rejects outright with a 400 unless re-encoded first — goes through this
// single canvas resize+re-encode pass instead of being sent as-is.
const MAX_IMAGE_DIM = 2200;
const IMAGE_QUALITY  = 0.85;

async function toGroqCompatible(file) {
  const bitmap = await createImageBitmap(file);
  try {
    let { width, height } = bitmap;
    if (Math.max(width, height) > MAX_IMAGE_DIM) {
      const scale = MAX_IMAGE_DIM / Math.max(width, height);
      width  = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    return { b64: canvas.toDataURL('image/jpeg', IMAGE_QUALITY).split(',')[1], mime: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

export default function ScanPage() {
  const navigate   = useNavigate();
  const cameraRef  = useRef(null);
  const fileRef    = useRef(null);
  const addMoreRef   = useRef(null);
  const submittingRef = useRef(false);
  // Tracks fingerprints of currently-present entries. Checked synchronously
  // (not derived inside a setEntries updater) so it can't be affected by how
  // many times or in what order React invokes that updater.
  const fingerprintsRef = useRef(new Set());

  // entries: { id, fingerprint, file, isPdf, preview, pdfB64, rendering }
  const [entries, setEntries] = useState([]);
  const [parsing,  setParsing]  = useState(false);
  const [error,    setError]    = useState('');
  const [dragging, setDragging] = useState(false);

  const processFile = async (f) => {
    const fingerprint = `${f.name}-${f.size}-${f.lastModified}`;
    if (fingerprintsRef.current.has(fingerprint)) return;
    fingerprintsRef.current.add(fingerprint);

    const id    = `${Date.now()}-${Math.random()}`;
    const isPdf = f.type === 'application/pdf';
    setEntries(prev => [...prev, { id, fingerprint, file: f, isPdf, preview: null, pdfB64: null, rendering: true }]);

    if (isPdf) {
      try {
        const b64 = await pdfPageToBase64(f);
        setEntries(prev => prev.map(e =>
          e.id === id ? { ...e, pdfB64: b64, preview: 'data:image/jpeg;base64,' + b64, rendering: false } : e
        ));
      } catch {
        fingerprintsRef.current.delete(fingerprint);
        setEntries(prev => prev.filter(e => e.id !== id));
        setError('Could not render PDF. Make sure it is a valid, non-encrypted PDF.');
      }
    } else {
      try {
        const dataUrl = await imageToDataUrl(f);
        setEntries(prev => prev.map(e =>
          e.id === id ? { ...e, preview: dataUrl, rendering: false } : e
        ));
      } catch (err) {
        fingerprintsRef.current.delete(fingerprint);
        setEntries(prev => prev.filter(e => e.id !== id));
        setError(err?.message || 'Could not load image. Try a different file.');
      }
    }
  };

  const handleFiles = (fileList) => {
    setError('');
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    // Process one at a time — rendering multiple PDFs concurrently spins up
    // multiple pdf.js workers at once, which reliably hangs on mobile Safari.
    (async () => {
      for (const f of files) await processFile(f);
    })();
  };

  const removeEntry = id => {
    setEntries(prev => {
      const removed = prev.find(e => e.id === id);
      if (removed) fingerprintsRef.current.delete(removed.fingerprint);
      return prev.filter(e => e.id !== id);
    });
  };

  const submit = async () => {
    if (!entries.length || submittingRef.current) return;
    submittingRef.current = true;
    setError(''); setParsing(true);
    try {
      const results = await Promise.all(
        entries.map(async entry => {
          if (entry.isPdf) return parseReceiptImage(entry.pdfB64, 'image/jpeg');
          const { b64, mime } = await toGroqCompatible(entry.file);
          return parseReceiptImage(b64, mime);
        })
      );

      const base          = results[0];
      const allItems      = mergeAndDedup(results);
      const usedFallback  = results.some(r => r._provider === 'nvidia');

      const receipt = {
        id:         String(Date.now()),
        scanned_at: new Date().toISOString(),
        merchant:   base.merchant || null,
        date:       base.date     || null,
        // Overall spend category for the whole receipt (Groceries, Food &
        // Dining, ...) — separate from items[].category, which is a
        // narrower food/drink/alcohol/tip/fee/other set that only exists to
        // drive grocery tax-exemption (see DetailPage's isTaxable). Editable
        // in DetailPage the same way bank transactions are in Statements.
        category:   base.spendCategory || 'Other',
        subtotal:   results.reduce((s, r) => s + parseFloat(r.subtotal || 0), 0),
        tax:        results.reduce((s, r) => s + parseFloat(r.tax      || 0), 0),
        tip:        results.reduce((s, r) => s + parseFloat(r.tip      || 0), 0),
        total:      results.reduce((s, r) => s + parseFloat(r.total    || 0), 0),
        approved:   false,
        items: allItems.map((item, idx) => ({
          ...item,
          id:            String(idx),
          quantity:      item.quantity || 1,
          amount:        parseFloat(item.amount) || 0,
          tax_exempt:    0,
          split_members: [],
        })),
      };

      await saveReceipt(receipt);
      // Fire-and-forget — a notification-log failure must never block the
      // actual scan flow the user is waiting on.
      logNotification({
        type: 'receipt_parsed',
        text: `Receipt from ${receipt.merchant || 'Unknown merchant'} was parsed successfully`,
        receiptId: receipt.id,
      }).catch(() => {});
      // usedFallback is a one-time UI notice, not real receipt data — kept
      // out of the object that gets persisted to Firestore.
      navigate('/detail', { state: { ...receipt, usedFallback } });
    } catch (err) {
      setError(err?.message || 'Could not read receipt. Try a clearer photo or PDF.');
    } finally {
      setParsing(false);
      submittingRef.current = false;
    }
  };

  const anyRendering = entries.some(e => e.rendering);

  return (
    <div className="min-h-screen flex flex-col aurora-bg">
      {/* Header */}
      <PageHeader title="Scan Receipt" onBack={() => navigate('/')} />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-5">

        {entries.length === 0 ? (
          <>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-3xl p-10 cursor-pointer transition-all select-none anim-fade-up
                ${dragging ? 'dropzone-active bg-indigo-50 scale-[1.02]' : 'border-edge bg-white/80 hover:border-indigo-300 hover:bg-indigo-50/30'}`}
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-transform tint-indigo-badge ${dragging ? 'scale-110' : 'anim-float'}`}>
                <ImagePlus size={28} style={{ color: INDIGO }} />
              </div>
              <p className="font-bold text-muted text-base mb-1">
                {dragging ? 'Drop to scan' : 'Click or drag receipts here'}
              </p>
              <p className="text-xs text-subtle">JPG · PNG · WEBP · <span className="font-semibold" style={{ color: INDIGO }}>PDF</span> · multiple files OK</p>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
            </div>

            <div className="flex items-center gap-3 anim-fade-up delay-1">
              <div className="flex-1 h-px bg-surface-alt" />
              <span className="text-xs text-subtle font-medium">or</span>
              <div className="flex-1 h-px bg-surface-alt" />
            </div>

            <div className="grid grid-cols-2 gap-3 anim-fade-up delay-2">
              <button onClick={() => cameraRef.current?.click()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-edge bg-surface text-ink font-bold text-sm hover:border-indigo-300 hover:text-indigo transition-colors btn-press">
                <Camera size={17} /> Camera
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-edge bg-surface text-ink font-bold text-sm hover:border-indigo-300 hover:text-indigo transition-colors btn-press">
                <FileText size={17} /> Browse / PDF
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
          </>
        ) : (
          <>
            {/* Thumbnail grid */}
            <div className="grid grid-cols-2 gap-3 stagger">
              {entries.map(entry => (
                <div key={entry.id} className="relative rounded-2xl overflow-hidden border border-edge bg-surface-alt aspect-[3/4] shadow-md anim-scale-in">
                  {entry.rendering ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                      <Loader2 size={24} className="animate-spin" style={{ color: INDIGO }} />
                      <span className="text-xs text-subtle">{entry.isPdf ? 'Rendering PDF…' : 'Loading photo…'}</span>
                    </div>
                  ) : (
                    <img
                      src={entry.preview}
                      alt="Receipt"
                      className="w-full h-full object-cover"
                      onError={e => {
                        e.target.style.display = 'none';
                        e.target.parentElement.classList.add('img-error');
                      }}
                    />
                  )}
                  {entry.isPdf && !entry.rendering && (
                    <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-white/90 rounded-lg px-2 py-0.5">
                      <FileText size={11} style={{ color: INDIGO }} />
                      <span className="text-[10px] font-bold" style={{ color: INDIGO }}>PDF</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeEntry(entry.id)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-surface shadow-md flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}

              {/* Add more tile */}
              <button
                onClick={() => addMoreRef.current?.click()}
                className="aspect-[3/4] rounded-2xl border-2 border-dashed border-edge bg-white/80 flex flex-col items-center justify-center gap-2 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors btn-press anim-scale-in"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center tint-indigo-flat">
                  <Plus size={20} style={{ color: INDIGO }} />
                </div>
                <span className="text-xs font-semibold text-subtle">Add more</span>
              </button>
              <input ref={addMoreRef} type="file" accept="image/*,application/pdf" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
            </div>

            {entries.length > 1 && (
              <p className="text-xs text-center text-subtle">
                {entries.length} images — items from all will be merged into one receipt
              </p>
            )}
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3 anim-pop">
            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-600 font-medium">{error}</p>
          </div>
        )}

        {entries.length > 0 && !anyRendering && (
          <button onClick={submit} disabled={parsing}
            className="flex items-center justify-center gap-2 w-full py-4 rounded-2xl text-white font-bold text-base btn-gradient btn-press disabled:opacity-80 anim-fade-up">
            {parsing
              ? <><Loader2 size={20} className="animate-spin" /> Parsing {entries.length > 1 ? `${entries.length} images` : 'receipt'}…</>
              : <><Sparkles size={20} /> Parse with AI</>}
          </button>
        )}

        {parsing && (
          <p className="text-center text-xs text-subtle -mt-2 anim-fade-in">
            Analysing {entries.length > 1 ? 'your receipts' : 'your receipt'}… this takes 10–20 seconds
          </p>
        )}
      </main>
    </div>
  );
}
