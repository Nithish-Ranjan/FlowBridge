import type { PaymentTransactionDTO } from '@flowbridge/shared';
import { withTransaction } from '../db/pool.js';
import { createImportBatch, finalizeImportBatch } from '../db/repositories/paymentRepo.js';
import { parseBankCsvRows } from './csvRowParser.js';
import { recordSinglePaymentTransaction, type IncomingPaymentInput } from './paymentService.js';

export interface CsvImportRowError {
  rowNumber: number;
  message: string;
}

export interface CsvImportSummary {
  batchId: string;
  totalRows: number;
  insertedRows: number;
  duplicateRows: number;
  errorRows: number;
  errors: CsvImportRowError[];
  insertedTransactions: PaymentTransactionDTO[];
}

export async function importBankTransactions(
  businessId: string,
  options: {
    csvText?: string;
    rows?: IncomingPaymentInput[];
    filename?: string | null;
    sourceType?: 'CSV_IMPORT' | 'MANUAL_ENTRY';
  },
): Promise<CsvImportSummary> {
  const filename = options.filename ?? (options.csvText ? 'bank_statement.csv' : 'parsed_rows.json');
  const sourceType = options.sourceType ?? 'CSV_IMPORT';

  const normalizedOutcomes = options.csvText
    ? parseBankCsvRows(options.csvText).rows
    : (options.rows ?? []).map((input, idx) => ({
        rowNumber: idx + 1,
        input: { ...input, sourceType },
        error: null,
      }));

  return withTransaction(async (client) => {
    const batchId = await createImportBatch(
      {
        businessId,
        sourceType,
        filename,
        totalRows: normalizedOutcomes.length,
      },
      client,
    );

    let insertedRows = 0;
    let duplicateRows = 0;
    let errorRows = 0;
    const errors: CsvImportRowError[] = [];
    const insertedTransactions: PaymentTransactionDTO[] = [];

    for (let i = 0; i < normalizedOutcomes.length; i += 1) {
      const item = normalizedOutcomes[i];
      if (item.error || !item.input) {
        errorRows += 1;
        errors.push({
          rowNumber: item.rowNumber,
          message: item.error ?? 'Invalid row',
        });
        continue;
      }

      try {
        await client.query(`SAVEPOINT csv_row_${i}`);
        try {
          const res = await recordSinglePaymentTransaction(
            businessId,
            item.input,
            batchId,
            client,
          );
          await client.query(`RELEASE SAVEPOINT csv_row_${i}`);

          if (res.duplicate) {
            duplicateRows += 1;
          } else if (res.transaction) {
            insertedRows += 1;
            insertedTransactions.push(res.transaction);
          }
        } catch (innerErr) {
          await client.query(`ROLLBACK TO SAVEPOINT csv_row_${i}`);
          throw innerErr;
        }
      } catch (err) {
        errorRows += 1;
        errors.push({
          rowNumber: item.rowNumber,
          message: (err as Error).message,
        });
      }
    }

    const status =
      errorRows === 0
        ? 'COMPLETED'
        : insertedRows > 0 || duplicateRows > 0
          ? 'PARTIAL_WITH_ERRORS'
          : 'FAILED';

    await finalizeImportBatch(
      batchId,
      {
        status,
        insertedRows,
        duplicateRows,
        errorRows,
        errorSummary: errors,
      },
      client,
    );

    return {
      batchId,
      totalRows: normalizedOutcomes.length,
      insertedRows,
      duplicateRows,
      errorRows,
      errors,
      insertedTransactions,
    };
  });
}

export async function importBankCsv(
  businessId: string,
  csvText: string,
  filename: string | null = 'bank_statement.csv',
): Promise<CsvImportSummary> {
  return importBankTransactions(businessId, { csvText, filename, sourceType: 'CSV_IMPORT' });
}
