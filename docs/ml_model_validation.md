# FlowBridge ML Model Validation & Operational Threshold Specification

## 1. Executive Summary
This document establishes the validation framework, leakage prevention protocols, operational threshold guidelines, and separation boundaries for the XGBoost retailer payment delay prediction model within FlowBridge.

Deterministic financial calculations (such as bank balances, ledger totals, dated cash gaps, and interest accruals) are strictly separated from forward-looking machine learning predictions.

---

## 2. Validation & Splitting Methodology

### Temporal (Out-of-Time) Split vs Random Split
- **Required Split Protocol**: Temporal / chronologically ordered train-test split.
  - Training Set: Invoices issued between Month 0 and Month $T$
  - Validation/Test Set: Invoices issued strictly after Month $T$
- **Rationale**: A random K-fold split creates catastrophic lookahead data leakage in supply chain financial models because distributor payment behavior exhibits seasonal macroeconomic correlation (e.g., festival inventory accumulation, quarterly GST filing cycles, and regional harvest liquidity).
- **Leakage Prevention**: All customer history features (e.g., `prior_paid_invoice_count`, `prior_late_payment_rate`, `prior_outstanding_invoice_amount_inr`) are computed as of the invoice issuance date using only payments and bank allocations whose value date and system timestamps strictly precede the invoice date.

---

## 3. Feature Availability & Target Distribution

### Prediction Timing
- Predictions are generated at the moment an invoice is created or when reviewing credit terms prior to shipment.
- All 10 features must be derivable without requiring any future knowledge or unverified claims.

### Target Distribution & Outlier Management
- In B2B wholesale distribution, payment delay (`completion_date - due_date`) exhibits heavy right skew:
  - 65–75% of invoices settle within $\pm 3$ days of due date.
  - 15–20% experience mild delays of 4–14 days.
  - 5–10% enter severe delinquency (> 30 days delay or default).
- The loss function in training must utilize Huber loss or Tweedie regression, or clamp extreme outlier delays at 90 days to prevent distorted gradient updates from anomalous dispute cases.

---

## 4. Evaluation Metrics Checklist

Before promoting any candidate XGBoost model to production, the following metrics must be evaluated on the holdout test set:

| Metric | Target Standard | Purpose |
|---|---|---|
| **Mean Absolute Error (MAE)** | $\le 4.2\text{ days}$ | Measures average prediction accuracy in calendar days |
| **Root Mean Squared Error (RMSE)** | $\le 6.8\text{ days}$ | Penalizes large outlier delay errors |
| **$R^2$ / Explained Variance** | $\ge 0.62$ | Verifies predictive lift above simple historical mean |
| **Delay Risk Classifier F1-Score** (at 7d threshold) | $\ge 0.78$ | Assesses binary risk classification accuracy |
| **PR-AUC (Precision-Recall AUC)** | $\ge 0.80$ | Evaluates precision across the minority late-payer class |
| **Calibration / Reliability Curve** | Brier score $\le 0.12$ | Ensures model probability aligns with observed default frequencies |

---

## 5. Cost Matrix & Operational Threshold Analysis

In commercial distribution, False Positives and False Negatives carry asymmetric business costs:

| Error Type | Scenario | Business Impact & Cost |
|---|---|---|
| **False Positive (Type I)** | Model predicts severe delay, but retailer would have paid on time. | **Opportunity Cost**: Unnecessarily reducing credit limit or demanding cash advance damages the commercial relationship and loses sales to competing distributors. Est. cost: 5–15% gross margin on lost orders. |
| **False Negative (Type II)** | Model predicts on-time payment, but retailer experiences severe 30d+ delay. | **Liquidity & Default Cost**: Distributor faces cash shortage, risks defaulting on supplier bills (e.g., FMCG consignment notes), incurs penalty interest, or suffers total bad debt write-off. Est. cost: 100% of unpaid invoice balance plus emergency borrowing fees. |

### Operational Decision Thresholds
Based on this asymmetric cost function, FlowBridge defines 5 calibrated tiers:

1. **Predicted Delay $\le 0$ days**: **Normal Credit Terms**. Standard 30-day term, full approved credit limit.
2. **Predicted Delay $1\text{ to }4$ days**: **Increased Monitoring**. Standard terms with automated WhatsApp reminder 3 days prior to due date.
3. **Predicted Delay $5\text{ to }10$ days**: **Reduced Credit Limit / Staged Release**. Reduce credit ceiling by 25–40% until recent invoices settle.
4. **Predicted Delay $> 10$ days**: **Manual Approval Required**. Commercial manager sign-off required before releasing consignments over ₹25,000.
5. **High Predicted Delay + Overdue Debt ($> 14$ days overdue)**: **Authorised Credit Hold**. Restricts new credit exposure.
   - *Important Regulatory Rule*: An authorised credit hold must restrict new credit exposure only; it must never prevent or reject the counterparty from settling their outstanding debt.

---

## 6. Separation of Deterministic and ML Layers
- **Deterministic Layer (Ground Truth)**: Cash balances, verified allocations, bank SMS reconciliations, and contractually binding due dates are computed with exact integer paise arithmetic (`bigint`).
- **ML Layer (Decision Support)**: Provides advisory probability and anticipated delay windows. An ML prediction alone cannot alter accounting ledgers or cancel legally binding invoices.

