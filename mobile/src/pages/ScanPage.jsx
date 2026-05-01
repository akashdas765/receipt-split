import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, ImagePlus, Sparkles, X, AlertCircle, Loader2, FileText, Plus } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { parseReceiptImage } from '../services/mistral';
import { saveReceipt } from '../services/db';

// Use CDN worker — avoids Vite bundling issues with the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const INDIGO = '#6366f1';

async function pdfPageToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf      = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page     = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.5 });
  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
}

async function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ScanPage() {
  const navigate   = useNavigate();
  const cameraRef  = useRef(null);
  const fileRef    = useRef(null);
  const addMoreRef   = useRef(null);
  const submittingRef = useRef(false);

  // entries: { id, fingerprint, file, isPdf, preview, pdfB64, rendering }
  const [entries, setEntries] = useState([]);
  const [parsing,  setParsing]  = useState(false);
  const [error,    setError]    = useState('');
  const [dragging, setDragging] = useState(false);

  const processFile = async (f) => {
    const id          = `${Date.now()}-${Math.random()}`;
    const isPdf       = f.type === 'application/pdf';
    const fingerprint = `${f.name}-${f.size}-${f.lastModified}`;

    let added = false;
    setEntries(prev => {
      if (prev.some(e => e.fingerprint === fingerprint)) return prev;
      added = true;
      return [...prev, { id, fingerprint, file: f, isPdf, preview: null, pdfB64: null, rendering: isPdf }];
    });
    if (!added) return;

    if (isPdf) {
      try {
        const b64 = await pdfPageToBase64(f);
        setEntries(prev => prev.map(e =>
          e.id === id ? { ...e, pdfB64: b64, preview: 'data:image/jpeg;base64,' + b64, rendering: false } : e
        ));
      } catch {
        setEntries(prev => prev.filter(e => e.id !== id));
        setError('Could not render PDF. Make sure it is a valid, non-encrypted PDF.');
      }
    } else {
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, preview: URL.createObjectURL(f) } : e
      ));
    }
  };

  const handleFiles = (fileList) => {
    setError('');
    Array.from(fileList).forEach(f => {
      if (f.type.startsWith('image/') || f.type === 'application/pdf') processFile(f);
    });
  };

  const removeEntry = id => setEntries(prev => prev.filter(e => e.id !== id));

  const submit = async () => {
    if (!entries.length || submittingRef.current) return;
    submittingRef.current = true;
    setError(''); setParsing(true);
    try {
      const results = await Promise.all(
        entries.map(async entry => {
          const base64 = entry.isPdf ? entry.pdfB64 : await imageToBase64(entry.file);
          return parseReceiptImage(base64, 'image/jpeg');
        })
      );

      const base    = results[0];
      const allItems = results.flatMap(r => r.items || []);

      const receipt = {
        id:         String(Date.now()),
        scanned_at: new Date().toISOString(),
        merchant:   base.merchant || null,
        date:       base.date     || null,
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
      navigate('/detail', { state: receipt });
    } catch (err) {
      setError(err?.message || 'Could not read receipt. Try a clearer photo or PDF.');
    } finally {
      setParsing(false);
      submittingRef.current = false;
    }
  };

  const anyRendering = entries.some(e => e.rendering);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <span className="font-extrabold text-slate-800">Scan Receipt</span>
        </div>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 flex flex-col gap-5">

        {entries.length === 0 ? (
          <>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-10 cursor-pointer transition-all select-none
                ${dragging ? 'border-indigo bg-indigo-50 scale-[1.01]' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'}`}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#e0e7ff' }}>
                <ImagePlus size={28} style={{ color: INDIGO }} />
              </div>
              <p className="font-bold text-slate-600 text-base mb-1">
                {dragging ? 'Drop to scan' : 'Click or drag receipts here'}
              </p>
              <p className="text-xs text-slate-400">JPG · PNG · WEBP · <span className="font-semibold" style={{ color: INDIGO }}>PDF</span> · multiple files OK</p>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-xs text-slate-400 font-medium">or</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => cameraRef.current?.click()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-slate-200 bg-white text-slate-700 font-bold text-sm hover:border-indigo-300 hover:text-indigo transition-colors">
                <Camera size={17} /> Camera
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-slate-200 bg-white text-slate-700 font-bold text-sm hover:border-indigo-300 hover:text-indigo transition-colors">
                <FileText size={17} /> Browse / PDF
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
          </>
        ) : (
          <>
            {/* Thumbnail grid */}
            <div className="grid grid-cols-2 gap-3">
              {entries.map(entry => (
                <div key={entry.id} className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[3/4]">
                  {entry.rendering ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                      <Loader2 size={24} className="animate-spin" style={{ color: INDIGO }} />
                      <span className="text-xs text-slate-400">Rendering PDF…</span>
                    </div>
                  ) : (
                    <img src={entry.preview} alt="Receipt" className="w-full h-full object-cover" />
                  )}
                  {entry.isPdf && !entry.rendering && (
                    <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-white/90 rounded-lg px-2 py-0.5">
                      <FileText size={11} style={{ color: INDIGO }} />
                      <span className="text-[10px] font-bold" style={{ color: INDIGO }}>PDF</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeEntry(entry.id)}
                    className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center text-red-400 hover:text-red-600 transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}

              {/* Add more tile */}
              <button
                onClick={() => addMoreRef.current?.click()}
                className="aspect-[3/4] rounded-2xl border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center gap-2 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#e0e7ff' }}>
                  <Plus size={20} style={{ color: INDIGO }} />
                </div>
                <span className="text-xs font-semibold text-slate-400">Add more</span>
              </button>
              <input ref={addMoreRef} type="file" accept="image/*,application/pdf" multiple onChange={e => handleFiles(e.target.files)} className="hidden" />
            </div>

            {entries.length > 1 && (
              <p className="text-xs text-center text-slate-400">
                {entries.length} images — items from all will be merged into one receipt
              </p>
            )}
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-600 font-medium">{error}</p>
          </div>
        )}

        {entries.length > 0 && !anyRendering && (
          <button onClick={submit} disabled={parsing}
            className="flex items-center justify-center gap-2 w-full py-4 rounded-xl text-white font-bold text-base transition-opacity disabled:opacity-60"
            style={{ background: INDIGO, boxShadow: '0 6px 20px rgba(99,102,241,0.4)' }}>
            {parsing
              ? <><Loader2 size={20} className="animate-spin" /> Parsing {entries.length > 1 ? `${entries.length} images` : 'receipt'}…</>
              : <><Sparkles size={20} /> Parse with AI</>}
          </button>
        )}

        {parsing && (
          <p className="text-center text-xs text-slate-400 -mt-2">
            Analysing {entries.length > 1 ? 'your receipts' : 'your receipt'}… this takes 10–20 seconds
          </p>
        )}
      </main>
    </div>
  );
}
