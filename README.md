# FlowBridge — Cash Gap Resolution Engine

FlowBridge is a distributor-focused Cash Gap Resolution Engine and Retailer Payment Identification workbench built with **React + TypeScript + Vite**, **Node.js + Express + TypeScript**, and **PostgreSQL (`pg`)**.

## Five-Stage Cash Resolution Loop
1. **PREDICT**: Deterministic `bigint` paise end-of-day cash forecast from Day 0, flagging the first date balance falls below the configured minimum.
2. **EXPLAIN**: Traces exact invoices, supplier bills, operating expenses, and evidence status behind the gap + Invoice Chase Priority ranking.
3. **RESOLVE**: Bounded resolution search strictly within distributor-approved limits, isolated What-If / Shockwave simulator, and Emergency / No-Feasible-Plan Survival Mode fallback.
4. **TRACK**: Commitment lifecycle (`PROPOSED` -> `AGREED` / `COMPLETED` / `FAILED` / `CANCELLED` / `AT_RISK`) where proposals never become agreements until a human records the reply.
5. **VERIFY**: Promise Failure Radar and Actual-vs-Plan verification comparing imported/manual bank transactions against commitments and recalculating the forecast.

## Retailer Payment Identification & Integrity Rules
- Registers internal Retailer IDs (e.g., `FB-R001`) with verified UPI IDs and bank account references stored **only** as masked values + server-side HMAC-SHA256 digests (`IDENTIFIER_HMAC_SECRET`). Never stores UPI PINs, OTPs, passwords, or card credentials.
- Matches incoming credits strictly via explicit invoice/payment reference or exact match against a verified payer identifier HMAC. Ambiguous or incomplete rows stay queued (`AMBIGUOUS` / `UNMATCHED`) without guessing.
- Uses `UNIQUE (business_id, transaction_fingerprint)` to prevent duplicate credit on repeated CSV/manual imports.
- Allocates payments inside PostgreSQL transactions (`payment_allocations` + trigger-verified `customer_invoices` updates) supporting partial payments, overpayments (`retailer_credit_ledger`), and non-destructive reversals.
- **MVP Boundary**: Supports CSV imports, manual demo entries, and seeded synthetic records only; does not connect to live bank or UPI feeds.

---

## PostgreSQL Database Setup

### 1. Create the Database
Ensure PostgreSQL 14+ is running locally (or provide a remote PostgreSQL `DATABASE_URL`). Create the database:

```sql
CREATE DATABASE flowbridge;
```

Or via `psql` / `createdb`:

```bash
createdb -U postgres flowbridge
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` in the repository root and set `DATABASE_URL` and strong HMAC secrets:

```bash
cp .env.example .env
```

Required variables validated at startup via Zod:
- `DATABASE_URL` (e.g. `postgresql://postgres:postgres@localhost:5432/flowbridge`)
- `IDENTIFIER_HMAC_SECRET` (16+ chars, 32+ random chars recommended)
- `TX_FINGERPRINT_SECRET` (16+ chars, 32+ random chars recommended)
- `PORT` (default `4000`)
- `CORS_ORIGIN` (default `http://localhost:5173`)
- `VITE_API_BASE_URL` (default `http://localhost:4000/api/v1`)

### 3. Install Dependencies, Migrate, Seed, and Verify DB
```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm db:verify
```

`pnpm db:seed` populates the synthetic blueprint demo (`DEMO-DIST-01`):
- Day 0 opening cash `₹80,000.00`
- Supplier Bill `S-2041` (`₹95,000.00`) & Operating Expense `B-0007` (`₹15,000.00`) due Day 5 (`-₹30,000.00` first breach)
- Customer B Invoice `C-3307` (`₹60,000.00`) due Day 10 (`UNCONFIRMED` -> `+₹30,000.00` recovery)
- Customer A Invoice `C-3301` (`₹20,000.00`) due Day 14 (illustrative early-receipt candidate for Plan A)
- Separate synthetic retailer payment identification demo: `FB-R001` with `DEMO-R001-INV1` (`₹10,000.00`, due Day 25) + verified UPI ID + incoming `₹1,000.00` transaction awaiting human allocation confirmation (`₹10,000.00` -> `₹9,000.00`).

### 4. Run Backend, Frontend, and Tests
```bash
# Run full workspace TypeScript build
pnpm build

# Run unit & domain tests
pnpm test

# Run PostgreSQL + /api/v1 integration suite (requires running PostgreSQL)
pnpm --filter @flowbridge/backend test:db

# Run backend API (http://localhost:4000)
pnpm dev:backend

# Run frontend UI (http://localhost:5173)
pnpm dev:frontend
```

---

## REST API Contract (`/api/v1`)

All monetary values are serialized as integer paise decimal strings (`amountPaise`, `openingCashPaise`, `minimumCashPaise`, `outstandingPaise`). Optional `?businessId=<uuid>` or `x-business-id` header scopes to a specific business (defaults to the primary active business). Error responses follow:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed.", "details": [] } }
```

### Health, Business & Dashboard
- **`GET /api/v1/health`** -> `200 { "ok": true, "database": "flowbridge", "version": "..." }`
- **`GET /api/v1/business`** -> `200 { "business": { "id": "...", "openingCashPaise": "8000000", "minimumCashPaise": "0", "allocationPolicy": "OLDEST_DUE_FIRST" } }`
- **`PATCH /api/v1/business/settings`**
  - Request: `{ "openingCashPaise": "8000000", "openingCashDate": "2026-11-11", "minimumCashPaise": "0", "allocationPolicy": "OLDEST_DUE_FIRST" }`
  - Response: `200 { "business": { ... } }`
- **`GET /api/v1/dashboard/summary?horizonDays=15`**
  - Response: `200 { "cashTodayPaise": "8000000", "totalReceivablesPaise": "9000000", "totalPayablesPaise": "11000000", "firstBreachDate": "2026-11-16", "shortfallPaise": "3000000", "unmatchedPaymentCount": 0, "commitmentsAtRiskCount": 0 }`
- **`GET /api/v1/businesses`**, **`POST /api/v1/businesses`**, **`GET /api/v1/businesses/:businessId/dashboard?horizonDays=15`**

### Retailers & Payment Identifiers
- **`GET /api/v1/retailers`**, **`POST /api/v1/retailers`**
  - Request (`POST`): `{ "retailerCode": "FB-R002", "name": "Apex Kirana", "creditTermsDays": 30, "reliabilityScore": 85 }`
  - Response (`201`): `{ "retailer": { "id": "...", "retailerCode": "FB-R002", "unappliedCreditPaise": "0" } }`
- **`GET /api/v1/retailers/:retailerId`**, **`PATCH /api/v1/retailers/:retailerId`**
  - Request (`PATCH`): `{ "status": "ACTIVE", "reliabilityScore": 90 }`
- **`GET /api/v1/retailers/:retailerId/payment-identifiers`**, **`POST /api/v1/retailers/:retailerId/payment-identifiers`**
  - Request (`POST`): `{ "identifierType": "UPI_ID", "rawValue": "apex@okaxis", "displayLabel": "Primary UPI", "verified": true }`
  - Response (`201`): `{ "identifier": { "id": "...", "identifierType": "UPI_ID", "maskedValue": "ap***@okaxis", "verifiedAt": "..." } }`
- **`PATCH /api/v1/retailers/:retailerId/payment-identifiers/:identifierId`**
  - Request: `{ "isActive": false, "verified": true }`
- **`GET /api/v1/retailers/:retailerId/ledger`**
  - Response: `200 { "retailer": { ... }, "invoices": [], "allocatedReceipts": [], "totalInvoicedPaise": "...", "totalCollectedPaise": "...", "outstandingBalancePaise": "...", "unappliedCreditPaise": "0" }`
- **`GET /api/v1/retailers/:retailerId/payment-history`** -> `200 { "retailer": { ... }, "payments": [], "allocations": [], "creditEvents": [] }`

### Invoices, Suppliers, Bills & Operating Expenses
- **`GET /api/v1/invoices`**, **`POST /api/v1/invoices`**
  - Request (`POST`): `{ "retailerId": "...", "invoiceNumber": "C-3308", "invoiceDate": "2026-11-01", "dueDate": "2026-11-22", "totalAmountPaise": "1500000", "evidenceStatus": "UNCONFIRMED" }`
- **`GET /api/v1/invoices/chase-priority?beforeDate=2026-11-16`** -> ranked open receivables before first cash gap.
- **`GET /api/v1/invoices/:id`**, **`PATCH /api/v1/invoices/:id`** (`{ "evidenceStatus": "CONFIRMED_PROMISE" }`)
- **`GET /api/v1/suppliers`**, **`POST /api/v1/suppliers`**
- **`GET /api/v1/supplier-bills`**, **`POST /api/v1/supplier-bills`**
- **`GET /api/v1/expenses`**, **`POST /api/v1/expenses`**

### Bank Imports, Payment Matching & Allocation
- **`POST /api/v1/imports/bank-transactions`**
  - Request: `{ "filename": "nov11.csv", "csvText": "direction,payment_method,external_transaction_reference,amount_paise,transaction_timestamp,value_date\n..." }` (or `{ "rows": [...] }`)
  - Response (`201`): `{ "batchId": "...", "totalRows": 3, "insertedRows": 2, "duplicateRows": 1, "errorRows": 0, "errors": [], "insertedTransactions": [] }`
- **`POST /api/v1/payments/manual`** -> single manual demo transaction (`409 DUPLICATE_TRANSACTION` on duplicate fingerprint).
- **`GET /api/v1/payments?from=2026-11-11&to=2026-11-26&method=UPI&matchStatus=MATCHED`**
- **`GET /api/v1/payments/match-queue`** -> `{ "queue": [...], "total": 1 }` (all non-reversed `UNMATCHED` / `AMBIGUOUS` inflows).
- **`GET /api/v1/payments/:paymentId`**, **`GET /api/v1/payments/:paymentId/allocation-preview`**
  - Response (`allocation-preview`): `200 { "preview": { "paymentId": "...", "lines": [{ "invoiceNumber": "DEMO-R001-INV1", "proposedAllocatePaise": "100000", "postAllocationOutstandingPaise": "900000" }], "requiresConfirmation": true } }`
- **`POST /api/v1/payments/:paymentId/resolve-match`**
  - Request: `{ "retailerId": "...", "note": "Verified on call", "allocations": [{ "invoiceId": "...", "amountPaise": "100000" }] }`
- **`POST /api/v1/payments/:paymentId/allocate`**
  - Request: `{ "allocations": [{ "invoiceId": "...", "amountPaise": "100000", "allocationMethod": "OLDEST_DUE_FIRST" }], "creditRemainderAsOverpayment": true }`
- **`POST /api/v1/payments/:paymentId/reverse`** (`{ "reason": "Cheque bounce / reversal" }`)

### Forecast, Bounded Resolution & What-If Scenarios
- **`GET /api/v1/forecast?from=2026-11-11&to=2026-11-26&scenarioId=`**
- **`POST /api/v1/forecast/recalculate`** -> persists immutable snapshot (`201 { "snapshot": { ... }, "forecast": { ... } }`).
- **`GET /api/v1/forecast/:snapshotId`**
- **`POST /api/v1/resolution/limits`** -> updates `approvalLimits` (`maxEarlyRequestPct`, `maxEarlyDays`, `defaultMaxSupplierDeferralPct`, `defaultMaxSupplierDeferralDays`, `protectEssentialExpenses`, `maxActionsPerPlan`).
- **`POST /api/v1/resolution/run`** -> evaluates 3×5×2 (30) bounded search combinations (`200 { "resolution": { "status": "FEASIBLE_FOUND", "totalCombinationsEvaluated": 30, "feasiblePlans": [...] } }`).
- **`GET /api/v1/scenarios`**, **`POST /api/v1/scenarios`**, **`POST /api/v1/scenarios/evaluate`**, **`GET /api/v1/scenarios/:id`**, **`POST /api/v1/scenarios/:scenarioId/run`**

### Commitments & Verification Radar
- **`GET /api/v1/commitments`**, **`POST /api/v1/commitments`** (creates `PROPOSED` commitment with `humanReplyRecorded: false`).
- **`PATCH /api/v1/commitments/:id/status`**
  - Request: `{ "status": "AGREED", "humanReplyBy": "Ramesh", "humanReplyChannel": "WHATSAPP", "agreedAmountPaise": "2000000", "agreedDate": "2026-11-15" }`
- **`GET /api/v1/risk/promise-failure-radar`**, **`POST /api/v1/risk/promise-failure-radar`** (`{ "horizonDays": 16, "simulatedDelays": [{ "invoiceId": "...", "delayDays": 3 }] }`)
- **`POST /api/v1/verification/reconcile`** (`{ "asOfDate": "2026-11-15", "assumeBankDataComplete": false }`) -> returns per-commitment status (`MATCHED`, `PARTIAL`, `MISSED`, `UNKNOWN_NEEDS_REVIEW`, `PENDING_FUTURE`) + `radar`.
```


#   F l o w B r i d g e  
 #   F l o w B r i d g e  
 #   F l o w B r i d g e  
 #   F l o w B r i d g e  
 