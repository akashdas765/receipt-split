// The override fields each "Counts as" choice writes — shared by every
// place the control appears (TransactionsList rows, BankTransactionDetail
// on Statements and Home — see components/LedgerTypeRow.jsx for the UI) so
// the pages can't drift on what a choice means. Every branch settles ALL
// the fields (nulls included), keeping the states mutually exclusive no
// matter what was picked before. 'expense'/'credit' also dismisses any
// transfer hint — an explicit "this is real spend/credit" is also an
// explicit "not a transfer".
export function ledgerTypeOverrideFields(type) {
  return type === 'transfer' ? { overridePayment: null, overrideExcludedFromSpend: null, overrideConfirmedTransfer: true, overrideDismissedTransferHint: null }
    : type === 'payment' ? { overridePayment: true, overrideExcludedFromSpend: null, overrideConfirmedTransfer: null, overrideDismissedTransferHint: true }
    : type === 'excluded' ? { overridePayment: null, overrideExcludedFromSpend: true, overrideConfirmedTransfer: null, overrideDismissedTransferHint: true }
    : type === 'auto' ? { overridePayment: null, overrideExcludedFromSpend: null, overrideConfirmedTransfer: null, overrideDismissedTransferHint: null }
    : { overridePayment: false, overrideExcludedFromSpend: null, overrideConfirmedTransfer: null, overrideDismissedTransferHint: true };
}
