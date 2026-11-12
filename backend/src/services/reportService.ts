import { formatINR, type CustomerInvoiceDTO, type SupplierBillDTO } from '@flowbridge/shared';
import { getPool } from '../db/pool.js';
import { loadBusinessWorkspace, runForecast } from './engineService.js';
import { getReserveStatus } from './reserveService.js';

export interface DailyPlanDTO {
  businessName: string;
  reportDate: string;
  openingCashPaise: string;
  verifiedInflowsPaise: string;
  expectedInflowsPaise: string;
  verifiedOutflowsPaise: string;
  scheduledBillsPaise: string;
  operatingExpensesPaise: string;
  currentReservePaise: string;
  targetReservePaise: string;
  firstBreachDate: string | null;
  shortfallPaise: string;
  topActions: Array<{
    priority: number;
    title: string;
    description: string;
    counterparty: string;
    financialImpact: string;
  }>;
  htmlReport: string;
}

export async function generateDailyFinancialPlan(businessId: string): Promise<DailyPlanDTO> {
  const pool = getPool();
  const bizRes = await pool.query<{ name: string; opening_cash_date: string }>(
    'SELECT name, opening_cash_date FROM businesses WHERE id = $1',
    [businessId],
  );
  const businessName = bizRes.rows[0]?.name ?? 'Distributor Workspace';
  const today = new Date().toISOString().slice(0, 10);

  const ws = await loadBusinessWorkspace(businessId);
  const forecast = await runForecast(businessId, { horizonDays: 15 });
  const { reserve } = await getReserveStatus(businessId);

  const breach = forecast.breach;
  const topActions: DailyPlanDTO['topActions'] = [];

  // 1. Chase priorities
  if (forecast.chasePriorities.length > 0) {
    const p1 = forecast.chasePriorities[0];
    topActions.push({
      priority: 1,
      title: `Prioritize early collection on ${p1.invoiceNumber}`,
      description: `${p1.retailerName}: Outstanding ${formatINR(p1.outstandingPaise)}. ${p1.rationale}`,
      counterparty: p1.retailerName,
      financialImpact: `+${formatINR(p1.outstandingPaise)}`,
    });
  }

  // 2. Upcoming bills
  const openBill = ws.bills.find((b: SupplierBillDTO) => b.status === 'OPEN');
  if (openBill) {
    topActions.push({
      priority: 2,
      title: `Negotiate flexible deferral or schedule ${openBill.billNumber}`,
      description: `${openBill.supplierName ?? 'Supplier'}: Outstanding ${formatINR(openBill.outstandingPaise)} due ${openBill.dueDate}`,
      counterparty: openBill.supplierName ?? 'Supplier',
      financialImpact: `-${formatINR(openBill.outstandingPaise)}`,
    });
  }

  // 3. Emergency reserve status
  if (breach.firstBreachDate !== null) {
    topActions.push({
      priority: 3,
      title: 'Review Resolution Autopilot & Emergency Reserve',
      description: `Shortage of ${formatINR(breach.shortfallPaise)} projected on ${breach.firstBreachDate}. Feasible buffer available in Emergency Reserve (${formatINR(reserve.currentReservePaise)}).`,
      counterparty: 'Internal Reserve',
      financialImpact: `Deficit: ${formatINR(breach.shortfallPaise)}`,
    });
  } else {
    topActions.push({
      priority: 3,
      title: 'Maintain healthy liquidity buffer',
      description: `Reserve is safe at ${formatINR(reserve.currentReservePaise)} (Target: ${formatINR(reserve.targetReservePaise)}). No breach detected.`,
      counterparty: 'Internal Treasury',
      financialImpact: 'Neutral',
    });
  }

  const htmlReport = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>FlowBridge Daily Financial Plan — ${today}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1e293b; margin: 40px; }
    h1 { color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
    .kpi-row { display: flex; gap: 20px; margin: 20px 0; }
    .kpi { flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; background: #f8fafc; }
    .kpi-title { font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600; }
    .kpi-value { font-size: 22px; font-weight: bold; margin-top: 6px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 14px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-warn { background: #fef3c7; color: #92400e; }
    .badge-good { background: #dcfce7; color: #166534; }
  </style>
</head>
<body>
  <h1>FlowBridge Daily Financial Plan</h1>
  <p><strong>Business:</strong> ${businessName} | <strong>Date:</strong> ${today}</p>
  
  <div class="kpi-row">
    <div class="kpi">
      <div class="kpi-title">Opening Operating Cash</div>
      <div class="kpi-value">${formatINR(forecast.openingCashPaise)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-title">Emergency Reserve</div>
      <div class="kpi-value">${formatINR(reserve.currentReservePaise)} / ${formatINR(reserve.targetReservePaise)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-title">Forecast Shortfall</div>
      <div class="kpi-value" style="color: ${breach.firstBreachDate ? '#dc2626' : '#16a34a'}">
        ${breach.firstBreachDate ? formatINR(breach.shortfallPaise) : '₹0 (Safe)'}
      </div>
    </div>
  </div>

  <h2>Top 3 Priority Recommended Actions</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Action</th>
        <th>Counterparty</th>
        <th>Rationale</th>
        <th>Impact</th>
      </tr>
    </thead>
    <tbody>
      ${topActions
        .map(
          (act) => `
        <tr>
          <td><strong>P${act.priority}</strong></td>
          <td><strong>${act.title}</strong></td>
          <td>${act.counterparty}</td>
          <td>${act.description}</td>
          <td><strong>${act.financialImpact}</strong></td>
        </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <p style="margin-top: 30px; font-size: 12px; color: #94a3b8;">
    Generated deterministically by FlowBridge Financial Automation Engine. Verified records source of truth: PostgreSQL.
  </p>
</body>
</html>
  `.trim();

  return {
    businessName,
    reportDate: today,
    openingCashPaise: forecast.openingCashPaise,
    verifiedInflowsPaise: '0',
    expectedInflowsPaise: forecast.days[0]?.totalInflowsPaise ?? '0',
    verifiedOutflowsPaise: '0',
    scheduledBillsPaise: forecast.days[0]?.totalOutflowsPaise ?? '0',
    operatingExpensesPaise: '0',
    currentReservePaise: reserve.currentReservePaise,
    targetReservePaise: reserve.targetReservePaise,
    firstBreachDate: breach.firstBreachDate,
    shortfallPaise: breach.shortfallPaise,
    topActions,
    htmlReport,
  };
}
