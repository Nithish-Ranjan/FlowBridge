import { useState } from 'react';
import {
  formatINR,
  paiseToDecimalInput,
  paiseToString,
  rupeesToPaise,
  type BusinessDTO,
} from '@flowbridge/shared';
import type { WorkspacePayload } from '../api/client';
import { OriginBadge, StatusPill } from './Badge';

interface LedgersViewProps {
  workspace: WorkspacePayload;
  onUpdateBusinessSettings: (patch: {
    openingCashPaise?: string;
    minimumCashPaise?: string;
    allocationPolicy?: BusinessDTO['allocationPolicy'];
  }) => Promise<void>;
  onCreateInvoice: (body: {
    retailerId: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    totalAmountPaise: string;
    evidenceStatus: 'UNCONFIRMED' | 'CONFIRMED_PROMISE' | 'DISPUTED';
  }) => Promise<void>;
  onToggleInvoiceEvidence: (
    invoiceId: string,
    evidenceStatus: 'UNCONFIRMED' | 'CONFIRMED_PROMISE' | 'DISPUTED',
  ) => Promise<void>;
  onCreateBill: (body: {
    supplierId: string;
    billNumber: string;
    issueDate: string;
    dueDate: string;
    totalAmountPaise: string;
    priorityTier: 'ESSENTIAL' | 'NORMAL' | 'FLEXIBLE';
  }) => Promise<void>;
  onCreateExpense: (body: {
    expenseCode: string;
    category: string;
    description: string;
    dueDate: string;
    amountPaise: string;
    priorityTier: 'ESSENTIAL' | 'NORMAL' | 'DEFERRABLE';
    isProtected: boolean;
  }) => Promise<void>;
  busy: boolean;
}

export function LedgersView({
  workspace,
  onUpdateBusinessSettings,
  onCreateInvoice,
  onToggleInvoiceEvidence,
  onCreateBill,
  onCreateExpense,
  busy,
}: LedgersViewProps) {
  const [openingCashInr, setOpeningCashInr] = useState(
    paiseToDecimalInput(workspace.business.openingCashPaise),
  );
  const [minCashInr, setMinCashInr] = useState(
    paiseToDecimalInput(workspace.business.minimumCashPaise),
  );
  const [allocPolicy, setAllocPolicy] = useState(workspace.business.allocationPolicy);

  // Quick add invoice state
  const [invRetailerId, setInvRetailerId] = useState(workspace.retailers[0]?.id ?? '');
  const [invNum, setInvNum] = useState('');
  const [invDue, setInvDue] = useState(workspace.business.openingCashDate);
  const [invAmtInr, setInvAmtInr] = useState('');

  // Quick add bill state
  const [billSupplierId, setBillSupplierId] = useState(workspace.suppliers[0]?.id ?? '');
  const [billNum, setBillNum] = useState('');
  const [billDue, setBillDue] = useState(workspace.business.openingCashDate);
  const [billAmtInr, setBillAmtInr] = useState('');

  // Quick add expense state
  const [expCode, setExpCode] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [expDue, setExpDue] = useState(workspace.business.openingCashDate);
  const [expAmtInr, setExpAmtInr] = useState('');

  return (
    <div>
      {/* Business Cash Setup */}
      <div className="card">
        <div className="card-header">
          <h3>Business Cash Configuration ({workspace.business.code})</h3>
          <span className="badge badge-info">Day 0: {workspace.business.openingCashDate}</span>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Opening Cash (₹)</label>
            <input value={openingCashInr} onChange={(e) => setOpeningCashInr(e.target.value)} />
          </div>
          <div className="field">
            <label>Minimum Cash Threshold (₹)</label>
            <input value={minCashInr} onChange={(e) => setMinCashInr(e.target.value)} />
          </div>
          <div className="field">
            <label>Payment Allocation Policy</label>
            <select
              value={allocPolicy}
              onChange={(e) => setAllocPolicy(e.target.value as BusinessDTO['allocationPolicy'])}
            >
              <option value="OLDEST_DUE_FIRST">OLDEST_DUE_FIRST</option>
              <option value="EXPLICIT_THEN_OLDEST_DUE_FIRST">EXPLICIT_THEN_OLDEST_DUE_FIRST</option>
            </select>
          </div>
        </div>
        <button
          className="btn btn-primary"
          disabled={busy}
          style={{ marginTop: 12 }}
          onClick={() =>
            onUpdateBusinessSettings({
              openingCashPaise: paiseToString(rupeesToPaise(openingCashInr)),
              minimumCashPaise: paiseToString(rupeesToPaise(minCashInr)),
              allocationPolicy: allocPolicy,
            })
          }
        >
          Update Cash Setup & Recalculate Forecast
        </button>
      </div>

      {/* Customer Invoices Ledger */}
      <div className="card">
        <div className="card-header">
          <h3>Customer Invoices (Receivables)</h3>
          <span className="badge badge-info">{workspace.invoices.length} Invoices</span>
        </div>
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Retailer</th>
                <th>Due Date</th>
                <th>Total</th>
                <th>Paid</th>
                <th>Outstanding</th>
                <th>Status / Evidence</th>
                <th>Origin</th>
              </tr>
            </thead>
            <tbody>
              {workspace.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><span className="code-pill">{inv.invoiceNumber}</span></td>
                  <td>
                    <strong>{inv.retailerCode}</strong> {inv.retailerName}
                    {inv.notes && <div className="muted">{inv.notes}</div>}
                  </td>
                  <td className="num">{inv.dueDate}</td>
                  <td className="num">{formatINR(inv.totalAmountPaise)}</td>
                  <td className="num">{formatINR(inv.paidAmountPaise)}</td>
                  <td className="num" style={{ fontWeight: 700 }}>{formatINR(inv.outstandingPaise)}</td>
                  <td>
                    <StatusPill status={inv.status} />{' '}
                    {inv.status !== 'PAID' ? (
                      <select
                        value={inv.evidenceStatus}
                        disabled={busy}
                        onChange={(e) =>
                          onToggleInvoiceEvidence(
                            inv.id,
                            e.target.value as 'UNCONFIRMED' | 'CONFIRMED_PROMISE' | 'DISPUTED',
                          )
                        }
                        style={{ padding: '2px 6px', fontSize: '0.78rem', borderRadius: 5 }}
                      >
                        <option value="UNCONFIRMED">UNCONFIRMED</option>
                        <option value="CONFIRMED_PROMISE">CONFIRMED_PROMISE</option>
                        <option value="DISPUTED">DISPUTED</option>
                      </select>
                    ) : (
                      <StatusPill status={inv.evidenceStatus} />
                    )}
                  </td>
                  <td><OriginBadge origin={inv.recordOrigin} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!invRetailerId || !invNum.trim() || !invAmtInr.trim()) return;
            await onCreateInvoice({
              retailerId: invRetailerId,
              invoiceNumber: invNum.trim(),
              invoiceDate: workspace.business.openingCashDate,
              dueDate: invDue,
              totalAmountPaise: paiseToString(rupeesToPaise(invAmtInr)),
              evidenceStatus: 'UNCONFIRMED',
            });
            setInvNum('');
            setInvAmtInr('');
          }}
        >
          <div className="form-grid">
            <div className="field">
              <label>Retailer</label>
              <select value={invRetailerId} onChange={(e) => setInvRetailerId(e.target.value)}>
                {workspace.retailers.map((r) => (
                  <option key={r.id} value={r.id}>{r.retailerCode} — {r.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Invoice #</label>
              <input value={invNum} onChange={(e) => setInvNum(e.target.value)} placeholder="C-3399" required />
            </div>
            <div className="field">
              <label>Due Date</label>
              <input type="date" value={invDue} onChange={(e) => setInvDue(e.target.value)} required />
            </div>
            <div className="field">
              <label>Amount (₹)</label>
              <input value={invAmtInr} onChange={(e) => setInvAmtInr(e.target.value)} placeholder="25000" required />
            </div>
          </div>
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10 }}>
            + Add Customer Invoice
          </button>
        </form>
      </div>

      {/* Supplier Bills & Operating Expenses */}
      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Supplier Bills</h3>
            <span className="badge badge-info">{workspace.bills.length} Bills</span>
          </div>
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Bill #</th>
                  <th>Supplier</th>
                  <th>Due</th>
                  <th>Total</th>
                  <th>Tier</th>
                </tr>
              </thead>
              <tbody>
                {workspace.bills.map((b) => (
                  <tr key={b.id}>
                    <td><span className="code-pill">{b.billNumber}</span></td>
                    <td>{b.supplierName}</td>
                    <td className="num">{b.dueDate}</td>
                    <td className="num">{formatINR(b.outstandingPaise)}</td>
                    <td><StatusPill status={b.priorityTier} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!billSupplierId || !billNum.trim() || !billAmtInr.trim()) return;
              await onCreateBill({
                supplierId: billSupplierId,
                billNumber: billNum.trim(),
                issueDate: workspace.business.openingCashDate,
                dueDate: billDue,
                totalAmountPaise: paiseToString(rupeesToPaise(billAmtInr)),
                priorityTier: 'FLEXIBLE',
              });
              setBillNum('');
              setBillAmtInr('');
            }}
          >
            <div className="form-grid">
              <div className="field">
                <label>Supplier</label>
                <select value={billSupplierId} onChange={(e) => setBillSupplierId(e.target.value)}>
                  {workspace.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.supplierCode} — {s.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Bill #</label>
                <input value={billNum} onChange={(e) => setBillNum(e.target.value)} placeholder="S-2099" required />
              </div>
              <div className="field">
                <label>Due Date</label>
                <input type="date" value={billDue} onChange={(e) => setBillDue(e.target.value)} required />
              </div>
              <div className="field">
                <label>Amount (₹)</label>
                <input value={billAmtInr} onChange={(e) => setBillAmtInr(e.target.value)} placeholder="15000" required />
              </div>
            </div>
            <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10 }}>
              + Add Supplier Bill
            </button>
          </form>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Operating Expenses (Liquidity Firewall)</h3>
            <span className="badge badge-info">{workspace.expenses.length} Expenses</span>
          </div>
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Due</th>
                  <th>Amount</th>
                  <th>Firewall</th>
                </tr>
              </thead>
              <tbody>
                {workspace.expenses.map((e) => (
                  <tr key={e.id}>
                    <td><span className="code-pill">{e.expenseCode}</span></td>
                    <td>{e.description}</td>
                    <td className="num">{e.dueDate}</td>
                    <td className="num">{formatINR(e.outstandingPaise)}</td>
                    <td>
                      <span className={`badge ${e.isProtected ? 'badge-actual' : 'badge-expected'}`}>
                        {e.isProtected ? 'PROTECTED' : 'DEFERRABLE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!expCode.trim() || !expDesc.trim() || !expAmtInr.trim()) return;
              await onCreateExpense({
                expenseCode: expCode.trim(),
                category: 'OPERATIONS',
                description: expDesc.trim(),
                dueDate: expDue,
                amountPaise: paiseToString(rupeesToPaise(expAmtInr)),
                priorityTier: 'ESSENTIAL',
                isProtected: true,
              });
              setExpCode('');
              setExpDesc('');
              setExpAmtInr('');
            }}
          >
            <div className="form-grid">
              <div className="field">
                <label>Expense Code</label>
                <input value={expCode} onChange={(e) => setExpCode(e.target.value)} placeholder="B-0008" required />
              </div>
              <div className="field">
                <label>Description</label>
                <input value={expDesc} onChange={(e) => setExpDesc(e.target.value)} placeholder="Rent / Payroll" required />
              </div>
              <div className="field">
                <label>Due Date</label>
                <input type="date" value={expDue} onChange={(e) => setExpDue(e.target.value)} required />
              </div>
              <div className="field">
                <label>Amount (₹)</label>
                <input value={expAmtInr} onChange={(e) => setExpAmtInr(e.target.value)} placeholder="10000" required />
              </div>
            </div>
            <button className="btn" type="submit" disabled={busy} style={{ marginTop: 10 }}>
              + Add Operating Expense
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

