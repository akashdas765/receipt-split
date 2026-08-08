import { loadPdfjs } from './pdfjsLoader';
import { detectCategory } from './categoryDetector';
import { isPaymentTransaction } from './paymentDetector';

// Client-side bank/CC statement PDF parser — extracts the text layer and
// regexes out transaction lines. Handles common US bank formats: Chase,
// BoA, Wells Fargo, Capital One, Citi, Amex, Discover. Ported from
// akashdas765/personal-expense-manager's pdfParser.js; only the worker
// setup changed, to reuse this app's existing lazy pdfjs loader (see
// ScanPage.jsx) instead of a public/ static worker file.
//
// Key feature: tracks section headers (PAYMENTS, PURCHASES, FEES…) so
// transactions in a "Payments" section are correctly tagged isPayment=true.

const PAYMENT_SECTION_RE = /^(payments?\s*(and\s*(other\s*)?credits?)?|credits?\s*(received)?|payment\s*activity|account\s*credits?|other\s*credits?)$/i;
const EXPENSE_SECTION_RE = /^(purchases?|transactions?|account\s*activity|new\s*charges?|fees?|interest\s*charged|cash\s*advances?|debits?)$/i;

function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (/^\d{1,2}\/\d{1,2}$/.test(s)) {
    const [m, d] = s.split('/');
    return `${new Date().getFullYear()}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (!isNaN(dt)) return dt.toISOString().substring(0, 10);
  return null;
}

const CREDIT_LINE_RE = /(?:^|[\s(])-\$?[\d,]+\.\d{2}|[\d,]+\.\d{2}\s*CR\b|\(\s*\$?[\d,]+\.\d{2}\s*\)/i;

function parsePdfText(text) {
  const lines        = text.split('\n').map(l => l.trim()).filter(Boolean);
  const transactions = [];
  const dateRe       = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;

  let inPaymentSection = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (PAYMENT_SECTION_RE.test(trimmed)) { inPaymentSection = true;  continue; }
    if (EXPENSE_SECTION_RE.test(trimmed)) { inPaymentSection = false; continue; }

    if (/\b(account|statement|balance|opening|closing|summary|total|page\s*\d|date\s+desc)\b/i.test(trimmed)) continue;

    const dateMatch = trimmed.match(dateRe);
    if (!dateMatch) continue;

    if (!inPaymentSection && CREDIT_LINE_RE.test(trimmed)) continue;

    const amounts = [];
    let m;
    const re = /\$?([\d,]+\.\d{2})/g;
    while ((m = re.exec(trimmed)) !== null) {
      const v = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(v) && v > 0) amounts.push(v);
    }
    if (!amounts.length) continue;

    const desc = trimmed
      .replace(dateMatch[0], '')
      .replace(/\$?[\d,]+\.\d{2}/g, '')
      .replace(/\([\d,]+\.\d{2}\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (desc.length < 3) continue;

    const amount = amounts[amounts.length - 1];
    if (amount > 50000) continue;

    const date = normalizeDate(dateMatch[1]);
    if (!date) continue;

    const isPayment = inPaymentSection || isPaymentTransaction(desc);

    transactions.push({
      id:          `pdf-${i}-${Date.now()}`,
      date,
      description: desc,
      amount,
      category:    isPayment ? 'Payment' : detectCategory(desc),
      isPayment,
      source:      'pdf',
    });
  }

  return transactions;
}

export async function parseStatementPdf(file) {
  const pdfjsLib     = await loadPdfjs();
  const arrayBuffer  = await file.arrayBuffer();
  const pdf          = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page        = await pdf.getPage(p);
      const textContent = await page.getTextContent();
      let prevY = null;
      for (const item of textContent.items) {
        const y = item.transform?.[5];
        if (prevY !== null && Math.abs(y - prevY) > 5) fullText += '\n';
        fullText += item.str + ' ';
        prevY = y;
      }
      fullText += '\n';
    }
  } finally {
    pdf.destroy();
  }

  const transactions = parsePdfText(fullText);
  return { transactions, count: transactions.length };
}
