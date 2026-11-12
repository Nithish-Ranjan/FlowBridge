import { useState } from 'react';
import { formatINR, paiseToString, rupeesToPaise, type PaymentTransactionDTO } from '@flowbridge/shared';
import type { AllocationPreviewResponse, WorkspacePayload } from '../api/client';
import { MatchStatusBadge, OriginBadge, StatusPill } from './Badge';

interface PaymentsViewProps {
  workspace: WorkspacePayload;
  onCreateRetailer: (body: { retailerCode: string; name: string; contactName?: string; creditTermsDays?: number }) => Promise<void>;
  onRegisterIdentifier: (
    retailerId: string,
    body: { identifierType: 'UPI_ID' | 'BANK_ACCOUNT'; rawValue: string; displayLabel: string },
  ) => Promise<void>;
  onRecordManualPayment: (body: {
    direction: 'INFLOW' | 'OUTFLOW';
    paymentMethod: 'UPI' | 'BANK_TRANSFER' | 'OTHER';
    externalTransactionReference?: string;
    explicitInvoiceReference?: string;
    payerIdentifierType?: 'UPI_ID' | 'BANK_ACCOUNT';
    payerIdentifierRaw?: string;
    payerDisplayName?: string;
    narration: string;
    amountPaise: string;
    transactionTimestamp: string;
    valueDate: string;
  }) => Promise<{ inserted: boolean; duplicate: boolean; ok?: boolean }>;
  onImportCsv: (filename: string, csvText: string) => Promise<{
    totalRows: number;
    insertedRows: number;
    duplicateRows: number;
    errorRows: number;
    ok?: boolean;
  }>;
  onManualMatch: (paymentId: string, retailerId: string, note: string) => Promise<boolean | void>;
  onLoadAllocationPreview: (paymentId: string) => Promise<AllocationPreviewResponse>;
  onConfirmAllocation: (
    paymentId: string,
    allocations: Array<{
      invoiceId: string;
      amountPaise: string;
      allocationMethod: 'EXPLICIT_INVOICE' | 'OLDEST_DUE_FIRST' | 'MANUAL_OVERRIDE';
    }>,
  ) => Promise<boolean | void>;
  onReversePayment: (paymentId: string, reason: string) => Promise<boolean | void>;
  busy: boolean;
}

const SAMPLE_CSV = `direction,payment_method,external_reference,invoice_reference,payer_identifier_type,payer_identifier,payer_name,narration,amount_inr,value_date,transaction_timestamp
INFLOW,UPI,UTR-DEMO-FBR001-1000,,UPI_ID,fb-r001.demo@okaxis,Metro Kirana,Duplicate of seeded ₹1000 tx,1000,2026-11-10,2026-11-10T14:30:00Z
INFLOW,UPI,UTR-CSV-ANAND-20001,,UPI_ID,anand.supermart@okhdfcbank,Anand Supermart,Verified UPI transfer,5000,2026-11-12,2026-11-12T10:00:00Z
INFLOW,BANK_TRANSFER,NEFT-CSV-UNMATCHED-01,,,Unknown Payer,,NEFT transfer with no verified ID or invoice ref,2500,2026-11-12,2026-11-12T11:30:00Z
INFLOW,UPI,UTR-CSV-CONFLICT-01,C-3307,UPI_ID,fb-r001.demo@okaxis,Mixed Signal,Conflicting UPI (FB-R001) and Ref (C-3307),1500,2026-11-12,2026-11-12T12:15:00Z`;

export function PaymentsView({
  workspace,
  onCreateRetailer,
  onRegisterIdentifier,
  onRecordManualPayment,
  onImportCsv,
  onManualMatch,
  onLoadAllocationPreview,
  onConfirmAllocation,
  onReversePayment,
  busy,
}: PaymentsViewProps) {
  const [retCode, setRetCode] = useState('');
  const [retName, setRetName] = useState('');
  const [idRetailerId, setIdRetailerId] = useState(workspace.retailers[0]?.id ?? '');
  const [idType, setIdType] = useState<'UPI_ID' | 'BANK_ACCOUNT'>('UPI_ID');
  const [idRaw, setIdRaw] = useState('');
  const [idLabel, setIdLabel] = useState('');

  // Manual demo payment
  const [manualAmountInr, setManualAmountInr] = useState('1000');
  const [manualMethod, setManualMethod] = useState<'UPI' | 'BANK_TRANSFER'>('UPI');
  const [manualRef, setManualRef] = useState('');
  const [manualInvRef, setManualInvRef] = useState('');
  const [manualPayerId, setManualPayerId] = useState('fb-r001.demo@okaxis');
  const [manualNarration, setManualNarration] = useState('Manual demo UPI receipt');
  const [manualDate, setManualDate] = useState(workspace.business.openingCashDate);

  // CSV Import
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [csvReport, setCsvReport] = useState<string | null>(null);

  // Match & Allocation Preview state
  const [manualMatchSelection, setManualMatchSelection] = useState<Record<string, string>>({});
  const [previewData, setPreviewData] = useState<AllocationPreviewResponse['preview'] | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmReverseId, setConfirmReverseId] = useState<string | null>(null);

  const isBusy = busy || localBusy;

  async function handleCreateRetailer(e: React.FormEvent) {
    e.preventDefault();
    if (!retCode.trim() || !retName.trim()) return;
    await onCreateRetailer({ retailerCode: retCode.trim(), name: retName.trim() });
    setRetCode('');
    setRetName('');
  }

  async function handleRegisterId(e: React.FormEvent) {
    e.preventDefault();
    if (!idRetailerId || !idRaw.trim() || !idLabel.trim()) return;
    await onRegisterIdentifier(idRetailerId, {
      identifierType: idType,
      rawValue: idRaw.trim(),
      displayLabel: idLabel.trim(),
    });
    setIdRaw('');
    setIdLabel('');
  }

  async function handleManualPayment(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    let parsedPaise: string;
    try {
      parsedPaise = paiseToString(rupeesToPaise(manualAmountInr));
    } catch (err) {
      setLocalError((err as Error).message);
      return;
    }
    const res = await onRecordManualPayment({
      direction: 'INFLOW',
      paymentMethod: manualMethod,
      externalTransactionReference: manualRef.trim() || undefined,
      explicitInvoiceReference: manualInvRef.trim() || undefined,
      payerIdentifierType: manualPayerId.trim()
        ? manualPayerId.includes('@')
          ? 'UPI_ID'
          : 'BANK_ACCOUNT'
        : undefined,
      payerIdentifierRaw: manualPayerId.trim() || undefined,
      narration: manualNarration.trim(),
      amountPaise: parsedPaise,
      transactionTimestamp: `${manualDate}T10:00:00.000Z`,
      valueDate: manualDate,
    });
    if (res.ok === false) {
      setCsvReport(null);
      return;
    }
    setCsvReport(
      res.duplicate
        ? 'Duplicate transaction blocked by unique transaction_fingerprint constraint (no second credit).'
        : 'Manual demo transaction recorded and evaluated for deterministic retailer match.',
    );
  }

  async function handleCsvImport() {
    setLocalError(null);
    const summary = await onImportCsv('demo_bank_feed.csv', csvText);
    if (summary.ok === false) {
      setCsvReport(null);
      return;
    }
    setCsvReport(
      `CSV Import complete: ${summary.totalRows} row(s) processed • ${summary.insertedRows} inserted • ${summary.duplicateRows} duplicate(s) blocked • ${summary.errorRows} error(s).`,
    );
  }

  async function handleOpenPreview(tx: PaymentTransactionDTO) {
    setLocalError(null);
    setLocalBusy(true);
    try {
      const res = await onLoadAllocationPreview(tx.id);
      setPreviewData(res.preview);
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setLocalBusy(false);
    }
  }

  async function handleConfirmPreview() {
    if (!previewData) return;
    const ok = await onConfirmAllocation(
      previewData.paymentId,
      previewData.lines.map((l) => ({
        invoiceId: l.invoiceId,
        amountPaise: l.proposedAllocatePaise,
        allocationMethod: l.allocationMethod,
      })),
    );
    if (ok !== false) {
      setPreviewData(null);
    }
  }

  return (
    <div>
      <div className="banner banner-warn">
        <div>
          <strong>MVP Payment-Integration Boundary:</strong> Supports CSV imports, manually entered demo transactions, and seeded records only. Does <strong>not</strong> connect to live UPI/bank accounts. Stores only masked values + server-side HMAC fingerprints (never UPI PINs, OTPs, passwords, or card data).
        </div>
      </div>

      {localError && (
        <div className="banner banner-error">
          <div><strong>Payment Action Error:</strong> {localError}</div>
          <button className="btn btn-sm" onClick={() => setLocalError(null)}>✕</button>
        </div>
      )}

      {csvReport && (
        <div className="banner banner-info">
          <div>{csvReport}</div>
          <button className="btn" onClick={() => setCsvReport(null)}>Dismiss</button>
        </div>
      )}

      {/* Match Queue & Transactional Allocation */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Incoming Payment Match & Allocation Queue</h2>
            <div className="muted">
              Matches strictly by explicit invoice reference or exact verified payer identifier HMAC. Never guesses by amount, date, or name.
            </div>
          </div>
          <span className="badge badge-info">{workspace.transactions.length} Transaction(s)</span>
        </div>

        {workspace.transactions.length === 0 ? (
          <p className="muted">No payment transactions imported yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Origin / Method</th>
                  <th>Date & Ref</th>
                  <th>Amount & Status</th>
                  <th>Match & Evidence</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspace.transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>
                      <OriginBadge origin={tx.sourceType} />
                      <div className="muted" style={{ marginTop: 4 }}>{tx.paymentMethod} • {tx.direction}</div>
                    </td>
                    <td>
                      <div className="num">{tx.valueDate}</div>
                      <div className="code-pill" style={{ marginTop: 2 }}>
                        {tx.externalTransactionReference ?? tx.id.slice(0, 8)}
                      </div>
                      {tx.payerIdentifierMasked && (
                        <div className="muted" style={{ marginTop: 2 }}>ID: {tx.payerIdentifierMasked}</div>
                      )}
                    </td>
                    <td>
                      <strong className="num">{formatINR(tx.amountPaise)}</strong>
                      <div style={{ marginTop: 3 }}>
                        <StatusPill status={tx.allocationStatus} />{' '}
                        <StatusPill status={tx.verificationStatus} />
                      </div>
                      <div className="muted num" style={{ marginTop: 2 }}>
                        Allocated: {formatINR(tx.allocatedAmountPaise)} • Unapplied Credit: {formatINR(tx.unappliedCreditPaise)}
                      </div>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <div style={{ marginBottom: 4 }}>
                        <MatchStatusBadge status={tx.matchStatus} />{' '}
                        {tx.matchedRetailerCode && (
                          <strong>{tx.matchedRetailerCode} ({tx.matchedRetailerName})</strong>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>
                        {tx.matchEvidence?.explanation ?? tx.narration}
                      </div>
                    </td>
                    <td>
                      {!tx.isReversed && tx.direction === 'INFLOW' && tx.matchStatus !== 'MATCHED' && (
                        <div className="controls-row">
                          <select
                            value={manualMatchSelection[tx.id] ?? ''}
                            onChange={(e) =>
                              setManualMatchSelection({ ...manualMatchSelection, [tx.id]: e.target.value })
                            }
                            style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid var(--border)' }}
                          >
                            <option value="">Select verified retailer...</option>
                            {workspace.retailers.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.retailerCode} — {r.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn btn-primary"
                            disabled={isBusy || !manualMatchSelection[tx.id]}
                            onClick={() =>
                              onManualMatch(
                                tx.id,
                                manualMatchSelection[tx.id],
                                'Distributor resolved unmatched/ambiguous queue item',
                              )
                            }
                          >
                            Confirm Match
                          </button>
                        </div>
                      )}

                      {!tx.isReversed &&
                        tx.matchStatus === 'MATCHED' &&
                        BigInt(tx.remainingToAllocatePaise) > 0n && (
                          <button
                            className="btn btn-emerald"
                            disabled={isBusy}
                            onClick={() => handleOpenPreview(tx)}
                          >
                            Preview Allocation
                          </button>
                        )}

                      {!tx.isReversed &&
                        (BigInt(tx.allocatedAmountPaise) > 0n || BigInt(tx.unappliedCreditPaise) > 0n) && (
                          confirmReverseId === tx.id ? (
                            <div className="controls-row" style={{ marginTop: 6 }}>
                              <button
                                className="btn btn-danger"
                                disabled={isBusy}
                                onClick={async () => {
                                  setConfirmReverseId(null);
                                  await onReversePayment(tx.id, 'Bank bounce / refund correction');
                                }}
                              >
                                Confirm Reversal
                              </button>
                              <button
                                className="btn"
                                disabled={isBusy}
                                onClick={() => setConfirmReverseId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-danger"
                              style={{ marginTop: 6 }}
                              disabled={isBusy}
                              onClick={() => setConfirmReverseId(tx.id)}
                            >
                              Reverse / Refund
                            </button>
                          )
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Allocation Preview & Explicit Confirmation Box */}
        {previewData && (
          <div
            style={{
              marginTop: 14,
              padding: 16,
              border: '2px solid var(--emerald)',
              borderRadius: 8,
              background: 'var(--emerald-soft)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>
                Confirm Allocation Preview — {previewData.retailerCode} ({previewData.retailerName})
              </h3>
              <span className="badge badge-info">Policy: {previewData.allocationPolicy}</span>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Payment remaining to apply: <strong className="num">{formatINR(previewData.remainingPaymentPaise)}</strong>.{' '}
              Applying updates invoices and allocations atomically inside a PostgreSQL transaction.
            </p>
            {previewData.lines.length === 0 ? (
              <p>No open invoices found; full amount becomes unapplied retailer credit.</p>
            ) : (
              <div
                className="table-wrap"
                style={{
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  marginBottom: 10,
                }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Due Date</th>
                      <th>Method</th>
                      <th>Before</th>
                      <th>Allocate</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.lines.map((line) => (
                      <tr key={line.invoiceId}>
                        <td><span className="code-pill">{line.invoiceNumber}</span></td>
                        <td className="num">{line.dueDate}</td>
                        <td><span className="badge badge-neutral">{line.allocationMethod}</span></td>
                        <td className="num">{formatINR(line.currentOutstandingPaise)}</td>
                        <td className="num" style={{ fontWeight: 700, color: 'var(--emerald)' }}>
                          {formatINR(line.proposedAllocatePaise)}
                        </td>
                        <td className="num">{formatINR(line.postAllocationOutstandingPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {BigInt(previewData.unappliedOverpaymentPaise) > 0n && (
              <div className="banner banner-info">
                <div>
                  Overpayment remainder of <strong className="num">{formatINR(previewData.unappliedOverpaymentPaise)}</strong> will be recorded as unapplied retailer credit in <span className="code-pill">retailer_credit_ledger</span>.
                </div>
              </div>
            )}
            <div className="controls-row">
              <button className="btn btn-emerald" disabled={isBusy} onClick={handleConfirmPreview}>
                Confirm & Apply in PostgreSQL Transaction
              </button>
              <button className="btn" disabled={isBusy} onClick={() => setPreviewData(null)}>Cancel Preview</button>
            </div>
          </div>
        )}
      </div>

      {/* Bank Import (CSV & Manual Demo) */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>CSV Bank Statement Import (Idempotent)</h3>
            <span className="badge badge-neutral">CSV_IMPORT</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Includes sample duplicate of <span className="code-pill">UTR-DEMO-FBR001-1000</span>, verified UPI match, unmatched NEFT, and conflicting AMBIGUOUS row.
          </p>
          <textarea
            rows={7}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.78rem', padding: 8, borderRadius: 7, border: '1px solid var(--border)' }}
          />
          <div className="controls-row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" disabled={busy} onClick={handleCsvImport}>
              Import CSV Batch
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Manual Demo Payment Entry</h3>
            <span className="badge badge-neutral">MANUAL_ENTRY</span>
          </div>
          <form onSubmit={handleManualPayment}>
            <div className="form-grid">
              <div className="field">
                <label>Amount (₹)</label>
                <input value={manualAmountInr} onChange={(e) => setManualAmountInr(e.target.value)} required />
              </div>
              <div className="field">
                <label>Method</label>
                <select value={manualMethod} onChange={(e) => setManualMethod(e.target.value as 'UPI' | 'BANK_TRANSFER')}>
                  <option value="UPI">UPI</option>
                  <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                </select>
              </div>
              <div className="field">
                <label>Value Date</label>
                <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} required />
              </div>
              <div className="field">
                <label>UTR / External Ref</label>
                <input value={manualRef} onChange={(e) => setManualRef(e.target.value)} placeholder="e.g. UTR-MANUAL-991" />
              </div>
              <div className="field">
                <label>Explicit Invoice Ref (optional)</label>
                <input value={manualInvRef} onChange={(e) => setManualInvRef(e.target.value)} placeholder="e.g. DEMO-R001-INV1" />
              </div>
              <div className="field">
                <label>Payer UPI / Bank Ref (hashed server-side)</label>
                <input value={manualPayerId} onChange={(e) => setManualPayerId(e.target.value)} placeholder="fb-r001.demo@okaxis" />
              </div>
              <div className="field">
                <label>Narration</label>
                <input value={manualNarration} onChange={(e) => setManualNarration(e.target.value)} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ marginTop: 12 }}>
              Record Demo Payment
            </button>
          </form>
        </div>
      </div>

      {/* Retailer Registry & Verified Payment Identifiers */}
      <div className="card">
        <div className="card-header">
          <h3>Retailer Registry & Verified Payment Identifiers (Masked + HMAC)</h3>
          <span className="badge badge-info">{workspace.retailers.length} Retailers</span>
        </div>
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Retailer ID</th>
                <th>Name</th>
                <th>Unapplied Credit</th>
                <th>Registered Verified Payment Identifiers (Masked)</th>
              </tr>
            </thead>
            <tbody>
              {workspace.retailers.map((r) => {
                const ids = workspace.identifiers.filter((i) => i.retailerId === r.id && i.isActive);
                return (
                  <tr key={r.id}>
                    <td><span className="code-pill">{r.retailerCode}</span></td>
                    <td>
                      <strong>{r.name}</strong>
                      <div className="muted">{r.notes}</div>
                    </td>
                    <td className="num">{formatINR(r.unappliedCreditPaise)}</td>
                    <td>
                      {ids.length === 0 ? (
                        <span className="muted">No verified identifiers registered</span>
                      ) : (
                        ids.map((i) => (
                          <div key={i.id} style={{ marginBottom: 3 }}>
                            <span className="badge badge-actual">{i.identifierType}</span>{' '}
                            <span className="code-pill">{i.maskedValue}</span>{' '}
                            <span className="muted">({i.displayLabel})</span>
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid-2">
          <form onSubmit={handleCreateRetailer} style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <h4 style={{ marginTop: 0 }}>Register New Retailer</h4>
            <div className="form-grid">
              <div className="field">
                <label>Retailer Code</label>
                <input value={retCode} onChange={(e) => setRetCode(e.target.value)} placeholder="FB-R002" required />
              </div>
              <div className="field">
                <label>Retailer Business Name</label>
                <input value={retName} onChange={(e) => setRetName(e.target.value)} placeholder="Shakti Traders" required />
              </div>
            </div>
            <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10 }}>
              Add Retailer
            </button>
          </form>

          <form onSubmit={handleRegisterId} style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <h4 style={{ marginTop: 0 }}>Register Verified UPI / Bank Identifier</h4>
            <div className="form-grid">
              <div className="field">
                <label>Retailer</label>
                <select value={idRetailerId} onChange={(e) => setIdRetailerId(e.target.value)}>
                  {workspace.retailers.map((r) => (
                    <option key={r.id} value={r.id}>{r.retailerCode} — {r.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Type</label>
                <select value={idType} onChange={(e) => setIdType(e.target.value as 'UPI_ID' | 'BANK_ACCOUNT')}>
                  <option value="UPI_ID">UPI_ID</option>
                  <option value="BANK_ACCOUNT">BANK_ACCOUNT</option>
                </select>
              </div>
              <div className="field">
                <label>Identifier Value (stored as HMAC + masked)</label>
                <input value={idRaw} onChange={(e) => setIdRaw(e.target.value)} placeholder="shop@okaxis or IFSC:ACCT" required />
              </div>
              <div className="field">
                <label>Display Label</label>
                <input value={idLabel} onChange={(e) => setIdLabel(e.target.value)} placeholder="Primary Shop UPI" required />
              </div>
            </div>
            <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10 }}>
              Verify & Register Identifier
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

