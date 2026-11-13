
import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  BrainCircuit,
  Clock3,
  Loader2,
  Sparkles,
} from 'lucide-react';

import { formatINR } from '@flowbridge/shared';
import {
  api,
  type RetailerDTO,
  type PaymentDelayPredictionResponse,
} from '../api/client';

interface PaymentDelayPredictionPanelProps {
  businessId: string;
  retailer: RetailerDTO;
}

function localDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

function formatPercentage(value: number | null): string {
  return value === null ? 'Not available' : `${(value * 100).toFixed(1)}%`;
}

export function PaymentDelayPredictionPanel({
  businessId,
  retailer,
}: PaymentDelayPredictionPanelProps) {
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() =>
    localDateString(),
  );
  const [dueDate, setDueDate] = useState(() =>
    addDays(
      localDateString(),
      Math.max(0, retailer.creditTermsDays || 30),
    ),
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] =
    useState<PaymentDelayPredictionResponse | null>(null);

  const handlePredict = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError(null);
    setResult(null);

    const amount = Number(invoiceAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a valid invoice amount greater than zero.');
      return;
    }

    if (!Number.isSafeInteger(Math.round(amount * 100))) {
      setError('The invoice amount is too large.');
      return;
    }

    if (dueDate < invoiceDate) {
      setError('Due date cannot be earlier than invoice date.');
      return;
    }

    setLoading(true);

    try {
      const response = await api.predictPaymentDelay(businessId, {
        retailerId: retailer.id,
        invoiceAmountPaise: String(Math.round(amount * 100)),
        invoiceDate,
        dueDate,
      });

      setResult(response);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to generate payment-delay prediction.',
      );
    } finally {
      setLoading(false);
    }
  };

  const predictionDays =
    result?.prediction.payment_delay_days ?? null;

  const timingText =
    predictionDays === null
      ? ''
      : predictionDays > 0
        ? `${predictionDays.toFixed(1)} days after due date`
        : predictionDays < 0
          ? `${Math.abs(predictionDays).toFixed(1)} days before due date`
          : 'On the due date';

  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 18,
        background: 'var(--surface)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <BrainCircuit size={21} color="#7C3AED" />
          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>
            AI Payment Delay Prediction
          </h4>
        </div>

        <span
          style={{
            background: '#FEF3C7',
            color: '#92400E',
            padding: '4px 9px',
            borderRadius: 20,
            fontSize: '0.68rem',
            fontWeight: 800,
          }}
        >
          EXPERIMENTAL MODEL
        </span>
      </div>

      <p
        style={{
          margin: '0 0 16px',
          color: 'var(--text-muted)',
          fontSize: '0.78rem',
          lineHeight: 1.5,
        }}
      >
        Estimate when {retailer.name} may pay for a proposed invoice
        using verified historical payment behaviour.
      </p>

      <form
        onSubmit={handlePredict}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 12,
          }}
        >
          <div className="field">
            <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              Invoice Amount (₹)
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="45000"
              value={invoiceAmount}
              onChange={(event) => setInvoiceAmount(event.target.value)}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              Invoice Date
            </label>
            <input
              type="date"
              required
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
            />
          </div>

          <div className="field">
            <label style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              Due Date
            </label>
            <input
              type="date"
              required
              min={invoiceDate}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        </div>

        <div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? (
              <>
                <Loader2 size={15} />
                Analysing payment history...
              </>
            ) : (
              <>
                <Sparkles size={15} />
                Predict Payment Delay
              </>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 11,
            borderRadius: 8,
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            color: '#B91C1C',
            fontSize: '0.78rem',
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
          }}
        >
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 11,
            border: '1px solid var(--border)',
            background: 'var(--surface-alt)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span style={{ fontSize: '0.78rem', fontWeight: 800 }}>
              Prediction Result
            </span>
            <span
              style={{
                fontSize: '0.67rem',
                fontWeight: 800,
                color: '#92400E',
                background: '#FEF3C7',
                padding: '4px 8px',
                borderRadius: 12,
              }}
            >
              {result.model?.status ?? 'EXPERIMENTAL'}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              margin: '15px 0',
            }}
          >
            <Clock3 size={29} color="#7C3AED" />
            <div>
              <div
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 900,
                  lineHeight: 1.2,
                  color: 'var(--text)',
                }}
              >
                {predictionDays?.toFixed(1)} days
              </div>
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                }}
              >
                {timingText}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 1fr))',
              gap: 10,
            }}
          >
            <div>
              <div className="muted" style={{ fontSize: '0.68rem' }}>
                Prior fully paid invoices
              </div>
              <strong>{result.historySummary.priorPaidInvoiceCount}</strong>
            </div>

            <div>
              <div className="muted" style={{ fontSize: '0.68rem' }}>
                Historical late rate
              </div>
              <strong>
                {formatPercentage(
                  result.historySummary.priorLatePaymentRate,
                )}
              </strong>
            </div>

            <div>
              <div className="muted" style={{ fontSize: '0.68rem' }}>
                Average payment delay
              </div>
              <strong>
                {result.historySummary.priorAveragePaymentDelayDays === null
                  ? 'Not available'
                  : `${result.historySummary.priorAveragePaymentDelayDays.toFixed(1)} days`}
              </strong>
            </div>

            <div>
              <div className="muted" style={{ fontSize: '0.68rem' }}>
                Outstanding invoices
              </div>
              <strong>
                {result.historySummary.priorOutstandingInvoiceCount}
              </strong>
            </div>

            <div>
              <div className="muted" style={{ fontSize: '0.68rem' }}>
                Outstanding amount
              </div>
              <strong>
                {formatINR(
                  String(
                    Math.round(
                      result.historySummary.priorOutstandingInvoiceAmountInr * 100,
                    ),
                  ),
                )}
              </strong>
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid var(--border)',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            <strong>Model:</strong> {result.model?.type ?? 'XGBRegressor'}
            {' · '}
            <strong>Data:</strong> {result.model?.data_type ?? 'synthetic'}
            <p style={{ margin: '6px 0 0' }}>
              {result.disclaimer ??
                'Experimental prediction trained on synthetic data. Not suitable for financial decisions without real-world validation.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
