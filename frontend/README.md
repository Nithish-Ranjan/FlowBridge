# FlowBridge Frontend

Distributor-focused Cash Gap Resolution Engine dashboard built with React 19, TypeScript, and Vite.

## Theme & Design System

The frontend follows the professional fintech dark-navy visual standard:
- **Base Background**: `#0f172a` (slate dark navy)
- **Surfaces & Cards**: `#1e293b` with border `#334155`
- **Primary Brand Accent**: `#06b6d4` (Cyan)
- **Verified / Positive**: `#0d9488` (Teal) / `#16a34a` (Green)
- **Warning / Unconfirmed**: `#d97706` (Amber)
- **Breach / Shortfall**: `#e11d48` (Rose)
- **Scenario / What-If**: `#7c3aed` (Violet)

## Navigation & Working Areas

Navigation is structured as a fixed left sidebar with grouped sections:

### 1. Main
- **Overview Dashboard** (`overview`): Executive summary with 8 financial KPI cards (Cash Today, Receivables, Payables, First Breach Date, Shortfall, Unmatched Transactions, Commitments at Risk, Data Trust Score), quick action shortcuts, invoice chase priority table, and five-stage engine status pills.

### 2. Cash Flow (The Five-Stage Loop)
- **1. Predict & Explain** (`forecast`): Daily end-of-day cash balance curve (SVG), breach attribution panel, inflow/outflow driver list, and day-by-day cash schedule trace.
- **2. Resolve & What-If** (`resolve`): Distributor-approved limits configuration, bounded resolution plan search (30 combinations evaluated), interactive What-If scenario evaluations, and plan proposal actions.
- **3. Track Commitments** (`commitments`): Proposed vs agreed commitment tracker, human reply recorder (distributor confirmations via WhatsApp/Phone), and deterministic negotiation copilot templates.
- **4. Verify & Radar** (`verify`): Promise Failure Radar with automatic forecast reruns upon missed commitments, actual-vs-plan variance table, and immutable audit event ledger.

### 3. Operations
- **Payments Center** (`payments`): Retailer payment identification queue (exact identifier HMAC matching and invoice references), idempotent CSV bank statement import, manual demo payment entry, allocation preview with policy confirmation, and non-destructive payment reversals.
- **Ledgers & Setup** (`ledgers`): Business cash configuration (opening cash, minimum cash threshold, allocation policy), customer invoice ledger with evidence toggles, supplier bills, and operating expense liquidity firewall.

## API Integration

All endpoints connect to `/api/v1` on the backend (`http://localhost:4000/api/v1`):
- `GET /api/v1/businesses`, `GET /api/v1/businesses/:id/dashboard`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/forecast`, `POST /api/v1/forecast/recalculate`
- `POST /api/v1/resolution/run`, `POST /api/v1/resolution/limits`
- `POST /api/v1/scenarios/evaluate`, `POST /api/v1/scenarios`, `POST /api/v1/scenarios/:id/run`
- `GET /api/v1/commitments`, `POST /api/v1/commitments`, `PATCH /api/v1/commitments/:id/status`
- `POST /api/v1/risk/promise-failure-radar`
- `GET /api/v1/payments`, `GET /api/v1/payments/match-queue`, `POST /api/v1/payments/manual`
- `POST /api/v1/payments/:id/resolve-match`, `GET /api/v1/payments/:id/allocation-preview`, `POST /api/v1/payments/:id/allocate`, `POST /api/v1/payments/:id/reverse`
- `POST /api/v1/imports/bank-transactions`
- `GET /api/v1/retailers`, `POST /api/v1/retailers`, `GET /api/v1/retailers/:id/ledger`
- `POST /api/v1/retailers/:id/payment-identifiers`
- `GET /api/v1/invoices`, `POST /api/v1/invoices`, `PATCH /api/v1/invoices/:id`
- `GET /api/v1/suppliers`, `POST /api/v1/suppliers`
- `GET /api/v1/supplier-bills`, `POST /api/v1/supplier-bills`
- `GET /api/v1/expenses`, `POST /api/v1/expenses`

## Currency & Precision Rule

All amounts are stored and transferred as integer paise strings (e.g. `"2000000"` = ₹20,000.00). No floating-point math is performed in the frontend; formatting uses `formatINR()` from `@flowbridge/shared`.

## Build & Run

```bash
# In the repository root:
pnpm --filter @flowbridge/frontend build

# Run Vite dev server:
pnpm --filter @flowbridge/frontend dev
```

