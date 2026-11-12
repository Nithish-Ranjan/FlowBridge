import { formatINR } from '@flowbridge/shared';
import type { WorkspacePayload } from '../api/client';

interface SmartExitModalProps {
  workspace: WorkspacePayload;
  onStay: () => void;
  onConfirmExit: () => void;
}

export function SmartExitModal({ workspace, onStay, onConfirmExit }: SmartExitModalProps) {
  const proposedCommitments = workspace.commitments.filter((c) => c.status === 'PROPOSED');
  const openInvoicesCount = workspace.invoices.filter((i) => i.status === 'OPEN').length;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 580,
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
        }}
      >
        <div className="card-header">
          <div>
            <h2>Smart Exit & Session Summary</h2>
            <div className="muted">Review financial actions and outstanding items before signing off.</div>
          </div>
        </div>

        <div className="kpi-grid" style={{ margin: '14px 0' }}>
          <div className="kpi-card">
            <div className="kpi-label">Opening Cash</div>
            <div className="kpi-value num">{formatINR(workspace.business.openingCashPaise)}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Open Invoices</div>
            <div className="kpi-value num">{openInvoicesCount}</div>
          </div>
        </div>

        {proposedCommitments.length > 0 && (
          <div className="banner banner-warn" style={{ marginBottom: 14 }}>
            <div>
              <strong>Uncommitted Proposals:</strong> You have {proposedCommitments.length} commitment proposal(s)
              in <span className="code-pill">PROPOSED</span> state awaiting counterparty confirmation. They remain excluded
              from the live cash forecast until confirmed.
            </div>
          </div>
        )}

        <div style={{ background: 'var(--surface-alt)', padding: 12, borderRadius: 8, fontSize: '0.85rem' }}>
          <strong>Session Audit Confirmation:</strong>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
            All verified payments, approved credit agreements, and completed allocations have been permanently logged into PostgreSQL immutable audit tables.
          </p>
        </div>

        <div className="controls-row" style={{ marginTop: 20, justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn" onClick={onStay}>
            Stay in FlowBridge
          </button>
          <button className="btn btn-danger" onClick={onConfirmExit}>
            Save Summary & Exit
          </button>
        </div>
      </div>
    </div>
  );
}

