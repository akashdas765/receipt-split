import { auth } from './firebase';

// Same auth-gated proxy groq.js uses — this just sends a text-only chat
// completion instead of an image one, so no separate function/route needed.
const PROXY = '/.netlify/functions/groq';

// Small, fast text model — good fit for chat where latency matters more
// than depth. Groq deprecates models periodically; check
// console.groq.com/docs/models if this starts 404ing.
const MODEL = 'openai/gpt-oss-20b';

// Only the last N turns are sent to the model — bounds prompt size/cost as
// a conversation grows without capping what's shown in the UI.
const MAX_HISTORY_TURNS = 10;

const CHAT_SYSTEM = `You are a friendly personal finance assistant inside a receipt-splitting app called ReceiptSplit. You're given aggregated JSON stats about the user's shared expense history: total group spend, the user's own share, spending by merchant, spending by category (food, drink, alcohol, fee, tip, other), and spending by month. Answer the user's questions about their spending using this data — be specific and cite real numbers. If something can't be answered from the data (e.g. a specific individual purchase not reflected in the aggregates), say so honestly instead of guessing. Keep answers concise: a few sentences, plain text, no markdown headers.`;

// receipts: Firestore receipt docs. myId: the user's own Splitwise member id
// (string), or undefined if it couldn't be resolved.
export function computeStats(receipts, myId) {
  const approved = receipts.filter(r => r.approved);
  const amountOf = r => r.grandTotal ?? r.total ?? 0;

  const totalSpent = receipts.reduce((s, r) => s + amountOf(r), 0);

  let myShare = 0;
  let myShareCount = 0;
  if (myId) {
    approved.forEach(r => {
      const amt = r.personTotals?.[myId];
      if (amt) { myShare += amt; myShareCount++; }
    });
  }

  const byMerchant = {};
  receipts.forEach(r => {
    const key = r.merchant || 'Unknown';
    byMerchant[key] = (byMerchant[key] || 0) + amountOf(r);
  });
  const topMerchants = Object.entries(byMerchant)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([merchant, amount]) => ({ merchant, amount }));

  const byCategory = {};
  receipts.forEach(r => {
    (r.items || []).forEach(item => {
      const cat = (item.category || 'other').toLowerCase();
      const amt = parseFloat(item.amount) || 0;
      byCategory[cat] = (byCategory[cat] || 0) + amt;
    });
  });
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({ category, amount }));

  const byMonth = {};
  receipts.forEach(r => {
    const dateStr = r.date || r.scanned_at?.slice(0, 10);
    if (!dateStr) return;
    const month = dateStr.slice(0, 7); // YYYY-MM
    byMonth[month] = (byMonth[month] || 0) + amountOf(r);
  });
  const monthly = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([month, amount]) => ({ month, amount }));

  return {
    receiptCount:  receipts.length,
    approvedCount: approved.length,
    totalSpent,
    myShare,
    myShareCount,
    hasMyShare: !!myId,
    topMerchants,
    topCategories,
    monthly,
  };
}

// messages: prior conversation as [{ role: 'user' | 'assistant', content }],
// already including the new user turn. Returns the assistant's reply text.
export async function askInsightsChat(stats, messages) {
  let idToken;
  try {
    idToken = await auth.currentUser?.getIdToken();
  } catch {
    idToken = null;
  }

  const res = await fetch(PROXY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: `${CHAT_SYSTEM}\n\nSpending data:\n${JSON.stringify(stats)}` },
        ...messages.slice(-MAX_HISTORY_TURNS),
      ],
      max_tokens: 400,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    throw new Error(message || 'Could not get a response.');
  }
  return data.choices[0].message.content.trim();
}
