import { describe, expect, it } from 'vitest';
import { closePool, getPool } from '../db/pool.js';
import { DEMO_BUSINESS_CODE, seedDemoData } from '../db/seed.js';
import { loginUser, registerUser } from '../services/authService.js';
import {
  depositToReserve,
  getReserveStatus,
  withdrawFromReserve,
} from '../services/reserveService.js';
import {
  checkCreditSaleProtection,
  createCreditAgreement,
  listCreditAgreements,
} from '../services/creditAgreementService.js';
import {
  acceptNegotiation,
  createNegotiationProposal,
  listNegotiations,
  submitCounterOffer,
} from '../services/negotiationService.js';
import { evaluateRetailerRiskProfiles } from '../services/retailerRiskService.js';
import {
  approveQueueItem,
  listAutomationQueue,
  listAutomationRules,
  queueAutomationAction,
} from '../services/automationService.js';
import { dispatchMessage } from '../services/communicationService.js';
import { generateDailyFinancialPlan } from '../services/reportService.js';

describe('FlowBridge PRD Upgraded Modules Integration Test', () => {
  it('exercises full lifecycle of newly implemented PRD modules against PostgreSQL', async () => {
    const { businessId } = await seedDemoData();
    expect(businessId).toBeDefined();

    // 1. Auth Module: login seeded demo user
    const loginRes = await loginUser({ email: 'owner@flowbridge.local', password: 'FlowBridge123!' });
    expect(loginRes.token).toBeDefined();
    expect(loginRes.user.email).toBe('owner@flowbridge.local');
    expect(loginRes.user.businessId).toBe(businessId);

    // 2. Emergency Reserve Module
    const initialReserve = await getReserveStatus(businessId);
    expect(initialReserve.reserve.status).toBe('ACTIVE');

    // Deposit ₹10,000 (1,000,000 paise)
    const afterDeposit = await depositToReserve({
      businessId,
      amountPaise: '1000000',
      authorizedBy: 'Owner Integration Test',
      reason: 'Surplus Cash Sweep',
    });
    expect(BigInt(afterDeposit.currentReservePaise)).toBeGreaterThan(0n);

    // Withdraw ₹5,000 (500,000 paise)
    const afterWithdraw = await withdrawFromReserve({
      businessId,
      amountPaise: '500000',
      authorizedBy: 'Owner Integration Test',
      reason: 'Emergency Timing Gap Relief',
    });
    expect(afterWithdraw.status).toBe('ACTIVE');

    // 3. Retailers & Credit Agreements Module
    const pool = getPool();
    const retRes = await pool.query<{ id: string }>(
      `SELECT id FROM retailers
       WHERE business_id = $1
         AND id NOT IN (SELECT DISTINCT retailer_id FROM customer_invoices WHERE business_id = $1 AND status IN ('OPEN', 'OVERDUE'))
       LIMIT 1`,
      [businessId],
    );
    const testRetailerId = retRes.rows[0]?.id ?? (await pool.query<{ id: string }>('SELECT id FROM retailers WHERE business_id = $1 LIMIT 1', [businessId])).rows[0].id;

    const agreement = await createCreditAgreement({
      businessId,
      retailerId: testRetailerId,
      creditLimitPaise: '25000000', // ₹2,50,000
      standardTermDays: 30,
      gracePeriodDays: 7,
      lateFeePct: 1.5,
      notes: 'Integration Test Contract',
    });
    expect(agreement.agreementNumber).toContain('AGR-');

    const agreementsList = await listCreditAgreements(businessId);
    expect(agreementsList.length).toBeGreaterThan(0);

    // Verify Credit-Sale Protection
    const saleCheckAllowed = await checkCreditSaleProtection(businessId, testRetailerId, '2000000'); // ₹20k within limit
    expect(saleCheckAllowed.allowed).toBe(true);

    const saleCheckBlocked = await checkCreditSaleProtection(businessId, testRetailerId, '30000000'); // ₹3,00,000 exceeds limit
    expect(saleCheckBlocked.allowed).toBe(false);
    expect(saleCheckBlocked.reason).toContain('exceeds approved credit limit');

    // 4. Payment Negotiation Module
    const neg = await createNegotiationProposal({
      businessId,
      counterpartyType: 'RETAILER',
      counterpartyId: testRetailerId,
      counterpartyName: 'Customer A',
      originalAmountPaise: '2000000',
      originalDueDate: '2026-11-15',
      proposedAmountPaise: '1000000',
      proposedDueDate: '2026-11-20',
      channel: 'WHATSAPP',
      initialMessage: 'Customer requested 50% split payment',
    });
    expect(neg.status).toBe('PROPOSED');

    // Distributor submits counteroffer
    await submitCounterOffer({
      negotiationId: neg.id,
      businessId,
      counterOfferAmountPaise: '1500000',
      counterOfferDueDate: '2026-11-18',
      messageText: 'Can accept ₹15,000 by 18 Nov',
      actor: 'Owner Test',
    });

    const negListAfterCounter = await listNegotiations(businessId);
    const updatedNeg = negListAfterCounter.find((n) => n.id === neg.id);
    expect(updatedNeg?.status).toBe('COUNTER_OFFERED');

    // Accept negotiation: synchronizes into live commitments table!
    await acceptNegotiation({
      negotiationId: neg.id,
      businessId,
      actor: 'Owner Test',
    });

    const commRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM commitments WHERE business_id = $1 AND status = 'AGREED'`,
      [businessId],
    );
    expect(Number(commRes.rows[0].count)).toBeGreaterThan(0);

    // 5. Dynamic Retailer Credit Risk Engine
    const riskProfiles = await evaluateRetailerRiskProfiles(businessId);
    expect(riskProfiles.length).toBeGreaterThan(0);
    expect(['LOW_RISK', 'MODERATE_RISK', 'AT_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA']).toContain(
      riskProfiles[0].riskCategory,
    );

    // 6. Automation Rules & Approval Queue
    const rules = await listAutomationRules(businessId);
    expect(rules.length).toBeGreaterThanOrEqual(3);

    const queuedItem = await queueAutomationAction({
      businessId,
      title: 'Automated Reminder Queue Test',
      description: 'Dispatch WhatsApp reminder for invoice',
      actionPayload: { invoiceId: 'test-inv' },
      requiresApproval: true,
    });
    expect(queuedItem.status).toBe('PENDING_APPROVAL');

    await approveQueueItem({
      queueId: queuedItem.id,
      businessId,
      approvedBy: 'Owner Test',
      notes: 'Approved during test',
    });

    const queueList = await listAutomationQueue(businessId);
    const approved = queueList.find((q) => q.id === queuedItem.id);
    expect(approved?.status).toBe('COMPLETED');

    // 7. Communications Service
    const commLog = await dispatchMessage({
      businessId,
      recipientType: 'RETAILER',
      recipientId: testRetailerId,
      recipientName: 'Customer A',
      recipientAddress: '+91-9800000001',
      channel: 'WHATSAPP',
      messageBody: 'Test delivery message',
      templateKey: 'TEST_DISPATCH',
    });
    expect(commLog.status).toBe('DELIVERED');
    expect(commLog.externalMessageId).toBeDefined();

    // 8. Daily Financial Plan Report
    const dailyPlan = await generateDailyFinancialPlan(businessId);
    expect(dailyPlan.businessName).toBeDefined();
    expect(dailyPlan.topActions.length).toBe(3);
    expect(dailyPlan.htmlReport).toContain('FlowBridge Daily Financial Plan');
  });
});

