import { useEffect, useState } from 'react';
import { formatINR } from '@flowbridge/shared';
import { api } from '../api/client';
import { type LanguageCode } from '../i18n/translations';

interface DailyPlanViewProps {
  businessId: string;
  language: LanguageCode;
}

export function DailyPlanView({ businessId, language }: DailyPlanViewProps) {
  const [plan, setPlan] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      const p = await api.getDailyPlanReport(businessId);
      setPlan(p);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlan();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setSpeechSupported(true);
    }
  }, [businessId]);

  function getBriefingScript(): string {
    if (!plan) return '';
    const breachText = plan.firstBreachDate
      ? `Attention: A projected cash shortage of ${formatINR(plan.shortfallPaise)} is expected on ${plan.firstBreachDate}. Feasible emergency reserve coverage is available.`
      : 'All projected balances remain healthy and above minimum thresholds.';

    return `Good morning! Here is your FlowBridge daily financial briefing. Your opening operating cash is ${formatINR(
      plan.openingCashPaise,
    )}. Emergency reserve is currently at ${formatINR(
      plan.currentReservePaise,
    )} against a target of ${formatINR(plan.targetReservePaise)}. ${breachText} Your daily financial plan is ready. Review your top priority actions on the dashboard.`;
  }

  function handlePlayVoice() {
    if (!speechSupported || !window.speechSynthesis) return;

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setIsPlaying(true);
      return;
    }

    window.speechSynthesis.cancel();
    const text = getBriefingScript();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;

    // Language locale mapping
    utterance.lang = language === 'kn' ? 'kn-IN' : language === 'hi' ? 'hi-IN' : 'en-IN';

    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
  }

  function handleStopVoice() {
    if (speechSupported && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
    }
  }

  function handlePrintOrDownload() {
    if (!plan?.htmlReport) return;
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(plan.htmlReport);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  }

  if (loading && !plan) {
    return <div className="card"><p className="muted">Generating Daily Financial Plan...</p></div>;
  }

  return (
    <div>
      {error && (
        <div className="banner banner-error">
          <div><strong>Plan Report Error:</strong> {error}</div>
          <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Voice Briefing & Assistant Control */}
      <div className="card" style={{ background: 'var(--surface)', border: '1px solid var(--primary)' }}>
        <div className="card-header">
          <div>
            <h2>Daily Voice Briefing & Audio Assistant</h2>
            <div className="muted">
              Morning spoken intelligence synthesized directly from verified ledger records.
            </div>
          </div>
          <div className="controls-row">
            {speechSupported && (
              <>
                {!isPlaying ? (
                  <button className="btn btn-primary" onClick={handlePlayVoice}>
                    ▶ Play Spoken Briefing
                  </button>
                ) : (
                  <button className="btn btn-danger" onClick={handleStopVoice}>
                    ■ Stop Audio
                  </button>
                )}
              </>
            )}
            <button className="btn btn-emerald" onClick={handlePrintOrDownload}>
              📄 Download / Print PDF Plan
            </button>
          </div>
        </div>

        <div style={{ padding: 14, background: 'var(--surface-alt)', borderRadius: 8, marginTop: 10 }}>
          <p style={{ margin: 0, fontStyle: 'italic', fontSize: '0.95rem', lineHeight: 1.6 }}>
            &ldquo;{getBriefingScript()}&rdquo;
          </p>
        </div>
      </div>

      {/* Top 3 Priority Recommendations */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3>Top 3 Priority Recommended Actions for Today</h3>
            <div className="muted">Deterministic optimization ranked by immediate cash gap impact.</div>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Priority</th>
                <th>Recommended Action</th>
                <th>Counterparty</th>
                <th>Strategic Rationale</th>
                <th>Financial Impact</th>
              </tr>
            </thead>
            <tbody>
              {plan?.topActions.map((act: any) => (
                <tr key={act.priority}>
                  <td>
                    <strong>P{act.priority}</strong>
                  </td>
                  <td>
                    <strong>{act.title}</strong>
                  </td>
                  <td>{act.counterparty}</td>
                  <td className="muted">{act.description}</td>
                  <td className="num">
                    <strong style={{ color: 'var(--primary)' }}>{act.financialImpact}</strong>
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

