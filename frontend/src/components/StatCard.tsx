import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  badgeText?: string;
  badgeVariant?: 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate' | 'indigo';
  icon?: LucideIcon;
  variant?: 'default' | 'danger' | 'warning' | 'positive';
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  description,
  badgeText,
  badgeVariant = 'cyan',
  icon: Icon,
  variant = 'default',
  onClick,
}) => {
  const badgeStyles = {
    emerald: 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-700 border border-amber-500/30',
    rose: 'bg-rose-500/15 text-rose-600 border border-rose-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-700 border border-cyan-500/30',
    slate: 'bg-slate-500/15 text-slate-700 border border-slate-500/30',
    indigo: 'bg-indigo-500/15 text-indigo-600 border border-indigo-500/30',
  };

  const cardBorder =
    variant === 'danger'
      ? 'border-rose-400 bg-rose-50/40 shadow-sm'
      : variant === 'warning'
      ? 'border-amber-400 bg-amber-50/40 shadow-sm'
      : variant === 'positive'
      ? 'border-emerald-400 bg-emerald-50/40 shadow-sm'
      : 'border-slate-200 bg-white shadow-sm hover:border-slate-300';

  return (
    <div
      onClick={onClick}
      className={`card-stat rounded-xl p-4 border transition-all ${cardBorder} ${
        onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''
      }`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 125,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontSize: '0.74rem',
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          {title}
        </span>
        {Icon && (
          <div
            style={{
              padding: '6px',
              borderRadius: '8px',
              background: 'var(--surface-alt)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={16} />
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, marginBottom: 4 }}>
        <div
          style={{
            fontSize: '1.5rem',
            fontWeight: 800,
            fontFamily: 'monospace',
            letterSpacing: '-0.5px',
            color: variant === 'danger' ? '#DC2626' : 'var(--text)',
            lineHeight: 1.2,
          }}
        >
          {value}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 4 }}>
        {description && (
          <p
            style={{
              margin: 0,
              fontSize: '0.74rem',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: badgeText ? '60%' : '100%',
            }}
          >
            {description}
          </p>
        )}
        {badgeText && (
          <span
            className={`stat-badge ${badgeStyles[badgeVariant]}`}
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            {badgeText}
          </span>
        )}
      </div>
    </div>
  );
};

