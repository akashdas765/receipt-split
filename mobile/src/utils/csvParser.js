import Papa from 'papaparse';
import { detectCategory } from './categoryDetector';
import { isPaymentTransaction, isIncomeTransaction } from './paymentDetector';

// Smart CSV parser that handles many common bank/CC export formats: Chase,
// BoA, Wells Fargo, Capital One, Citi, Amex, Discover. Ported from
// akashdas765/personal-expense-manager's csvParser.js.

const DATE_FIELDS   = ['date','transaction date','trans date','posted date','posting date','value date','transdate'];
const AMOUNT_FIELDS = ['amount','debit','charge','transaction amount','withdrawal','amt'];
const DESC_FIELDS   = ['description','merchant','memo','name','payee','transaction description','narration','details'];
const CREDIT_FIELDS = ['credit','deposit','payment'];

function findCol(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.findIndex(h => h.includes(c));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function parseAmount(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const neg = s.match(/^\((\d[\d,.]*)\)$/);
  if (neg) return -parseFloat(neg[1].replace(/,/g, ''));
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
    const [m, d, y] = s.split('-');
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().substring(0,10);
  return s;
}

export function parseCsv(text, sourceName = 'csv') {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: h => h.trim(),
      complete: ({ data, meta, errors }) => {
        if (errors.length && !data.length) {
          return reject(new Error(errors[0].message));
        }

        const headers = meta.fields || [];
        const dateCol   = findCol(headers, DATE_FIELDS);
        const amtCol    = findCol(headers, AMOUNT_FIELDS);
        const descCol   = findCol(headers, DESC_FIELDS);
        const creditCol = findCol(headers, CREDIT_FIELDS);

        if (!dateCol || !descCol) {
          return reject(new Error('Could not identify Date or Description columns. Please check the CSV format.'));
        }

        const transactions = [];
        let idxCounter = 0;

        for (const row of data) {
          const rawDate   = row[dateCol];
          const rawDesc   = row[descCol];
          let   rawAmt    = amtCol    ? row[amtCol]    : null;
          const rawCredit = creditCol ? row[creditCol] : null;

          const date = normalizeDate(rawDate);
          if (!date) continue;

          const desc = String(rawDesc || '').trim();
          if (!desc) continue;

          let amount = parseAmount(rawAmt);
          let isCreditRow = false;

          // Negative in the amount column, or any value in a dedicated
          // credit/deposit column, means money came IN (a payment/refund)
          // rather than out — kept as a credit now instead of being
          // dropped, so bill payments/refunds actually show up.
          if (amount != null && amount < 0) {
            isCreditRow = true;
            amount = Math.abs(amount);
          } else if ((amount == null || amount === 0) && rawCredit) {
            const cr = parseAmount(rawCredit);
            if (cr != null && cr !== 0) { isCreditRow = true; amount = Math.abs(cr); }
          }

          if (amount == null || amount === 0) continue;

          transactions.push({
            id:          `${sourceName}-${idxCounter++}-${Date.now()}`,
            date,
            description: desc,
            amount,
            source:      sourceName,
            category:    isCreditRow ? 'Payment' : detectCategory(desc),
            isPayment:   isCreditRow || isPaymentTransaction(desc),
            isCredit:    isCreditRow,
            isIncome:    isCreditRow && isIncomeTransaction(desc),
          });
        }

        resolve({ transactions, count: transactions.length });
      },
      error: reject,
    });
  });
}
