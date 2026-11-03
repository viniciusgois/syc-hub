import { Prisma, type EntryDirection, type TransactionType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { D, type Entry, displayDescription, entries, openAmount, settlementType } from './entries.js';

/** Tolerância (dias) entre a data da linha do extrato e o vencimento/previsto do lançamento */
export const MATCH_TOLERANCE_DAYS = 5;
const DAY_MS = 86_400_000;
/** Janela padrão de busca nos diálogos de conciliação (sem texto de busca) */
const SEARCH_WINDOW_DAYS = 60;

const directionFor = (type: TransactionType): EntryDirection => (type === 'CREDIT' ? 'RECEIVABLE' : 'PAYABLE');

/** Menor distância (dias) entre a data e o vencimento ou a data prevista */
function daysApart(e: Pick<Entry, 'dueDate' | 'expectedDate'>, date: Date) {
  const diffs = [e.dueDate, e.expectedDate].filter((d): d is Date => !!d).map((d) => Math.abs(d.getTime() - date.getTime()) / DAY_MS);
  return Math.min(...diffs);
}

export interface EntryCandidate {
  direction: EntryDirection;
  id: string;
  description: string;
  contactName: string | null;
  categoryName: string | null;
  dueDate: Date;
  expectedDate: Date | null;
  openAmount: Prisma.Decimal;
  exactAmount: boolean;
  daysApart: number;
}

const toCandidate = (direction: EntryDirection, e: Entry & { contact: { name: string } | null; category: { name: string } | null }, amount: Prisma.Decimal.Value, date: Date): EntryCandidate => {
  const open = openAmount(e);
  return {
    direction,
    id: e.id,
    description: displayDescription(e),
    contactName: e.contact?.name ?? null,
    categoryName: e.category?.name ?? null,
    dueDate: e.dueDate,
    expectedDate: e.expectedDate,
    openAmount: open,
    exactAmount: open.eq(amount),
    daysApart: Math.round(daysApart(e, date)),
  };
};

async function openEntriesNear(companyId: string, direction: EntryDirection, from?: Date, to?: Date, search?: string) {
  const dateFilter = from && to ? { OR: [{ dueDate: { gte: from, lte: to } }, { expectedDate: { gte: from, lte: to } }] } : {};
  const searchFilter = search
    ? {
        OR: [
          { description: { contains: search, mode: 'insensitive' as const } },
          { documentNumber: { contains: search, mode: 'insensitive' as const } },
          { contact: { name: { contains: search, mode: 'insensitive' as const } } },
        ],
      }
    : {};
  const rows = await entries(prisma, direction).findMany({
    where: { companyId, status: 'PENDING', AND: [dateFilter, searchFilter] },
    include: { contact: { select: { name: true } }, category: { select: { name: true } } },
    take: 500,
  });
  return rows.filter((e) => openAmount(e).gt(0));
}

/**
 * Sugestões automáticas (opção "só sugerir"): para cada linha, o lançamento em aberto da mesma direção
 * com valor exato e data mais próxima dentro da tolerância. Um lançamento não é sugerido para duas linhas.
 */
export async function suggestEntryMatches(
  companyId: string,
  lines: { key: string; type: TransactionType; amount: Prisma.Decimal.Value; date: Date }[],
) {
  const result = new Map<string, EntryCandidate>();
  if (!lines.length) return result;
  const times = lines.map((l) => l.date.getTime());
  const from = new Date(Math.min(...times) - MATCH_TOLERANCE_DAYS * DAY_MS);
  const to = new Date(Math.max(...times) + MATCH_TOLERANCE_DAYS * DAY_MS);

  const pool = {
    RECEIVABLE: lines.some((l) => l.type === 'CREDIT') ? await openEntriesNear(companyId, 'RECEIVABLE', from, to) : [],
    PAYABLE: lines.some((l) => l.type === 'DEBIT') ? await openEntriesNear(companyId, 'PAYABLE', from, to) : [],
  };
  const used = new Set<string>();

  for (const line of [...lines].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const direction = directionFor(line.type);
    const best = pool[direction]
      .filter((e) => !used.has(e.id) && openAmount(e).eq(line.amount))
      .map((e) => ({ e, dist: daysApart(e, line.date) }))
      .filter((c) => c.dist <= MATCH_TOLERANCE_DAYS)
      .sort((a, b) => a.dist - b.dist)[0];
    if (best) {
      used.add(best.e.id);
      result.set(line.key, toCandidate(direction, best.e, line.amount, line.date));
    }
  }
  return result;
}

/** Lançamentos em aberto que uma linha do extrato pode quitar (diálogo "Conciliar" no extrato) */
export async function entryCandidates(
  companyId: string,
  tx: { type: TransactionType; amount: Prisma.Decimal.Value; date: Date },
  search?: string,
) {
  const direction = directionFor(tx.type);
  const window = search ? [] : [new Date(tx.date.getTime() - SEARCH_WINDOW_DAYS * DAY_MS), new Date(tx.date.getTime() + SEARCH_WINDOW_DAYS * DAY_MS)];
  const rows = await openEntriesNear(companyId, direction, window[0], window[1], search);
  return rows
    .map((e) => toCandidate(direction, e, tx.amount, tx.date))
    .sort((a, b) => Number(b.exactAmount) - Number(a.exactAmount) || a.daysApart - b.daysApart)
    .slice(0, 50);
}

/** Linhas do extrato ainda não conciliadas com contas que podem ser este lançamento ("buscar no extrato") */
export async function statementCandidates(companyId: string, direction: EntryDirection, entry: Entry, search?: string) {
  const open = openAmount(entry);
  const ref = entry.expectedDate ?? entry.dueDate;
  const rows = await prisma.transaction.findMany({
    where: {
      companyId,
      type: settlementType(direction),
      origin: { not: 'SETTLEMENT' },
      reconciliationStatus: { not: 'IGNORED' },
      settlements: { none: {} },
      ...(search
        ? { OR: [{ description: { contains: search, mode: 'insensitive' } }, { customDescription: { contains: search, mode: 'insensitive' } }] }
        : { date: { gte: new Date(ref.getTime() - SEARCH_WINDOW_DAYS * DAY_MS), lte: new Date(ref.getTime() + SEARCH_WINDOW_DAYS * DAY_MS) } }),
    },
    include: { bankAccount: { select: { name: true } } },
    take: 300,
  });
  return rows
    .map((t) => ({
      id: t.id,
      date: t.date,
      description: t.customDescription || t.description,
      amount: t.amount,
      type: t.type,
      bankAccountName: t.bankAccount.name,
      reconciliationStatus: t.reconciliationStatus,
      exactAmount: D(t.amount).eq(open),
      daysApart: Math.round(daysApart(entry, t.date)),
    }))
    .sort((a, b) => Number(b.exactAmount) - Number(a.exactAmount) || a.daysApart - b.daysApart)
    .slice(0, 50);
}
