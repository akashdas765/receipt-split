# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `mobile/`:

```bash
npm run dev        # local dev server (Vite)
npm run build      # production build → dist/
npm run preview    # preview production build locally
netlify deploy --prod  # build + deploy to Netlify (dormant, kept in sync but not primary)
vercel --prod          # build + deploy to Vercel (primary deploy target)
```

## Architecture

**ReceiptSplit** is a React + Vite web app that lets users photograph receipts, split line items among Splitwise group members, and post the expense — all in one flow.

### User flow

1. **Login/Signup** — Firebase Auth. The user's Splitwise API key is stored in Firestore (`users/{uid}.splitwise_api_key`) and loaded into the in-memory `session` singleton on login.
2. **ScanPage** — User uploads an image or PDF. PDFs are rendered to JPEG via pdf.js (loaded lazily, only on first PDF upload) before being sent. The image is passed as base64 to Groq's `meta-llama/llama-4-scout-17b-16e-instruct`, which returns structured JSON (merchant, date, items, subtotal, tax, total). If the item sum is >12% off the subtotal, a second Groq call is made with a correction prompt. The parsed receipt is saved to Firestore and the user is navigated to DetailPage.
3. **DetailPage** — User assigns each line item to group members (fetched from Splitwise), sets a tax rate, and toggles individual items as tax-exempt. `grandTotal()` is recalculated live from items × (1 + taxRate). Grocery mode exempts `food` and `drink` category items from tax.
4. **ApprovePage** — Shows the per-person split. User picks who paid, then `postExpense` POSTs to Splitwise. On success the receipt is saved back to Firestore with `approved: true` and `grandTotal`.

### Key services

| File | Purpose |
|---|---|
| `src/services/firebase.js` | Firebase app init; exports `auth` and `db` |
| `src/services/auth.js` | signup / login / logout wrapping Firebase Auth; sets `session` |
| `src/services/session.js` | In-memory singleton holding `splitwiseKey` and `userId` — cleared on logout |
| `src/services/db.js` | Firestore CRUD for receipts under `users/{uid}/receipts`, paginated (20/page) |
| `src/services/groq.js` | Calls Groq's vision API; handles retry logic and strips tax/subtotal lines from item list |
| `src/services/splitwise.js` | `fetchGroups` and `postExpense`; all requests go through the CORS proxy (`postExpense` calls Splitwise's `update_expense` instead of `create_expense` when re-posting an already-approved receipt, to avoid duplicating it) |
| `src/config.js` | Re-exports `VITE_*` env vars as named constants |

### Splitwise CORS proxy

Splitwise doesn't allow browser requests. `shared/splitwiseProxy.js` holds the actual proxy logic (validates the request, forwards to Splitwise, returns the response) as a framework-agnostic function; both `netlify/functions/splitwise.js` and `api/splitwise.js` (Vercel) are thin adapters around it, so the two deploy targets can't drift out of sync. The client passes the user's key via the `x-splitwise-key` request header; each adapter forwards it as `Authorization: Bearer`.

### Data shape

Receipts stored in Firestore:
- `total` — raw OCR total from the receipt image
- `grandTotal` — recalculated total (items + tax); written on approval; used for display on HomePage
- `items[].split_members` — array of Splitwise member ID strings assigned to that item
- `items[].tax_exempt` — 0 or 1

### Environment variables

All `VITE_*` — see `mobile/.env.example`. They are set on Netlify via `netlify env:set` and must also exist in `mobile/.env` for local dev. The Splitwise API key is **not** a build-time env var; it is stored per-user in Firestore and held in `session` at runtime.
