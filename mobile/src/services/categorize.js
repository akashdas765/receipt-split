import { auth } from './firebase';
import { detectCategory, ALL_CATEGORIES } from '../utils/categoryDetector';

// Requests go through the same serverless proxy + allowlisted model as
// services/groq.js's receipt parser (see shared/groqProxy.js's
// ALLOWED_MODELS) — reusing it here instead of adding a second model to the
// allowlist keeps that allowlist as the single source of truth for "what
// this app is allowed to run inference with."
const PROXY = '/.netlify/functions/groq';
const MODEL = 'qwen/qwen3.8-27b';

// Batch cap: keeps one call's prompt/response comfortably within the
// proxy's 4096-token response budget (each {id, category} pair is roughly
// 15-20 tokens) and keeps a single Plaid full-history re-sync from
// blocking on one enormous call — chunked below instead.
const BATCH_SIZE = 50;

const SYSTEM_PROMPT = `You are a spending-category classifier for bank transactions. For each transaction, pick exactly one category from this list: ${ALL_CATEGORIES.join(', ')}.

Return valid JSON only — no extra text, no markdown fences — as an array of {"id": "...", "category": "..."} objects, one per transaction given, using the same id values you were given.`;

function stripFences(text) {
  if (text.includes('```json')) return text.split('```json')[1].split('```')[0].trim();
  if (text.includes('```'))     return text.split('```')[1].split('```')[0].trim();
  return text.trim();
}

function extractJsonArray(text) {
  const start = text.indexOf('[');
  const end   = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

async function categorizeBatch(batch) {
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(batch.map(t => ({ id: t.id, description: t.description, amount: t.amount }))) },
      ],
      max_tokens: 4096,
      reasoning_effort: 'none',
    }),
  });

  if (!res.ok) throw new Error(`Categorization request failed (${res.status})`);
  const data = await res.json();
  const parsed = JSON.parse(extractJsonArray(stripFences(data.choices[0].message.content)));
  if (!Array.isArray(parsed)) throw new Error('Unexpected categorization response shape');

  const byId = new Map();
  for (const entry of parsed) {
    if (entry?.id && ALL_CATEGORIES.includes(entry.category)) byId.set(entry.id, entry.category);
  }
  return byId;
}

// transactions: [{id, description, amount}]. Returns a Map<id, category>
// covering every input id — AI-assigned where the call succeeded, falling
// back to the same keyword detection used everywhere else (never leaves an
// id uncategorized, and never throws — a failed AI call degrades to the
// pre-existing behavior instead of blocking the transactions from being
// added at all).
export async function categorizeTransactions(transactions) {
  const result = new Map();
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    try {
      const byId = await categorizeBatch(batch);
      for (const t of batch) result.set(t.id, byId.get(t.id) || detectCategory(t.description));
    } catch (err) {
      console.error('AI categorization failed, falling back to keyword detection:', err);
      for (const t of batch) result.set(t.id, detectCategory(t.description));
    }
  }
  return result;
}
