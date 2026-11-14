import { parsePaise } from './money.js';
import type { ForecastDayEntry } from './types.js';

export interface AlignedForecastSeries {
  allDates: string[];
  baseMap: Map<string, ForecastDayEntry>;
  compMap: Map<string, ForecastDayEntry>;
  baseVals: number[];
  compVals: number[];
}

export interface ChartDomainMetrics {
  rawMin: number;
  rawMax: number;
  domainMin: number;
  domainMax: number;
  span: number;
  yPad: number;
}

export function toRupeesNumber(paiseStr?: string | null): number {
  if (!paiseStr) return 0;
  try {
    const p = parsePaise(paiseStr);
    return Number(p) / 100;
  } catch {
    return 0;
  }
}

export function formatAxisINR(rupees: number): string {
  const isNeg = rupees < 0;
  const abs = Math.abs(Math.round(rupees));
  const inrStr = abs.toLocaleString('en-IN');
  return isNeg ? `-₹${inrStr}` : `₹${inrStr}`;
}

export function formatShortDate(isoDate: string): string {
  if (!isoDate || typeof isoDate !== 'string') return '';
  const parts = isoDate.split('-');
  if (parts.length < 3) return isoDate;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const mName = monthNames[monthIdx] ?? parts[1];
  return `${day} ${mName}`;
}

export function alignForecastSeriesByDate(
  days: ForecastDayEntry[] = [],
  comparisonDays?: ForecastDayEntry[] | null,
): AlignedForecastSeries {
  const dateSet = new Set<string>();
  for (const d of days) {
    if (d?.date) dateSet.add(d.date);
  }
  for (const d of comparisonDays ?? []) {
    if (d?.date) dateSet.add(d.date);
  }

  const allDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));

  const baseMap = new Map<string, ForecastDayEntry>();
  for (const d of days) {
    if (d?.date) baseMap.set(d.date, d);
  }

  const compMap = new Map<string, ForecastDayEntry>();
  for (const d of comparisonDays ?? []) {
    if (d?.date) compMap.set(d.date, d);
  }

  const baseVals = allDates
    .filter((dt) => baseMap.has(dt))
    .map((dt) => toRupeesNumber(baseMap.get(dt)!.closingBalancePaise));

  const compVals = allDates
    .filter((dt) => compMap.has(dt))
    .map((dt) => toRupeesNumber(compMap.get(dt)!.closingBalancePaise));

  return {
    allDates,
    baseMap,
    compMap,
    baseVals,
    compVals,
  };
}

export function computeChartDomain(allVals: number[]): ChartDomainMetrics {
  const safeVals = allVals.length > 0 ? allVals : [0];
  const rawMin = Math.min(...safeVals);
  const rawMax = Math.max(...safeVals);

  const yPad = Math.max((rawMax - rawMin) * 0.12, 2500);
  const domainMin = rawMin - yPad;
  const domainMax = rawMax + yPad;
  const span = Math.max(domainMax - domainMin, 1);

  return {
    rawMin,
    rawMax,
    domainMin,
    domainMax,
    span,
    yPad,
  };
}

export function computeBreachBounding(
  thresholdY: number,
  padT: number,
  plotH: number,
): { breachTop: number; breachHeight: number } {
  const breachTop = Math.max(padT, Math.min(padT + plotH, thresholdY));
  const breachHeight = Math.max(0, padT + plotH - breachTop);
  return { breachTop, breachHeight };
}

