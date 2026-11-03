import { Prisma, type EntryDirection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { D, displayDescription, entries, extendRecurrences, openAmount, startOfTodayUtc } from './entries.js';

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface CashflowFilters {
  companyId: string;
  from: Date;
  to: Date;
  /** Contas consideradas no saldo; ausente = todas as ativas */
  accountIds?: string[];
}

/** Lançamento em aberto como aparece no fluxo (data = previsto para, ou vencimento) */
async function openEntries(companyId: string, direction: EntryDirection, until: Date) {
  await extendRecurrences(companyId, direction);
  const rows = await entries(prisma, direction).findMany({
    where: {
      companyId,
      status: 'PENDING',
      OR: [{ expectedDate: { lte: until } }, { expectedDate: null, dueDate: { lte: until } }],
    },
    include: { contact: { select: { name: true } } },
  });
  return rows
    .map((e) => {
      const amount = openAmount(e);
      return {
        id: e.id,
        direction,
        date: e.expectedDate ?? e.dueDate,
        dueDate: e.dueDate,
        contactName: e.contact?.name ?? null,
        description: displayDescription(e),
        amount,
        signed: direction === 'RECEIVABLE' ? amount : amount.negated(),
      };
    })
    .filter((e) => e.amount.gt(0));
}

/**
 * Fluxo de caixa: saldo real (extrato + baixas) até hoje e projeção pelos agendamentos em aberto.
 * - Passados: em aberto com data anterior a hoje (não entram na projeção, como no Nibo)
 * - Futuros: de hoje até o fim do período, com saldo acumulado a partir do saldo de hoje
 */
export async function buildCashflow({ companyId, from, to, accountIds }: CashflowFilters) {
  const today = startOfTodayUtc();
  const accounts = await prisma.bankAccount.findMany({
    where: { companyId, isActive: true, ...(accountIds && { id: { in: accountIds } }) },
    select: { id: true, currentBalance: true },
  });
  const ids = accounts.map((a) => a.id);
  const balanceToday = accounts.reduce((s, a) => s.plus(a.currentBalance), D(0));

  // Movimento diário real das contas (para reconstruir o saldo de cada dia do período)
  const daily = await prisma.transaction.groupBy({
    by: ['date', 'type'],
    where: { bankAccountId: { in: ids }, date: { gt: from }, reconciliationStatus: 'RECONCILED' },
    _sum: { amount: true },
  });
  const netByDay = new Map<string, Prisma.Decimal>();
  for (const d of daily) {
    const v = d._sum.amount ?? D(0);
    const key = isoDay(d.date);
    netByDay.set(key, (netByDay.get(key) ?? D(0)).plus(d.type === 'CREDIT' ? v : v.negated()));
  }

  const [receivables, payables] = await Promise.all([openEntries(companyId, 'RECEIVABLE', to), openEntries(companyId, 'PAYABLE', to)]);
  const all = [...receivables, ...payables].sort((a, b) => a.date.getTime() - b.date.getTime() || a.description.localeCompare(b.description));
  const past = all.filter((e) => e.date < today);
  const upcoming = all.filter((e) => e.date >= today);

  const projectedByDay = new Map<string, Prisma.Decimal>();
  for (const e of upcoming) {
    const key = isoDay(e.date);
    projectedByDay.set(key, (projectedByDay.get(key) ?? D(0)).plus(e.signed));
  }

  // Série diária: real até hoje (desfaz movimentos posteriores), projetada de hoje em diante
  const series: { date: string; actual: number | null; projected: number | null }[] = [];
  let afterDay = [...netByDay.entries()].filter(([k]) => k > isoDay(to < today ? to : today)).reduce((s, [, v]) => s.plus(v), D(0));
  const actualByDay = new Map<string, Prisma.Decimal>();
  for (let t = Math.min(to.getTime(), today.getTime()); t >= from.getTime(); t -= DAY_MS) {
    const key = isoDay(new Date(t));
    actualByDay.set(key, balanceToday.minus(afterDay));
    afterDay = afterDay.plus(netByDay.get(key) ?? D(0));
  }
  let running = balanceToday;
  for (const [k, v] of projectedByDay) if (k < isoDay(from) && k >= isoDay(today)) running = running.plus(v); // período começando no futuro
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const day = new Date(t);
    const key = isoDay(day);
    let projected: number | null = null;
    if (day >= today) {
      running = running.plus(projectedByDay.get(key) ?? D(0));
      projected = running.toNumber();
    }
    series.push({
      date: key,
      actual: actualByDay.has(key) ? actualByDay.get(key)!.toNumber() : null,
      // Liga as duas linhas no dia de hoje
      projected: key === isoDay(today) ? balanceToday.toNumber() : projected,
    });
  }

  // Lista de futuros com saldo acumulado
  let balance = balanceToday;
  const futureItems = upcoming.map((e) => {
    balance = balance.plus(e.signed);
    return { ...e, balance };
  });

  const sum = (list: typeof all, dir: EntryDirection) => list.filter((e) => e.direction === dir).reduce((s, e) => s.plus(e.amount), D(0));
  return {
    from: isoDay(from),
    to: isoDay(to),
    today: isoDay(today),
    accountIds: ids,
    balanceToday,
    series,
    past,
    future: { openingBalance: balanceToday, items: futureItems },
    totals: {
      pastIn: sum(past, 'RECEIVABLE'),
      pastOut: sum(past, 'PAYABLE'),
      futureIn: sum(upcoming, 'RECEIVABLE'),
      futureOut: sum(upcoming, 'PAYABLE'),
      projectedEnd: balance,
    },
  };
}
