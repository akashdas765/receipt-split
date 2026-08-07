import { auth } from './firebase';

// Same auth-gated proxy groq.js uses — this just sends a text-only chat
// completion instead of an image one, so no separate function/route needed.
const PROXY = '/.netlify/functions/groq';

// Small, fast text model — good fit for a short summarization prompt where
// latency matters more than depth. Groq deprecates models periodically;
// check console.groq.com/docs/models if this starts 404ing.
const MODEL = 'openai/gpt-oss-20b';

const INSIGHTS_SYSTEM = `You are a friendly personal finance assistant inside a receipt-splitting app. You'll be given aggregated JSON stats about a user's shared expenses: total group spend, the user's own share, spending by merchant, and spending by month. Write a short analysis — 2-4 sentences, plain text, no markdown headers or preamble — pointing out real observations from the numbers given (trends, the biggest merchant, how their share compares to the group total, anything notable). Be specific and cite numbers from the data.`;

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
    monthly,
  };
}

export async function fetchInsights(stats) {
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
        { role: 'system', content: INSIGHTS_SYSTEM },
        { role: 'user', content: JSON.stringify(stats) },
      ],
      max_tokens: 400,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const message = typeof data?.error === 'string' ? data.error : data?.error?.message;
    throw new Error(message || 'Could not generate insights.');
  }
  return data.choices[0].message.content.trim();
}
