import { formatINR, parsePaise, type ForecastDayEntry } from '@flowbridge/shared';

interface CashCurveChartProps {
  days: ForecastDayEntry[];
  minimumCashPaise: string;
  comparisonDays?: ForecastDayEntry[] | null;
  comparisonLabel?: string;
}

export function CashCurveChart({
  days,
  minimumCashPaise,
  comparisonDays,
  comparisonLabel,
}: CashCurveChartProps) {
  if (days.length === 0) {
    return <p className="muted">No forecast days available.</p>;
  }

  const width = 820;
  const height = 240;
  const padL = 78;
  const padR = 20;
  const padT = 18;
  const padB = 34;

  const minThreshold = Number(parsePaise(minimumCashPaise) / 100n);
  const baseVals = days.map((d) => Number(parsePaise(d.closingBalancePaise) / 100n));
  const compVals = comparisonDays
    ? comparisonDays.map((d) => Number(parsePaise(d.closingBalancePaise) / 100n))
    : [];

  const allVals = [...baseVals, ...compVals, minThreshold, 0];
  const minY = Math.min(...allVals);
  const maxY = Math.max(...allVals);
  const span = Math.max(maxY - minY, 1000);

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xFor = (idx: number) =>
    days.length <= 1 ? padL : padL + (idx / (days.length - 1)) * plotW;
  const yFor = (valRupees: number) =>
    padT + ((maxY - valRupees) / span) * plotH;

  const zeroY = yFor(minThreshold);
  const basePoints = baseVals.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
  const compPoints =
    compVals.length === days.length
      ? compVals.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ')
      : null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: '860px', height: 'auto' }}>
        {/* Breach zone below minimum threshold */}
        <rect
          x={padL}
          y={zeroY}
          width={plotW}
          height={Math.max(0, padT + plotH - zeroY)}
          fill="rgba(225,29,72,0.15)"
        />

        {/* Minimum cash threshold line */}
        <line
          x1={padL}
          x2={padL + plotW}
          y1={zeroY}
          y2={zeroY}
          stroke="#e11d48"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
        <text x={padL - 8} y={zeroY + 4} textAnchor="end" fontSize="11" fill="#e11d48" fontWeight="600">
          Min {formatINR(minimumCashPaise).replace('.00', '')}
        </text>

        {/* Top / bottom Y labels */}
        <text x={padL - 8} y={padT + 10} textAnchor="end" fontSize="11" fill="#94a3b8">
          ₹{Math.round(maxY).toLocaleString('en-IN')}
        </text>
        <text x={padL - 8} y={padT + plotH} textAnchor="end" fontSize="11" fill="#94a3b8">
          ₹{Math.round(minY).toLocaleString('en-IN')}
        </text>

        {/* Baseline polyline */}
        <polyline fill="none" stroke="#06b6d4" strokeWidth="2.5" points={basePoints} />

        {/* Optional scenario overlay polyline */}
        {compPoints && (
          <polyline fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeDasharray="6 3" points={compPoints} />
        )}

        {/* Day markers & X labels */}
        {days.map((d, i) => {
          const cx = xFor(i);
          const cy = yFor(baseVals[i]);
          const showLabel = i === 0 || i === days.length - 1 || i % Math.max(1, Math.floor(days.length / 6)) === 0 || d.belowMinimum;
          return (
            <g key={d.date}>
              <circle
                cx={cx}
                cy={cy}
                r={d.belowMinimum ? 5 : 3.2}
                fill={d.belowMinimum ? '#e11d48' : '#06b6d4'}
                stroke="#1e293b"
                strokeWidth="1.2"
              />
              {showLabel && (
                <text x={cx} y={height - 10} textAnchor="middle" fontSize="10" fill={d.belowMinimum ? '#e11d48' : '#94a3b8'}>
                  D{d.dayIndex}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
        <span style={{ color: '#06b6d4' }}>● Solid Cyan: Baseline Forecast (Actual + Expected)</span>
        {comparisonPointsLabel(compPoints, comparisonLabel)}
        <span style={{ color: '#e11d48' }}>● Red Dot / Shaded Zone: Below Minimum Cash Threshold</span>
      </div>
    </div>
  );
}

function comparisonPointsLabel(compPoints: string | null, label?: string) {
  if (!compPoints) return null;
  return <span style={{ color: '#7c3aed' }}>┈ Dashed Violet: {label ?? 'Scenario Comparison'}</span>;
}

