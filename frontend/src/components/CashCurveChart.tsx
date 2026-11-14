import React from 'react';
import {
  formatINR,
  type ForecastDayEntry,
  toRupeesNumber,
  formatAxisINR,
  formatShortDate,
  alignForecastSeriesByDate,
  computeChartDomain,
  computeBreachBounding,
} from '@flowbridge/shared';

interface CashCurveChartProps {
  days: ForecastDayEntry[];
  minimumCashPaise: string;
  comparisonDays?: ForecastDayEntry[] | null;
  comparisonLabel?: string;
}

export function CashCurveChart({
  days = [],
  minimumCashPaise = '0',
  comparisonDays = null,
  comparisonLabel,
}: CashCurveChartProps) {
  // 1. Gather all unique calendar dates across baseline and comparison series
  const { allDates, baseMap, compMap, baseVals, compVals } = alignForecastSeriesByDate(
    days,
    comparisonDays,
  );

  if (allDates.length === 0) {
    return <p className="muted">No forecast days available.</p>;
  }

  const minThreshold = toRupeesNumber(minimumCashPaise);

  // 2. Compute domain with comfortable margin for negative or tightly clustered balances
  const allVals = [...baseVals, ...compVals, minThreshold, 0];
  const { domainMin, domainMax, span, yPad } = computeChartDomain(allVals);

  // 3. SVG Dimensions
  const width = 840;
  const height = 260;
  const padL = 92;
  const padR = 24;
  const padT = 24;
  const padB = 46;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const xForDate = (dateStr: string) => {
    const idx = allDates.indexOf(dateStr);
    if (allDates.length <= 1) return padL + plotW / 2;
    return padL + (idx / (allDates.length - 1)) * plotW;
  };

  const yFor = (valRupees: number) => {
    return padT + ((domainMax - valRupees) / span) * plotH;
  };

  const thresholdY = yFor(minThreshold);
  const zeroY = yFor(0);

  // Breach region bounded strictly inside plotting area
  const { breachTop, breachHeight } = computeBreachBounding(thresholdY, padT, plotH);

  // Polyline points matched by calendar date
  const basePoints = allDates
    .filter((dt) => baseMap.has(dt))
    .map((dt) => {
      const v = toRupeesNumber(baseMap.get(dt)!.closingBalancePaise);
      return `${xForDate(dt).toFixed(1)},${yFor(v).toFixed(1)}`;
    })
    .join(' ');

  const hasComp = compVals.length > 0;
  const compPoints = hasComp
    ? allDates
        .filter((dt) => compMap.has(dt))
        .map((dt) => {
          const v = toRupeesNumber(compMap.get(dt)!.closingBalancePaise);
          return `${xForDate(dt).toFixed(1)},${yFor(v).toFixed(1)}`;
        })
        .join(' ')
    : null;

  // Determine which X date labels to display (prevent crowded collision)
  const maxLabels = 7;
  const step = Math.max(1, Math.floor(allDates.length / maxLabels));

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', maxWidth: '860px', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Cash Curve Forecast Chart"
      >
        {/* Shaded breach zone below minimum threshold */}
        {breachHeight > 0 && (
          <rect
            x={padL}
            y={breachTop}
            width={plotW}
            height={breachHeight}
            fill="rgba(225,29,72,0.12)"
          />
        )}

        {/* Zero baseline reference when domain spans negative values */}
        {domainMin < 0 && domainMax > 0 && (
          <g>
            <line
              x1={padL}
              x2={padL + plotW}
              y1={zeroY}
              y2={zeroY}
              stroke="#cbd5e1"
              strokeDasharray="4 3"
              strokeWidth="1"
            />
            <text x={padL - 8} y={zeroY + 3} textAnchor="end" fontSize="10" fill="#64748b" fontWeight="500">
              ₹0
            </text>
          </g>
        )}

        {/* Minimum cash threshold reference line */}
        <line
          x1={padL}
          x2={padL + plotW}
          y1={thresholdY}
          y2={thresholdY}
          stroke="#e11d48"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
        <text
          x={padL - 8}
          y={thresholdY + 3}
          textAnchor="end"
          fontSize="10"
          fill="#e11d48"
          fontWeight="700"
        >
          Min {formatINR(minimumCashPaise).replace('.00', '')}
        </text>

        {/* Top & Bottom domain Y labels */}
        <text x={padL - 8} y={padT + 4} textAnchor="end" fontSize="10" fill="#64748b" fontWeight="600">
          {formatAxisINR(domainMax - yPad)}
        </text>
        <text x={padL - 8} y={padT + plotH} textAnchor="end" fontSize="10" fill="#64748b" fontWeight="600">
          {formatAxisINR(domainMin + yPad)}
        </text>

        {/* Baseline forecast curve */}
        {basePoints && (
          <polyline fill="none" stroke="#06b6d4" strokeWidth="2.5" points={basePoints} />
        )}

        {/* Scenario comparison forecast curve */}
        {compPoints && (
          <polyline
            fill="none"
            stroke="#7c3aed"
            strokeWidth="2.5"
            strokeDasharray="6 3"
            points={compPoints}
          />
        )}

        {/* Baseline day data points & X date labels */}
        {allDates.map((dateStr, idx) => {
          const cx = xForDate(dateStr);
          const baseEntry = baseMap.get(dateStr);
          const compEntry = compMap.get(dateStr);

          const isBreach = baseEntry?.belowMinimum || false;
          const showLabel =
            idx === 0 ||
            idx === allDates.length - 1 ||
            idx % step === 0 ||
            isBreach;

          return (
            <g key={dateStr}>
              {/* Baseline circle */}
              {baseEntry && (
                <circle
                  cx={cx}
                  cy={yFor(toRupeesNumber(baseEntry.closingBalancePaise))}
                  r={isBreach ? 4.5 : 3}
                  fill={isBreach ? '#e11d48' : '#06b6d4'}
                  stroke="#1e293b"
                  strokeWidth="1"
                >
                  <title>{`Baseline: ${dateStr}: ${formatINR(baseEntry.closingBalancePaise)}`}</title>
                </circle>
              )}

              {/* Scenario circle */}
              {compEntry && (
                <circle
                  cx={cx}
                  cy={yFor(toRupeesNumber(compEntry.closingBalancePaise))}
                  r={compEntry.belowMinimum ? 4.5 : 3}
                  fill={compEntry.belowMinimum ? '#e11d48' : '#7c3aed'}
                  stroke="#ffffff"
                  strokeWidth="1"
                >
                  <title>{`Scenario: ${dateStr}: ${formatINR(compEntry.closingBalancePaise)}`}</title>
                </circle>
              )}

              {/* Readable X-axis Date & Day Label */}
              {showLabel && (
                <g>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={padT + plotH}
                    y2={padT + plotH + 4}
                    stroke="#94a3b8"
                    strokeWidth="1"
                  />
                  <text
                    x={cx}
                    y={padT + plotH + 16}
                    textAnchor="middle"
                    fontSize="9.5"
                    fill={isBreach ? '#e11d48' : '#475569'}
                    fontWeight={isBreach ? '700' : '500'}
                  >
                    {formatShortDate(dateStr)}
                  </text>
                  <text
                    x={cx}
                    y={padT + plotH + 28}
                    textAnchor="middle"
                    fontSize="8.5"
                    fill="#94a3b8"
                  >
                    {baseEntry ? `D${baseEntry.dayIndex}` : `D${idx}`}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Clear Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '16px',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
          marginTop: '6px',
          paddingLeft: `${padL}px`,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#06b6d4' }}>
          <span style={{ width: 14, height: 3, background: '#06b6d4', display: 'inline-block' }} />
          <span>Solid Cyan: Baseline Forecast</span>
        </span>
        {compPoints && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#7c3aed' }}>
            <span
              style={{
                width: 14,
                height: 3,
                background: '#7c3aed',
                display: 'inline-block',
                borderTop: '2px dashed #7c3aed',
              }}
            />
            <span>Dashed Violet: {comparisonLabel ?? 'Scenario Comparison'}</span>
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#e11d48' }}>
          <span
            style={{
              width: 14,
              height: 0,
              borderTop: '2px dashed #e11d48',
              display: 'inline-block',
            }}
          />
          <span>Red Dashed: Minimum Cash Threshold ({formatINR(minimumCashPaise).replace('.00', '')})</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#e11d48' }}>
          <span style={{ width: 12, height: 10, background: 'rgba(225,29,72,0.18)', display: 'inline-block', border: '1px solid #fca5a5' }} />
          <span>Shaded Zone: Deficit Warning</span>
        </span>
      </div>
    </div>
  );
}
