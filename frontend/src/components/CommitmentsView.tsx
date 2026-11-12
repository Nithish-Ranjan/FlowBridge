import { useState } from 'react';
import {
  formatINR,
  paiseToDecimalInput,
  paiseToString,
  rupeesToPaise,
  type CommitmentDTO,
} from '@flowbridge/shared';
import type { VerificationPayload, WorkspacePayload } from '../api/client';
import { StatusPill } from './Badge';

interface CommitmentsViewProps {
  workspace: WorkspacePayload;
  verification: VerificationPayload;
  onRecordReply: (
    commitmentId: string,
    payload: {
      decision: 'AGREED' | 'CANCELLED' | 'FAILED' | 'COMPLETED' | 'AT_RISK';
      humanReplyBy: string;
      humanReplyChannel: string;
      humanReplyNotes?: string;
      agreedAmountPaise?: string;
      agreedDate?: string;
    },
  ) => Promise<void>;
  onCreateBlueprintPlanAProposals: () => Promise<void>;
  busy: boolean;
}

export function CommitmentsView({
  workspace,
  verification,
  onRecordReply,
  onCreateBlueprintPlanAProposals,
  busy,
}: CommitmentsViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [decision, setDecision] = useState<'AGREED' | 'AT_RISK' | 'FAILED' | 'CANCELLED'>('AGREED');
  const [replyBy, setReplyBy] = useState('Distributor Desk / Counterparty');
  const [channel, setChannel] = useState('WHATSAPP');
  const [notes, setNotes] = useState('');
  const [agreedAmountInr, setAgreedAmountInr] = useState('');
  const [agreedDate, setAgreedDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const proposedCount = workspace.commitments.filter((c) => c.status === 'PROPOSED').length;
  const agreedOrActiveCount = workspace.commitments.filter((c) =>
    ['AGREED', 'COMPLETED', 'AT_RISK'].includes(c.status),
  ).length;
  const planReady =
    workspace.commitments.length > 0 && proposedCount === 0 && agreedOrActiveCount > 0;

  function startEdit(c: CommitmentDTO) {
    setFormError(null);
    setEditingId(c.id);
    setDecision('AGREED');
    setReplyBy('');
    setChannel('WHATSAPP');
    setNotes('');
    setAgreedAmountInr(paiseToDecimalInput(c.agreedAmountPaise ?? c.proposedAmountPaise));
    setAgreedDate(c.agreedDate ?? c.proposedDate);
  }

  async function submitReply(c: CommitmentDTO) {
    setFormError(null);
    if (!replyBy.trim()) {
      setFormError('Human counterparty / desk reply name is required before recording an agreement.');
      return;
    }
    let parsedAgreedPaise: string | undefined;
    if (agreedAmountInr.trim()) {
      try {
        parsedAgreedPaise = paiseToString(rupeesToPaise(agreedAmountInr));
      } catch (err) {
        setFormError((err as Error).message);
        return;
      }
    }
    await onRecordReply(c.id, {
      decision,
      humanReplyBy: replyBy.trim(),
      humanReplyChannel: channel,
      humanReplyNotes: notes.trim() || undefined,
      agreedAmountPaise: parsedAgreedPaise,
      agreedDate: agreedDate || undefined,
    });
    setEditingId(null);
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Stage 4 — TRACK: Commitment Lifecycle</h2>
            <div className="muted">
              A proposal is never an agreement until a human records the counterparty reply.
            </div>
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={onCreateBlueprintPlanAProposals}>
            + Create Blueprint Plan A Proposals (C-3301 & S-2041)
          </button>
        </div>

        {workspace.commitments.length > 0 && (
          <div className={`banner ${planReady ? 'banner-success' : 'banner-warn'}`}>
            <div>
              <strong>Human Agreement Gate:</strong>{' '}
              {planReady ? (
                <>
                  Plan Agreed — all {agreedOrActiveCount} commitment(s) have human-recorded replies
                  and are active in the forecast.
                </>
              ) : (
                <>
                  Not Yet Agreed — {agreedOrActiveCount} human-confirmed vs {proposedCount} still{' '}
                  <span className="code-pill">PROPOSED</span> (excluded from forecast until both
                  counterparty replies are recorded).
                </>
              )}
            </div>
            <StatusPill status={planReady ? 'AGREED' : 'PROPOSED'} />
          </div>
        )}

        {formError && (
          <div className="banner banner-error">
            <div>{formError}</div>
            <button className="btn btn-sm" onClick={() => setFormError(null)}>✕</button>
          </div>
        )}

        {workspace.commitments.length === 0 ? (
          <div className="banner banner-info">
            <div>
              No commitments tracked yet. Propose a plan from Stage 3 (Resolve) or click &ldquo;Create Blueprint Plan A Proposals&rdquo; above.
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Proposed</th>
                  <th>Agreed</th>
                  <th>Status</th>
                  <th>Human Reply Evidence</th>
                  <th>Controls</th>
                </tr>
              </thead>
              <tbody>
                {workspace.commitments.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.actionType}</strong>
                      <div className="muted">{c.counterpartyType}</div>
                    </td>
                    <td className="num">
                      {formatINR(c.proposedAmountPaise)}
                      <div className="muted">{c.proposedDate}</div>
                    </td>
                    <td className="num">
                      {c.agreedAmountPaise ? formatINR(c.agreedAmountPaise) : '—'}
                      <div className="muted">{c.agreedDate ?? 'Awaiting human reply'}</div>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td>
                      {c.humanReplyRecorded ? (
                        <div>
                          <strong>{c.humanReplyBy}</strong> ({c.humanReplyChannel})
                          <div className="muted">{c.humanReplyNotes ?? 'Confirmed'}</div>
                        </div>
                      ) : (
                        <span className="muted">Not recorded — excluded from forecast</span>
                      )}
                    </td>
                    <td>
                      <button className="btn" disabled={busy} onClick={() => startEdit(c)}>
                        Record Human Reply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editingId && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              border: '1px solid var(--primary)',
              borderRadius: 8,
              background: 'var(--primary-soft)',
            }}
          >
            <h4 style={{ marginTop: 0, marginBottom: 10 }}>Record Human Reply on Commitment</h4>
            <div className="form-grid">
              <div className="field">
                <label>Decision</label>
                <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                  <option value="AGREED">AGREED (Human Confirmed)</option>
                  <option value="AT_RISK">AT_RISK</option>
                  <option value="FAILED">FAILED (Promise Missed)</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
              <div className="field">
                <label>Replied By (Human Name)</label>
                <input
                  value={replyBy}
                  onChange={(e) => setReplyBy(e.target.value)}
                  placeholder="e.g. Ramesh (Customer A)"
                />
              </div>
              <div className="field">
                <label>Channel</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="PHONE">Phone Call</option>
                  <option value="EMAIL">Email</option>
                  <option value="IN_PERSON">In Person</option>
                </select>
              </div>
              <div className="field">
                <label>Agreed Amount (₹)</label>
                <input value={agreedAmountInr} onChange={(e) => setAgreedAmountInr(e.target.value)} />
              </div>
              <div className="field">
                <label>Agreed Date (YYYY-MM-DD)</label>
                <input type="date" value={agreedDate} onChange={(e) => setAgreedDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Reply Notes</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Evidence / summary" />
              </div>
            </div>
            <div className="controls-row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-emerald"
                disabled={busy || !replyBy.trim()}
                onClick={() => {
                  const found = workspace.commitments.find((x) => x.id === editingId);
                  if (found) submitReply(found);
                }}
              >
                Save Human Decision
              </button>
              <button className="btn" onClick={() => setEditingId(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scope B Lightweight View: Deterministic Negotiation Templates */}
      <div className="card">
        <div className="card-header">
          <h3>Negotiation Copilot Templates (Deterministic, Record-Backed)</h3>
          <span className="badge badge-neutral">No AI / Manual Outreach</span>
        </div>
        <div className="grid-2">
          {verification.negotiationTemplates.map((tpl, idx) => (
            <div
              key={`${tpl.targetCode}-${idx}`}
              style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>
                  <span className="code-pill">{tpl.targetCode}</span> {tpl.counterparty}
                </strong>
                <span className="badge badge-info">{tpl.channel}</span>
              </div>
              <p style={{ fontSize: '0.84rem', margin: '0 0 8px' }}>{tpl.templateText}</p>
              <button
                className="btn"
                onClick={() => {
                  navigator.clipboard?.writeText(tpl.templateText);
                  setCopiedIdx(idx);
                  setTimeout(() => setCopiedIdx(null), 1500);
                }}
              >
                {copiedIdx === idx ? 'Copied!' : 'Copy Message'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

