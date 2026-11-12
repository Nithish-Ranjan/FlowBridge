import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusPill } from './Badge';

interface AutomationViewProps {
  businessId: string;
}

export function AutomationView({ businessId }: AutomationViewProps) {
  const [rules, setRules] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [rList, qList] = await Promise.all([
        api.getAutomationRules(businessId),
        api.getAutomationQueue(businessId),
      ]);
      setRules(rList);
      setQueue(qList);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [businessId]);

  async function handleApprove(queueId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.approveAutomationQueueItem(businessId, queueId, 'Approved by Business Owner via Automation Console');
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(queueId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.rejectAutomationQueueItem(businessId, queueId, 'Rejected by Business Owner');
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <div className="banner banner-error">
          <div><strong>Automation Error:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Human-in-the-Loop Approval Queue */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2>Human-in-the-Loop Approval Queue</h2>
            <div className="muted">
              Sensitive operations (reminders, deferral requests, reserve draws) require explicit distributor consent.
            </div>
          </div>
          <button className="btn" onClick={loadData}>↻ Refresh Queue</button>
        </div>

        {loading && queue.length === 0 ? (
          <p className="muted">Loading approval queue...</p>
        ) : queue.length === 0 ? (
          <div className="banner banner-success">
            <div>All clear! No pending automation operations awaiting review.</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title & Description</th>
                  <th>Scheduled For</th>
                  <th>Status</th>
                  <th>Approved By / Notes</th>
                  <th>Decision Actions</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      <div className="muted">{item.description}</div>
                    </td>
                    <td className="muted">{new Date(item.scheduledFor).toLocaleString()}</td>
                    <td>
                      <StatusPill status={item.status === 'COMPLETED' ? 'AGREED' : item.status} />
                    </td>
                    <td>
                      {item.approvedBy ? (
                        <div>
                          <strong>{item.approvedBy}</strong>
                          <div className="muted">{item.decisionNotes}</div>
                        </div>
                      ) : (
                        <span className="muted">Pending review</span>
                      )}
                    </td>
                    <td>
                      {item.status === 'PENDING_APPROVAL' ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-emerald btn-sm"
                            disabled={busy}
                            onClick={() => handleApprove(item.id)}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={busy}
                            onClick={() => handleReject(item.id)}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="muted">{item.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Automation Rules */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Configured Automation Rules</h3>
            <div className="muted">Autonomous background triggers evaluating live financial events.</div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rule Name</th>
                <th>Trigger Event</th>
                <th>Autonomous Action</th>
                <th>Requires Owner Approval</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td><strong>{rule.ruleName}</strong></td>
                  <td><span className="code-pill">{rule.eventTrigger}</span></td>
                  <td><span className="code-pill">{rule.actionType}</span></td>
                  <td>
                    {rule.requiresApproval ? (
                      <span className="badge badge-scenario">Yes (Approval Gate)</span>
                    ) : (
                      <span className="badge badge-actual">No (Auto-Execute)</span>
                    )}
                  </td>
                  <td>
                    <StatusPill status={rule.isActive ? 'ACTIVE' : 'HOLD'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

