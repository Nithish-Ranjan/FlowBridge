# FlowBridge XGBoost Payment Delay Inference Service

## Overview
This directory houses the Python inference boundary for the pre-trained XGBoost retailer payment-delay prediction model in FlowBridge.

## Model Artefact Search & Audit Findings
In accordance with system requirements, a full repository search was performed across all directories and commit histories for:
- `.json`, `.ubj`, `.pkl`, `.pickle`, `.joblib` model files
- Python model training scripts and preprocessing pipelines
- Evaluation reports and validation split records

### Audit Status
1. **Model Artefact**: No pre-compiled `.json` or `.ubj` model artefact was found in the initial Git commit.
2. **Feature Schema Contract**: The feature contract reconstructed by `backend/src/routes/v1/mlPredictionRoutes.ts` was verified and strictly documented in `inference_service.py`.
3. **Safety & Zero-Fabrication Enforcement**:
   - Per requirements, **no fake model weights or mock predictions are used**.
   - If the model file is not mounted at `models/xgboost_payment_delay.json`, the endpoint cleanly reports `503 SERVICE UNAVAILABLE` with diagnostic details.
   - The backend `retailerRiskService.ts` transparently flags `modelPrediction.status = 'SERVICE_UNAVAILABLE'` or `'MODEL_NOT_DEPLOYED'` and computes deterministic reliability scores from verified bank and invoice records.

## Model Specification & Contract
- **Algorithm**: XGBoost Regressor (`xgb.Booster` or `XGBRegressor`)
- **Target Variable**: Continuous numerical delay in days past invoice due date (`payment_delay_days`, where `<= 0` indicates on-time or early settlement, and `> 0` indicates late settlement).
- **Inference Endpoint**: `POST /predict`
- **Port**: Default `8001` (configurable via `PORT` / `FLOWBRIDGE_ML_API_URL`)

### Expected 10-Feature Vector
| # | Feature Name | Type | Description |
|---|--------------|------|-------------|
| 1 | `invoice_amount_inr` | float | Gross invoice amount in ₹ |
| 2 | `payment_terms_days` | int | Days between invoice date and due date |
| 3 | `customer_relationship_months` | int | Months counterparty has traded with distributor |
| 4 | `prior_paid_invoice_count` | int | Count of historical settled invoices |
| 5 | `prior_late_payment_rate` | float (0.0-1.0) | Fraction of settled invoices that were late |
| 6 | `prior_avg_payment_delay_days` | float | Historical mean delay in days |
| 7 | `prior_on_time_or_early_rate` | float (0.0-1.0) | Fraction settled on or before due date |
| 8 | `prior_outstanding_invoice_count` | int | Count of currently uncollected open invoices |
| 9 | `prior_outstanding_invoice_amount_inr` | float | Total ₹ outstanding across open invoices |
| 10 | `invoice_issue_month` | int (1-12) | Calendar month invoice was issued |

## Deploying the Model
1. Place the trained XGBoost model export file in `backend/ml/models/xgboost_payment_delay.json` (or `.ubj`).
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start the inference service:
   ```bash
   python inference_service.py
   ```
4. Verify readiness:
   ```bash
   curl http://127.0.0.1:8001/health
   ```

