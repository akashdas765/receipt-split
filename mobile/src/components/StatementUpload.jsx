import React, { useRef, useState, useCallback } from 'react';
import { Upload, FileText, X, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { parseStatementPdf } from '../utils/statementPdfParser';
import { parseCsv } from '../utils/csvParser';

const INDIGO = '#6366f1';

function UploadZone({ onFiles, uploading }) {
  const ref = useRef();
  const [drag, setDrag] = useState(false);

  const process = files => { if (files?.length) onFiles(Array.from(files)); };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); process(e.dataTransfer.files); }}
      onClick={() => ref.current?.click()}
      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all select-none
        ${drag ? 'dropzone-active bg-indigo-50 scale-[1.01]' : 'border-slate-200 bg-white/80 hover:border-indigo-300 hover:bg-indigo-50/30'}
        ${uploading ? 'pointer-events-none opacity-50' : ''}`}
    >
      <input ref={ref} type="file" accept=".pdf,.csv" multiple className="hidden" onChange={e => process(e.target.files)} />
      <Upload size={26} style={{ color: INDIGO }} className="mx-auto mb-2" />
      <p className="font-bold text-slate-700 text-sm">{uploading ? 'Processing…' : 'Drop statements here'}</p>
      <p className="text-xs text-slate-400 mt-1">CSV & PDF · Chase, BoA, Wells Fargo, Capital One, Citi, Amex, Discover</p>
    </div>
  );
}

// statements: [{ id, name, source, count, date }] derived by the parent
// from the full transaction list (grouped by `source`).
export default function StatementUpload({ statements, onAdd, onRemoveSource, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [results,   setResults]   = useState([]);
  const [confirming, setConfirming] = useState(null);

  const showResult = useCallback(r => setResults(prev => [...prev, r]), []);

  async function handleFiles(files) {
    setUploading(true);
    for (const file of files) {
      const name     = file.name;
      const ext      = name.split('.').pop().toLowerCase();
      const sourceId = `${name}-${Date.now()}`;

      try {
        let transactions = [];
        if (ext === 'pdf') {
          const res = await parseStatementPdf(file);
          transactions = (res.transactions || []).map(t => ({ ...t, id: `${sourceId}-${t.id}`, source: sourceId }));
        } else if (ext === 'csv') {
          const text = await file.text();
          const res  = await parseCsv(text, sourceId);
          transactions = res.transactions;
        } else {
          throw new Error('Unsupported format. Use CSV or PDF.');
        }

        if (!transactions.length) {
          showResult({ name, status: 'warn', msg: 'No transactions found — check the file format.' });
          continue;
        }

        await onAdd(transactions, name);
        showResult({ name, status: 'ok', count: transactions.length });
      } catch (e) {
        showResult({ name, status: 'error', msg: e.message });
      }
    }
    setUploading(false);
    onUploaded?.();
  }

  return (
    <div className="space-y-4">
      <UploadZone onFiles={handleFiles} uploading={uploading} />

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={i} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs anim-pop ${
              r.status === 'ok'   ? 'bg-emerald-50 text-emerald-700' :
              r.status === 'warn' ? 'bg-amber-50 text-amber-700'    :
                                     'bg-red-50 text-red-600'
            }`}>
              {r.status === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              <span className="flex-1 truncate font-semibold">{r.name}</span>
              <span>{r.status === 'ok' ? `${r.count} added` : r.msg}</span>
            </div>
          ))}
        </div>
      )}

      {statements.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
            Loaded statements ({statements.length})
          </p>
          <div className="space-y-2">
            {statements.map(s => {
              const isConfirming = confirming === s.id;
              return (
                <div key={s.id} className={`rounded-xl overflow-hidden border transition-colors ${isConfirming ? 'border-red-200' : 'border-slate-100'}`}>
                  <div className="flex items-center gap-3 bg-white px-3 py-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <FileText size={14} style={{ color: INDIGO }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.count} transaction{s.count !== 1 ? 's' : ''}</p>
                    </div>
                    <button
                      onClick={() => setConfirming(id => id === s.id ? null : s.id)}
                      className={`p-1.5 rounded-lg transition-colors ${isConfirming ? 'text-red-500 bg-red-50' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {isConfirming && (
                    <div className="flex items-center gap-2 bg-red-50 border-t border-red-100 px-3 py-2.5">
                      <Trash2 size={13} className="text-red-500 shrink-0" />
                      <p className="text-red-600 text-xs flex-1">Remove {s.count} transaction{s.count !== 1 ? 's' : ''}?</p>
                      <button onClick={() => setConfirming(null)} className="px-3 py-1 rounded-lg text-xs font-bold bg-white text-slate-600 border border-slate-200">Cancel</button>
                      <button
                        onClick={() => { onRemoveSource(s.id); setConfirming(null); }}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-red-500 text-white"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
