import { paiseToString, parsePaise } from '@flowbridge/shared';
import { getPool, withTransaction } from '../db/pool.js';
import { recordAuditEvent } from '../db/repositories/paymentRepo.js';

export interface ReserveStatusDTO {
  id: string;
  businessId: string;
  targetReservePaise: string;
  currentReservePaise: string;
  minimumThresholdPaise: string;
  usedReservePaise: string;
  deficitPaise: string;
  status: 'ACTIVE' | 'LOCKED' | 'DEPLETED';
  updatedAt: string;
}

export interface ReserveMovementDTO {
  id: string;
  businessId: string;
  movementType: 'DEPOSIT' | 'WITHDRAWAL_EMERGENCY' | 'SWEEP_INTO_RESERVE';
  amountPaise: string;
  authorizedBy: string;
  reason: string;
  createdAt: string;
}

export async function getReserveStatus(businessId: string): Promise<{
  reserve: ReserveStatusDTO;
  recentMovements: ReserveMovementDTO[];
}> {
  const pool = getPool();

  let res = await pool.query<{
    id: string;
    business_id: string;
    target_reserve_paise: string;
    current_reserve_paise: string;
    minimum_threshold_paise: string;
    status: string;
    updated_at: string;
  }>(
    `SELECT id, business_id, target_reserve_paise, current_reserve_paise, minimum_threshold_paise, status, updated_at
     FROM reserve_allocations
     WHERE business_id = $1`,
    [businessId],
  );

  if (res.rows.length === 0) {
    // Auto-initialize default reserve
    await pool.query(
      `INSERT INTO reserve_allocations (
        business_id, target_reserve_paise, current_reserve_paise, minimum_threshold_paise, status
      ) VALUES ($1, 5000000, 5000000, 1500000, 'ACTIVE')
      ON CONFLICT (business_id) DO NOTHING`,
      [businessId],
    );
    res = await pool.query(
      `SELECT id, business_id, target_reserve_paise, current_reserve_paise, minimum_threshold_paise, status, updated_at
       FROM reserve_allocations
       WHERE business_id = $1`,
      [businessId],
    );
  }

  const row = res.rows[0];
  const target = parsePaise(row.target_reserve_paise);
  const current = parsePaise(row.current_reserve_paise);
  const used = target > current ? target - current : 0n;
  const deficit = target > current ? target - current : 0n;

  const reserve: ReserveStatusDTO = {
    id: row.id,
    businessId: row.business_id,
    targetReservePaise: paiseToString(target),
    currentReservePaise: paiseToString(current),
    minimumThresholdPaise: row.minimum_threshold_paise,
    usedReservePaise: paiseToString(used),
    deficitPaise: paiseToString(deficit),
    status: row.status as ReserveStatusDTO['status'],
    updatedAt: row.updated_at,
  };

  const movementsRes = await pool.query<{
    id: string;
    business_id: string;
    movement_type: string;
    amount_paise: string;
    authorized_by: string;
    reason: string;
    created_at: string;
  }>(
    `SELECT id, business_id, movement_type, amount_paise, authorized_by, reason, created_at
     FROM reserve_movements
     WHERE business_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [businessId],
  );

  const recentMovements: ReserveMovementDTO[] = movementsRes.rows.map((m) => ({
    id: m.id,
    businessId: m.business_id,
    movementType: m.movement_type as ReserveMovementDTO['movementType'],
    amountPaise: m.amount_paise,
    authorizedBy: m.authorized_by,
    reason: m.reason,
    createdAt: m.created_at,
  }));

  return { reserve, recentMovements };
}

export async function depositToReserve(input: {
  businessId: string;
  amountPaise: string;
  authorizedBy: string;
  reason: string;
}): Promise<ReserveStatusDTO> {
  const amt = parsePaise(input.amountPaise);
  if (amt <= 0n) throw new Error('Deposit amount must be positive');

  return withTransaction(async (client) => {
    const current = await client.query<{ id: string; target_reserve_paise: string; current_reserve_paise: string }>(
      'SELECT id, target_reserve_paise, current_reserve_paise FROM reserve_allocations WHERE business_id = $1 FOR UPDATE',
      [input.businessId],
    );

    if (current.rows.length === 0) {
      throw new Error('Reserve not initialized');
    }

    const curPaise = parsePaise(current.rows[0].current_reserve_paise);
    const newPaise = curPaise + amt;

    await client.query(
      `UPDATE reserve_allocations
       SET current_reserve_paise = $1, status = 'ACTIVE', updated_at = now()
       WHERE business_id = $2`,
      [newPaise.toString(), input.businessId],
    );

    await client.query(
      `INSERT INTO reserve_movements (business_id, movement_type, amount_paise, authorized_by, reason)
       VALUES ($1, 'DEPOSIT', $2, $3, $4)`,
      [input.businessId, amt.toString(), input.authorizedBy, input.reason],
    );

    await recordAuditEvent(
      {
        businessId: input.businessId,
        eventType: 'RESERVE_DEPOSITED',
        entityType: 'reserve_allocations',
        entityId: current.rows[0].id,
        actor: input.authorizedBy,
        payload: { amountPaise: amt.toString(), reason: input.reason },
      },
      client,
    );

    const targetPaise = parsePaise(current.rows[0].target_reserve_paise);
    const used = targetPaise > newPaise ? targetPaise - newPaise : 0n;

    return {
      id: current.rows[0].id,
      businessId: input.businessId,
      targetReservePaise: paiseToString(targetPaise),
      currentReservePaise: paiseToString(newPaise),
      minimumThresholdPaise: '0',
      usedReservePaise: paiseToString(used),
      deficitPaise: paiseToString(used),
      status: 'ACTIVE',
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function withdrawFromReserve(input: {
  businessId: string;
  amountPaise: string;
  authorizedBy: string;
  reason: string;
}): Promise<ReserveStatusDTO> {
  const amt = parsePaise(input.amountPaise);
  if (amt <= 0n) throw new Error('Withdrawal amount must be positive');

  return withTransaction(async (client) => {
    const current = await client.query<{
      id: string;
      target_reserve_paise: string;
      current_reserve_paise: string;
      minimum_threshold_paise: string;
    }>(
      'SELECT id, target_reserve_paise, current_reserve_paise, minimum_threshold_paise FROM reserve_allocations WHERE business_id = $1 FOR UPDATE',
      [input.businessId],
    );

    if (current.rows.length === 0) {
      throw new Error('Reserve not initialized');
    }

    const curPaise = parsePaise(current.rows[0].current_reserve_paise);
    if (curPaise < amt) {
      throw new Error(`Insufficient reserve. Available: ₹${paiseToString(curPaise)}, requested: ₹${paiseToString(amt)}`);
    }

    const newPaise = curPaise - amt;
    const minThreshold = parsePaise(current.rows[0].minimum_threshold_paise);
    const status = newPaise === 0n ? 'DEPLETED' : newPaise < minThreshold ? 'LOCKED' : 'ACTIVE';

    await client.query(
      `UPDATE reserve_allocations
       SET current_reserve_paise = $1, status = $2, updated_at = now()
       WHERE business_id = $3`,
      [newPaise.toString(), status, input.businessId],
    );

    await client.query(
      `INSERT INTO reserve_movements (business_id, movement_type, amount_paise, authorized_by, reason)
       VALUES ($1, 'WITHDRAWAL_EMERGENCY', $2, $3, $4)`,
      [input.businessId, amt.toString(), input.authorizedBy, input.reason],
    );

    await recordAuditEvent(
      {
        businessId: input.businessId,
        eventType: 'RESERVE_EMERGENCY_WITHDRAWAL',
        entityType: 'reserve_allocations',
        entityId: current.rows[0].id,
        actor: input.authorizedBy,
        payload: { amountPaise: amt.toString(), reason: input.reason },
      },
      client,
    );

    const targetPaise = parsePaise(current.rows[0].target_reserve_paise);
    const used = targetPaise > newPaise ? targetPaise - newPaise : 0n;

    return {
      id: current.rows[0].id,
      businessId: input.businessId,
      targetReservePaise: paiseToString(targetPaise),
      currentReservePaise: paiseToString(newPaise),
      minimumThresholdPaise: current.rows[0].minimum_threshold_paise,
      usedReservePaise: paiseToString(used),
      deficitPaise: paiseToString(used),
      status: status as ReserveStatusDTO['status'],
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function updateReserveSettings(input: {
  businessId: string;
  targetReservePaise: string;
  minimumThresholdPaise: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE reserve_allocations
     SET target_reserve_paise = $1, minimum_threshold_paise = $2, updated_at = now()
     WHERE business_id = $3`,
    [input.targetReservePaise, input.minimumThresholdPaise, input.businessId],
  );
}
