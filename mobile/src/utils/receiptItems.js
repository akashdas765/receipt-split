// Shared by DetailPage.jsx (editing) and ReceiptDetail.jsx (the read-only
// view sheet on HomePage) — both need the same item-shape normalization
// and line-total math so a posted receipt's numbers agree between the two.

// Normalize items coming from Firestore (old format used split_members string[])
// and from OCR (which only has quantity + line-total amount, no unit price).
export function normalizeItems(rawItems) {
  return (rawItems || []).map(item => {
    const qty = parseFloat(item.quantity) || 1;
    return {
      ...item,
      split_shares: item.split_shares ||
        Object.fromEntries((item.split_members || []).map(id => [id, 1])),
      unit_price: item.unit_price ?? (parseFloat(item.amount) || 0) / qty,
      split_mode: item.split_mode || 'whole',
      unit_shares: item.unit_shares || Array.from({ length: Math.max(1, Math.round(qty)) }, () => ({})),
    };
  });
}

// Source of truth for an item's pre-tax total: unit price × quantity, both
// kept as the raw strings the user is typing so editing one field never
// clobbers mid-edit text in the other (see DetailPage's updateItem — no
// parsing on keystroke).
export function lineAmount(item) {
  return (parseFloat(item.unit_price) || 0) * (parseFloat(item.quantity) || 1);
}

// Collapses either split shape (whole-item split_shares, or per-unit
// unit_shares) into one {memberId: totalShareCount} map — used by the
// read-only view, which shows "who's on this item" without needing the
// full per-unit editing UI.
export function flattenShares(item) {
  if (item.split_mode === 'unit' && item.unit_shares?.length) {
    const combined = {};
    item.unit_shares.forEach(u => {
      Object.keys(u).forEach(id => {
        if ((u[id] || 0) > 0) combined[id] = (combined[id] || 0) + u[id];
      });
    });
    return combined;
  }
  return item.split_shares || {};
}
