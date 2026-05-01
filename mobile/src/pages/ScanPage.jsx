import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, ImagePlus, Sparkles, X, AlertCircle, Loader2, FileText } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { parseReceiptImage } from '../services/mistral';
import { saveReceipt } from '../services/db';

// Use CDN worker — avoids Vite bundling issues with the PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const INDIGO = '#6366f1';

async function pdfPageToBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page        = await pdf.getPage(1);
  const viewport    = page.getViewport({ scale: 2.5 }); // high-res render

  const canvas    = document.createElement('canvas');
  canvas.width    = viewport.width;
  canvas.height   = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  return dataUrl.split(',')[1]; // raw base64
}

async function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader  = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ScanPage() {
  const navigate  = useNavigate();
  const cameraRef = useRef(null);
  const fileRef   = useRef(null);

  const [preview,  setPreview]  = useState(null); // object URL or canvas data URL
  const [file,     setFile]     = useState(null);
  const [isPdf,    setIsPdf]    = useState(false);
  const [pdfB64,   setPdfB64]   = useState(null); // pre-rendered PDF base64
  const [parsing,  setParsing]  = useState(false);
  const [rendering,setRendering]= useState(false);
  const [error,    setError]    = useState('');
  const [dragging, setDragging] = useState(false);

  const handleFile = async (f) => {
    if (!f) return;
    const ok = f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!ok) { setError('Please select an image (JPG, PNG, WEBP) or a PDF.'); return; }

    setError(''); setFile(f);
    const pdf = f.type === 'application/pdf';
    setIsPdf(pdf);

    if (pdf) {
      setRendering(true);
      try {
        const b64 = await pdfPageToBase64(f);
        setPdfB64(b64);
        setPreview('data:image/jpeg;base64,' + b64);
      } catch {
        setError('Could not render PDF. Make sure it is a valid, non-encrypted PDF.');
        setFile(null);
      } finally {
        setRendering(false);
      }
    } else {
      setPdfB64(null);
      setPreview(URL.createObjectURL(f));
    }
  };

  const onInput   = e => handleFile(e.target.files?.[0]);
  const onDrop    = e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); };
  const clear     = () => { setFile(null); setPreview(null); setPdfB64(null); setIsPdf(false); setError(''); };

  const submit = async () => {
    if (!file) return;
    setError(''); setParsing(true);
    try {
      const base64 = isPdf ? pdfB64 : await imageToBase64(file);
      const mime   = 'image/jpeg'; // Mistral always gets JPEG
      const parsed = await parseReceiptImage(base64, mime);

      const items = (parsed.items || []).map((item, idx) => ({
        ...item, id: String(idx),
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
      navigate('/detail', { state: receipt });
    } catch (err) {
      setError(err?.message || 'Could not read receipt. Try a clearer photo or PDF.');
    } finally {
      setParsing(false);
    }
  };

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

        {!preview ? (
          <>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-10 cursor-pointer transition-all select-none
                ${dragging ? 'border-indigo bg-indigo-50 scale-[1.01]' : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'}`}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#e0e7ff' }}>
                <ImagePlus size={28} style={{ color: INDIGO }} />
              </div>
              <p className="font-bold text-slate-600 text-base mb-1">
                {dragging ? 'Drop to scan' : 'Click or drag a receipt here'}
              </p>
              <p className="text-xs text-slate-400">JPG · PNG · WEBP · <span className="font-semibold" style={{ color: INDIGO }}>PDF</span> — up to 20 MB</p>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onInput} className="hidden" />
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
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onInput} className="hidden" />
          </>
        ) : rendering ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 size={32} className="animate-spin" style={{ color: INDIGO }} />
            <p className="text-sm text-slate-500 font-medium">Rendering PDF…</p>
          </div>
        ) : (
          <div className="relative">
            {isPdf && (
              <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 mb-3">
                <FileText size={14} style={{ color: INDIGO }} />
                <p className="text-xs font-semibold" style={{ color: INDIGO }}>
                  PDF — showing page 1 preview (sent to AI as image)
                </p>
              </div>
            )}
            <img src={preview} alt="Receipt preview"
              className="w-full rounded-2xl object-contain max-h-[60vh] bg-slate-100 border border-slate-200" />
            <button onClick={clear}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center text-red-400 hover:text-red-600 transition-colors">
              <X size={18} />
            </button>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-600 font-medium">{error}</p>
          </div>
        )}

        {preview && !rendering && (
          <button onClick={submit} disabled={parsing}
            className="flex items-center justify-center gap-2 w-full py-4 rounded-xl text-white font-bold text-base transition-opacity disabled:opacity-60"
            style={{ background: INDIGO, boxShadow: '0 6px 20px rgba(99,102,241,0.4)' }}>
            {parsing
              ? <><Loader2 size={20} className="animate-spin" /> Parsing receipt…</>
              : <><Sparkles size={20} /> Parse with AI</>}
          </button>
        )}

        {parsing && (
          <p className="text-center text-xs text-slate-400 -mt-2">
            Analysing your receipt… this takes 10–20 seconds
          </p>
        )}
      </main>
    </div>
  );
}
