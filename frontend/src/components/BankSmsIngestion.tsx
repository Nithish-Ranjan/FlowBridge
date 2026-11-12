import React, { useState, useEffect } from 'react';
import { Smartphone, CheckCircle, ArrowRight, RefreshCw, FileText, AlertCircle, Copy } from 'lucide-react';
import { api } from '../api/client';
import { formatINR } from '@flowbridge/shared';

interface BankSmsIngestionProps {
  businessId: string;
  onPaymentMatched?: () => void;
}

const SAMPLE_SMS = [
  {
    label: 'HDFC ₹25,000 UPI',
    text: 'HDFC Bank: Rs 25,000.00 credited to a/c **4012 on 11-Nov-26 by a/c linked to VPA ramesh@okhdfcbank (UPI Ref no 431789214567). Bal: Rs 1,45,200.00',
    header: 'HDFCBK',
  },
  {
    label: 'ICICI ₹15,500 UPI',
    text: 'Dear Customer, your Acct XX9021 has been credited with INR 15,500.00 on 10-Nov-26 by UPI/431788123999/Anand Kirana. Available Balance is INR 88,400.00.',
    header: 'ICICIB',
  },
  {
    label: 'SBI ₹40,000 Transfer',
    text: 'Your a/c no. XXXXXXXX1234 is credited by Rs 40,000.00 on 11Nov26 by transfer from Suresh UPI Ref 431899120033. Bal Rs: 92,300.00 - SBI',
    header: 'SBIINB',
  },
];

export function BankSmsIngestion({ businessId, onPaymentMatched }: BankSmsIngestionProps) {
  const [rawSms, setRawSms] = useState('');
  const [senderHeader, setSenderHeader] = useState('HDFCBK');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedResult, setParsedResult] = useState<any | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [evidenceList, setEvidenceList] = useState<any[]>([]);
  const [matchSuccess, setMatchSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadEvidence();
  }, [businessId]);

  async function loadEvidence() {
    try {
      const res = await api.getSmsEvidence(businessId);
      setEvidenceList(res.evidence || []);
    } catch (e) {
      // ignore
    }
  }

  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    if (!rawSms.trim()) return;

    setError(null);
    setMatchSuccess(null);
    setLoading(true);

    try {
      const res = await api.parseBankSms(businessId, rawSms, senderHeader);
      setParsedResult(res.parsed);
      setCandidates(res.candidates || []);
      await loadEvidence();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Smartphone size={20} color="#2563EB" /> Real Indian Bank SMS Transaction Ingestion Engine
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Parse incoming credit notifications directly from HDFC, ICICI, SBI, Axis, Kotak and match against open invoices.
          </p>
        </div>
        <span className="badge badge-info">UPI / IMPS / NEFT Auto-Parser</span>
      </div>

      {/* Sample SMS Quick Fill Pills */}
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginRight: 10 }}>
          Sample Live SMS:
        </span>
        <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8 }}>
          {SAMPLE_SMS.map((sample) => (
            <button
              key={sample.label}
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setRawSms(sample.text);
                setSenderHeader(sample.header);
              }}
              style={{ fontSize: '0.76rem' }}
            >
              <Copy size={12} /> {sample.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleParse} style={{ marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr auto', gap: 10, alignItems: 'start' }}>
          <div className="field">
            <label>Sender Bank Header</label>
            <input
              type="text"
              placeholder="e.g. HDFCBK, ICICIB"
              value={senderHeader}
              onChange={(e) => setSenderHeader(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Paste Raw SMS Body</label>
            <textarea
              rows={2}
              placeholder="Paste raw SMS text received on distributor mobile..."
              value={rawSms}
              onChange={(e) => setRawSms(e.target.value)}
              required
            />
          </div>

          <div style={{ marginTop: 22 }}>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ height: 38 }}>
              {loading ? 'Parsing...' : 'Extract & Match'}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="banner banner-error" style={{ marginBottom: 14 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {matchSuccess && (
        <div className="banner banner-success" style={{ marginBottom: 14 }}>
          <CheckCircle size={16} /> {matchSuccess}
        </div>
      )}

      {/* Extracted Details Card */}
      {parsedResult && (
        <div style={{ background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge badge-info" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                Bank: {parsedResult.bank}
              </span>
              <span className="badge badge-success" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                {parsedResult.direction}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Confidence: {parsedResult.confidenceScore}%
              </span>
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--green)' }}>
              {parsedResult.amountFormatted}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, fontSize: '0.84rem' }}>
            <div>
              <span className="muted">UPI / UTR Ref:</span> <br />
              <strong>{parsedResult.referenceNumber || 'N/A'}</strong>
            </div>
            <div>
              <span className="muted">Account Tail:</span> <br />
              <strong>{parsedResult.accountTail ? `**${parsedResult.accountTail}` : 'N/A'}</strong>
            </div>
            <div>
              <span className="muted">Counterparty Hint:</span> <br />
              <strong>{parsedResult.counterpartyHint || 'N/A'}</strong>
            </div>
            <div>
              <span className="muted">Value Date:</span> <br />
              <strong>{parsedResult.transactionDate}</strong>
            </div>
          </div>

          {/* Candidate Invoices */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <h4 style={{ margin: '0 0 10px', fontSize: '0.9rem', color: 'var(--text)' }}>
              Matched Invoices ({candidates.length})
            </h4>

            {candidates.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                No open invoice matches found with this exact balance or retailer hint. Transaction is saved for unallocated credit review.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Retailer</th>
                      <th>Due Date</th>
                      <th>Outstanding Balance</th>
                      <th>Match Score</th>
                      <th>Match Reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((cand, idx) => (
                      <tr key={idx}>
                        <td><strong>{cand.invoice.invoice_number}</strong></td>
                        <td>{cand.invoice.retailer_name}</td>
                        <td className="num">{cand.invoice.due_date}</td>
                        <td className="num">{formatINR(cand.invoice.balance_due_paise)}</td>
                        <td>
                          <span className="badge badge-success">{cand.matchScore}% Match</span>
                        </td>
                        <td style={{ fontSize: '0.78rem' }}>
                          {cand.reasons.join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historical Evidence Log */}
      {evidenceList.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Recent Ingested SMS Evidence ({evidenceList.length})
          </h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Bank Header</th>
                  <th>Amount</th>
                  <th>UPI / UTR Ref</th>
                  <th>Counterparty Hint</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {evidenceList.slice(0, 5).map((ev) => (
                  <tr key={ev.id}>
                    <td className="muted" style={{ fontSize: '0.78rem' }}>{new Date(ev.created_at).toLocaleTimeString()}</td>
                    <td><span className="code-pill">{ev.sender_header}</span></td>
                    <td className="num">{formatINR(ev.parsed_amount_paise)}</td>
                    <td><span className="code-pill">{ev.parsed_reference_number || 'N/A'}</span></td>
                    <td>{ev.parsed_counterparty_hint || '—'}</td>
                    <td><span className="badge badge-success">{ev.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

