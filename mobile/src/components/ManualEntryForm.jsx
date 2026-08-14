import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { detectCategory, ALL_CATEGORIES } from '../utils/categoryDetector';
import { useToast } from './ToastProvider';

const BLANK = { date: '', description: '', amount: '', category: '' };

export default function ManualEntryForm({ onAdd }) {
  const toast = useToast();
  const [form,    setForm]    = useState(BLANK);
  const [errors,  setErrors]  = useState({});

  function validate() {
    const errs = {};
    if (!form.date) errs.date = 'Required';
    if (!form.description) errs.description = 'Required';
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0)
      errs.amount = 'Enter a valid positive amount';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const txn = {
      id:          `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date:        form.date,
      description: form.description.trim(),
      amount:      parseFloat(form.amount),
      category:    form.category || detectCategory(form.description),
      source:      'manual',
      isPayment:   false,
    };

    await onAdd([txn], 'Manual entry');
    setForm(BLANK);
    setErrors({});
    toast.success('Transaction added');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Date *</label>
          <input
            type="date"
            value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className={`w-full bg-surface border rounded-xl px-3 py-2.5 text-sm text-ink outline-none transition-colors ${errors.date ? 'border-red-300' : 'border-edge focus:border-indigo-300'}`}
          />
          {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date}</p>}
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted mb-1">Amount (USD) *</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder="0.00"
            className={`w-full bg-surface border rounded-xl px-3 py-2.5 text-sm text-ink outline-none transition-colors ${errors.amount ? 'border-red-300' : 'border-edge focus:border-indigo-300'}`}
          />
          {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted mb-1">Description *</label>
        <input
          type="text"
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="e.g. Trader Joe's, Uber, Netflix…"
          className={`w-full bg-surface border rounded-xl px-3 py-2.5 text-sm text-ink outline-none transition-colors ${errors.description ? 'border-red-300' : 'border-edge focus:border-indigo-300'}`}
        />
        {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted mb-1">
          Category <span className="text-subtle font-normal">(auto-detected if blank)</span>
        </label>
        <select
          value={form.category}
          onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
          className="w-full bg-surface border border-edge rounded-xl px-3 py-2.5 text-sm text-ink outline-none focus:border-indigo-300 transition-colors"
        >
          <option value="">Auto-detect</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <button
        type="submit"
        className="w-full flex items-center justify-center gap-2 font-bold rounded-xl py-3 text-sm text-white transition-colors btn-press btn-gradient"
      >
        <Plus size={16} /> Add transaction
      </button>
    </form>
  );
}
