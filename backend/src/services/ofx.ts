import { createHash } from 'node:crypto';
import type { TransactionType } from '@prisma/client';

export interface ParsedOFXTransaction {
  type: TransactionType;
  amount: string; // valor absoluto em string decimal, sem perda de precisão
  date: Date;
  description: string;
  fitid: string;
  checknum?: string;
}

export interface ParsedOFX {
  bankId?: string;
  accountId?: string;
  transactions: ParsedOFXTransaction[];
}

/**
 * Parser de OFX (SGML 1.x e XML 2.x): extrai blocos <STMTTRN> com FITID, DTPOSTED, TRNAMT e MEMO.
 */
export function parseOFX(content: string): ParsedOFX {
  const transactions: ParsedOFXTransaction[] = [];
  const trnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;

  while ((match = trnRegex.exec(content)) !== null) {
    const block = match[1];
    const dtposted = tag(block, 'DTPOSTED');
    const trnamt = tag(block, 'TRNAMT');
    if (!dtposted || !trnamt) continue;

    const normalized = normalizeAmount(trnamt);
    if (normalized === null) continue;

    const date = parseOFXDate(dtposted);
    if (!date) continue;

    const description = (tag(block, 'MEMO') ?? tag(block, 'NAME') ?? 'Transação Bancária').trim();
    const isDebit = normalized.startsWith('-');
    const amount = isDebit ? normalized.slice(1) : normalized;

    transactions.push({
      type: isDebit ? 'DEBIT' : 'CREDIT',
      amount,
      date,
      description,
      // Sem FITID, gera um id determinístico para que a reimportação continue deduplicando
      fitid: tag(block, 'FITID') ?? syntheticFitid(dtposted, normalized, description),
      checknum: tag(block, 'CHECKNUM') ?? undefined,
    });
  }

  return {
    bankId: tag(content, 'BANKID') ?? undefined,
    accountId: tag(content, 'ACCTID') ?? undefined,
    transactions,
  };
}

function tag(block: string, name: string): string | null {
  const res = new RegExp(`<${name}>([^<\\r\\n]+)`, 'i').exec(block);
  return res ? res[1].trim() : null;
}

/** "1.234,56" | "-1234.56" | "+100" -> "-1234.56" */
function normalizeAmount(raw: string): string | null {
  let v = raw.trim().replace(/\s/g, '');
  if (v.includes(',') && v.includes('.')) v = v.replace(/\./g, '').replace(',', '.');
  else v = v.replace(',', '.');
  if (!/^[+-]?\d+(\.\d+)?$/.test(v)) return null;
  return v.replace(/^\+/, '');
}

/** YYYYMMDD[HHMMSS[.XXX]][[-3:BRT]] -> Date à meia-noite UTC do dia lançado */
function parseOFXDate(raw: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function syntheticFitid(...parts: string[]): string {
  return 'syn_' + createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
