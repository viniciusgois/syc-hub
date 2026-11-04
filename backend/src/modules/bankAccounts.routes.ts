import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { companyIdOf, idParam, notFound } from '../lib/http.js';
import { recalculateBalance } from '../services/balance.js';
import { displayDescription, startOfTodayUtc } from '../services/entries.js';

export const bankAccountsRouter = Router({ mergeParams: true });

// Texto opcional: aceita ausente, null ou vazio (vira null)
const optionalText = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullish();

const accountSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(['CHECKING', 'SAVINGS', 'INVESTMENT', 'CASH', 'CREDIT_CARD', 'PAYMENT_GATEWAY', 'OTHER']).optional(),
  holderType: z.enum(['LEGAL', 'NATURAL']).optional(),
  bankCode: optionalText,
  bankName: optionalText,
  agency: optionalText,
  accountNumber: optionalText,
  accountDigit: optionalText,
  initialBalance: z.number().optional(),
  initialBalanceDate: z.coerce.date().optional(),
  color: z.string().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

bankAccountsRouter.get('/', async (req, res) => {
  const companyId = companyIdOf(req);
  const [accounts, pending] = await Promise.all([
    prisma.bankAccount.findMany({ where: { companyId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    prisma.transaction.groupBy({
      by: ['bankAccountId'],
      where: { companyId, reconciliationStatus: { in: ['PENDING', 'SUGGESTED'] } },
      _count: { _all: true },
    }),
  ]);
  const pendingByAccount = new Map(pending.map((p) => [p.bankAccountId, p._count._all]));
  res.json(accounts.map((a) => ({ ...a, unreconciledCount: pendingByAccount.get(a.id) ?? 0 })));
});

bankAccountsRouter.get('/:id', async (req, res) => {
  const account = await prisma.bankAccount.findFirst({ where: { id: idParam(req), companyId: companyIdOf(req) } });
  if (!account) throw notFound('Conta bancária');
  res.json(account);
});

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const signed = (t: { type: 'CREDIT' | 'DEBIT'; amount: Prisma.Decimal }) => (t.type === 'CREDIT' ? t.amount : t.amount.negated());

/**
 * Extrato da conta no período (como o "Extrato" do Nibo): só o que foi conciliado/lançado, com saldo anterior,
 * saldo após cada linha e o saldo de cada dia (gráfico). O importado ainda não conciliado fica na Conciliação.
 */
bankAccountsRouter.get('/:id/statement', async (req, res) => {
  const companyId = companyIdOf(req);
  const q = z.object({ from: z.iso.date(), to: z.iso.date() }).parse(req.query);
  const account = await prisma.bankAccount.findFirst({ where: { id: idParam(req), companyId } });
  if (!account) throw notFound('Conta bancária');

  const from = new Date(`${q.from}T00:00:00.000Z`);
  const to = new Date(`${q.to}T00:00:00.000Z`);
  // Movimentos anteriores à data do saldo inicial já estão dentro dele
  const start = from < account.initialBalanceDate ? account.initialBalanceDate : from;
  const reconciled = { bankAccountId: account.id, reconciliationStatus: 'RECONCILED' as const };

  const [before, rows, pending] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { ...reconciled, date: { gte: account.initialBalanceDate, lt: start } },
      _sum: { amount: true },
    }),
    prisma.transaction.findMany({
      where: { ...reconciled, date: { gte: start, lte: to } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: {
        contact: { select: { name: true } },
        category: { select: { name: true } },
        _count: { select: { splits: true } },
        settlements: {
          select: {
            receivable: { select: { id: true, description: true, installmentNumber: true, installmentTotal: true } },
            payable: { select: { id: true, description: true, installmentNumber: true, installmentTotal: true } },
          },
        },
      },
    }),
    prisma.transaction.count({ where: { bankAccountId: account.id, reconciliationStatus: { in: ['PENDING', 'SUGGESTED'] } } }),
  ]);
  // Movimentos anteriores à data do saldo inicial não entram no saldo: o extrato avisa (ex.: transferência importada depois)
  const beforeInitial = await prisma.transaction.aggregate({
    where: { ...reconciled, date: { lt: account.initialBalanceDate } },
    _count: { _all: true },
    _min: { date: true },
  });
  const counterparts = await prisma.transaction.findMany({
    where: { id: { in: rows.map((r) => r.transferCounterpartId).filter((v): v is string => !!v) } },
    select: { id: true, bankAccount: { select: { id: true, name: true } } },
  });
  const counterpartAccount = new Map(counterparts.map((c) => [c.id, c.bankAccount]));

  let balance = before.reduce((acc, b) => (b.type === 'CREDIT' ? acc.plus(b._sum.amount ?? 0) : acc.minus(b._sum.amount ?? 0)), new Prisma.Decimal(account.initialBalance));
  const previousBalance = balance;
  const endOfDay = new Map<string, Prisma.Decimal>();
  const lines = rows.map((t) => {
    balance = balance.plus(signed(t));
    endOfDay.set(isoDay(t.date), balance);
    const links = t.settlements.map((l) => (l.receivable ? { direction: 'RECEIVABLE' as const, entry: l.receivable } : { direction: 'PAYABLE' as const, entry: l.payable! }));
    return {
      id: t.id,
      date: t.date,
      type: t.type,
      amount: t.amount,
      description: t.customDescription || t.description,
      bankDescription: t.description,
      contactName: t.contact?.name ?? null,
      categoryName: t.isTransfer ? 'Transferência' : (t.category?.name ?? null),
      splitCount: t._count.splits,
      documentNumber: t.checknum,
      origin: t.origin,
      fromBank: !!t.fitid,
      isTransfer: t.isTransfer,
      transferAccount: t.transferCounterpartId ? (counterpartAccount.get(t.transferCounterpartId) ?? null) : null,
      entries: links.map((l) => ({ direction: l.direction, id: l.entry.id, description: displayDescription(l.entry) })),
      balance,
    };
  });

  // Saldo ao fim de cada dia (até hoje), para o gráfico
  const daily: { date: string; balance: Prisma.Decimal }[] = [];
  const last = Math.min(to.getTime(), startOfTodayUtc().getTime());
  let running = previousBalance;
  for (let t = from.getTime(); t <= last; t += DAY_MS) {
    const key = isoDay(new Date(t));
    running = endOfDay.get(key) ?? running;
    daily.push({ date: key, balance: running });
  }

  res.json({
    account: { id: account.id, name: account.name, currentBalance: account.currentBalance, initialBalanceDate: account.initialBalanceDate },
    from: q.from,
    to: q.to,
    previousBalance,
    finalBalance: balance,
    pendingCount: pending,
    beforeInitial: beforeInitial._count._all ? { count: beforeInitial._count._all, firstDate: beforeInitial._min.date } : null,
    rows: lines,
    daily,
  });
});

bankAccountsRouter.post('/', async (req, res) => {
  const data = accountSchema.parse(req.body);
  const account = await prisma.bankAccount.create({
    data: { ...data, companyId: companyIdOf(req), currentBalance: data.initialBalance ?? 0 },
  });
  res.status(201).json(account);
});

bankAccountsRouter.patch('/:id', async (req, res) => {
  const data = accountSchema.partial().parse(req.body);
  const where = { id: idParam(req), companyId: companyIdOf(req) };
  if (!(await prisma.bankAccount.findFirst({ where }))) throw notFound('Conta bancária');

  const account = await prisma.$transaction(async (db) => {
    const updated = await db.bankAccount.update({ where: { id: where.id }, data });
    const balanceChanged = data.initialBalance !== undefined || data.initialBalanceDate !== undefined;
    return balanceChanged ? recalculateBalance(db, updated.id) : updated;
  });
  res.json(account);
});

// Contas com movimentações não são excluídas: apenas desativadas
bankAccountsRouter.delete('/:id', async (req, res) => {
  const where = { id: idParam(req), companyId: companyIdOf(req) };
  if (!(await prisma.bankAccount.findFirst({ where }))) throw notFound('Conta bancária');
  const hasTx = await prisma.transaction.count({ where: { bankAccountId: where.id } });
  if (hasTx) {
    res.json(await prisma.bankAccount.update({ where: { id: where.id }, data: { isActive: false } }));
    return;
  }
  await prisma.bankAccount.delete({ where: { id: where.id } });
  res.status(204).end();
});
