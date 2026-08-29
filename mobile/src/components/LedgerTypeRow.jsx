import React from 'react';
import { isCreditConfirmation } from '../utils/paymentDetector';

const INDIGO = '#6366f1';

// The per-transaction ledger classification control — the one explicit
// switch for "is this real spend, a card payment, a transfer, or not my
// money at all" (and so whether it counts in Actual spend / Actual Credit
// / Payments / Income). Reads the override fields handleSetLedgerType
// (StatementsPage/HomePage) writes; 'auto' means no override, defer to
// detection. The Auto option spells out what detection resolved to only
// while it's actually in charge — once a manual value is picked, the row's
// own flags reflect that choice, so echoing them back as "Auto (...)"
// would just mislead.
export default function LedgerTypeRow({ txn, kind, onSetLedgerType }) {
  if (!onSetLedgerType) return null;
  const value = txn.overrideExcludedFromSpend ? 'excluded'
    : txn.overrideConfirmedTransfer ? 'transfer'
    : txn.overridePayment === true ? 'payment'
    : txn.overridePayment === false ? 'expense'
    : 'auto';
  const spendLabel = kind === 'credit' ? 'Credit / refund' : 'Expense (counts as spend)';
  const autoResolved = txn.isTransfer ? 'transfer'
    : kind === 'credit' ? (isCreditConfirmation(txn.description) ? 'card payment' : 'credit') : (txn.isPayment ? 'card payment' : 'expense');
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <span className="text-xs text-subtle">Counts as</span>
      <div className="flex items-center gap-1.5">
        {value !== 'auto' && <span className="text-xs bg-indigo-50 px-1.5 rounded-full shrink-0" style={{ color: INDIGO }}>manual</span>}
        <select
          value={value}
          onChange={e => onSetLedgerType(txn, e.target.value)}
          onClick={e => e.stopPropagation()}
          className="text-xs font-semibold text-ink bg-transparent outline-none text-right"
        >
          <option value="auto">{value === 'auto' ? `Auto (${autoResolved})` : 'Auto'}</option>
          <option value="expense">{spendLabel}</option>
          <option value="payment">Card payment</option>
          <option value="transfer">Transfer</option>
          <option value="excluded">{"Don't count (not my spend)"}</option>
        </select>
      </div>
    </div>
  );
}
