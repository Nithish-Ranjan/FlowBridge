// bankSmsParser.ts
// Real Indian Bank SMS Transaction Ingestion Engine
// Parses SMS templates from major Indian banks (HDFC, ICICI, SBI, Axis, Kotak)
// Converts amounts strictly to integer paise and extracts UPI/UTR reference numbers.

export interface ParsedBankSms {
  bank: 'HDFC' | 'ICICI' | 'SBI' | 'AXIS' | 'KOTAK' | 'GENERIC';
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  amountFormatted: string;
  accountTail: string | null;
  referenceNumber: string | null;
  counterpartyHint: string | null;
  transactionDate: string; // YYYY-MM-DD
  confidenceScore: number; // 0 - 100
  rawSms: string;
}

export function parseIndianBankSms(
  rawText: string,
  senderHeader: string = '',
  defaultDate: string = new Date().toISOString().slice(0, 10),
): ParsedBankSms | null {
  if (!rawText || typeof rawText !== 'string') return null;

  const text = rawText.trim();
  const lower = text.toLowerCase();
  const headerLower = senderHeader.toLowerCase();

  // Determine direction
  const isCredit = lower.includes('credited') || lower.includes('received') || lower.includes('deposited');
  const isDebit = lower.includes('debited') || lower.includes('withdrawn') || lower.includes('sent') || lower.includes('paid');

  if (!isCredit && !isDebit) {
    return null;
  }

  const direction: 'CREDIT' | 'DEBIT' = isCredit ? 'CREDIT' : 'DEBIT';

  // Identify Bank
  let bank: ParsedBankSms['bank'] = 'GENERIC';
  if (lower.includes('hdfc') || headerLower.includes('hdfc')) bank = 'HDFC';
  else if (lower.includes('icici') || headerLower.includes('icici')) bank = 'ICICI';
  else if (lower.includes('sbi') || lower.includes('state bank') || headerLower.includes('sbi')) bank = 'SBI';
  else if (lower.includes('axis') || headerLower.includes('axis')) bank = 'AXIS';
  else if (lower.includes('kotak') || headerLower.includes('kotak')) bank = 'KOTAK';

  // Extract Amount (e.g., "Rs 25,000.00", "INR 15,500.00", "Rs.40,000", "Rs 1,200")
  const amountRegex = /(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;
  const amountMatch = text.match(amountRegex);
  if (!amountMatch) return null;

  const rawAmountStr = amountMatch[1].replace(/,/g, '');
  const amountNum = parseFloat(rawAmountStr);
  if (isNaN(amountNum) || amountNum <= 0) return null;

  const amountPaise = Math.round(amountNum * 100);

  // Extract Account Tail (e.g. "a/c **4012", "Acct XX9021", "a/c no. XXXXXXXX1234", "A/C XX4412", "Ac 5678")
  let accountTail: string | null = null;
  const acctRegex = /(?:a\/c|acct|ac|account)\s*(?:no\.?)?\s*[*xX]*(\d{3,6})/i;
  const acctMatch = text.match(acctRegex);
  if (acctMatch) {
    accountTail = acctMatch[1];
  }

  // Extract Reference Number (UPI Ref, UTR, IMPS, RRN)
  let referenceNumber: string | null = null;
  const refRegex = /(?:upi\s*ref(?:\s*no\.?)?|ref\s*no\.?|utr|rrn|imps|transfer\s*ref)[:\s/]*([a-zA-Z0-9]{8,22})/i;
  const refMatch = text.match(refRegex);
  if (refMatch) {
    referenceNumber = refMatch[1].trim();
  } else {
    const upiSlashRefMatch = text.match(/upi\/(\d{8,22})\//i);
    if (upiSlashRefMatch) {
      referenceNumber = upiSlashRefMatch[1].trim();
    } else {
      const upi12DigitMatch = text.match(/\b\d{12}\b/);
      if (upi12DigitMatch) {
        referenceNumber = upi12DigitMatch[0];
      }
    }
  }

  // Extract Counterparty Hint / VPA / Name
  let counterpartyHint: string | null = null;

  // 1. Check for VPA (e.g. ramesh@okhdfcbank or ramesh@kotak or user@upi)
  const vpaMatch = text.match(/(?:vpa|upi\s*id|info:\s*upi\/|upi\/)[:\s]*([a-zA-Z0-9.\-_]+@[a-zA-Z0-9]+)/i);
  if (vpaMatch) {
    counterpartyHint = vpaMatch[1];
  } else {
    // 2. Check for UPI/ref/party format (e.g. UPI/431788123999/Anand Kirana)
    const slashPartyMatch = text.match(/upi\/\d+\/([a-zA-Z0-9\s._-]+?)(?:\.|\s+avail|\s+bal|\s+balance|\s*$)/i);
    if (slashPartyMatch) {
      counterpartyHint = slashPartyMatch[1].trim();
    } else {
      // 3. Check for "transfer from [Name]"
      const transferFromMatch = text.match(/transfer\s+from\s+([A-Za-z\s]{2,24}?)(?:\s+upi|\s+ref|\s+on|\s+a\/c|\.|\()/i);
      if (transferFromMatch) {
        counterpartyHint = transferFromMatch[1].trim();
      } else {
        // 4. Check for "by [Name]" or "from [Name]"
        const fromPartyMatch = text.match(/(?:from|by)\s+([A-Za-z\s]{3,24}?)(?:\s+upi|\s+ref|\s+on|\s+a\/c|\.|\()/i);
        if (fromPartyMatch) {
          const hint = fromPartyMatch[1].replace(/^(?:transfer\s+from|transfer|cheque|neft|imps|rtgs|account|card)\s*/i, '').trim();
          if (hint.length > 1) {
            counterpartyHint = hint;
          }
        }
      }
    }
  }

  // Transaction Date
  let transactionDate = defaultDate;
  const dateRegex = /\bon\s+(\d{1,2})[-/ ]?([a-zA-Z]{3}|\d{1,2})[-/ ]?(\d{2,4})\b/i;
  const dateMatch = text.match(dateRegex);
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const monthStr = dateMatch[2].toLowerCase();
    let year = parseInt(dateMatch[3], 10);
    if (year < 100) year += 2000;

    const monthMap: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
    };

    let month = monthMap[monthStr] || parseInt(monthStr, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      transactionDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Calculate confidence score
  let confidenceScore = 60;
  if (bank !== 'GENERIC') confidenceScore += 10;
  if (referenceNumber) confidenceScore += 15;
  if (accountTail) confidenceScore += 5;
  if (counterpartyHint) confidenceScore += 10;
  confidenceScore = Math.min(confidenceScore, 100);

  return {
    bank,
    direction,
    amountPaise,
    amountFormatted: `₹${(amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    accountTail,
    referenceNumber,
    counterpartyHint,
    transactionDate,
    confidenceScore,
    rawSms: text,
  };
}
