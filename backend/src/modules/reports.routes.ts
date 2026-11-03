import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError, companyIdOf } from '../lib/http.js';
import { buildPanel, panelDetails, withNames } from '../services/dre.js';
import { type LedgerRow, ledgerRows, openEntryRows } from '../services/ledger.js';
import { buildCashflow } from '../services/cashflow.js';
import { openAmount, startOfTodayUtc } from '../services/entries.js';

export const reportsRouter = Router({ mergeParams: true });

const isoDate = z.iso.date().transform((v) => new Date(`${v}T00:00:00.000Z`));
/** Fim do dia, para "até" inclusivo */
const endOfDay = (d: Date) => new Date(d.getTime() + 86_399_999);
const basisQuery = z.enum(['CASH', 'ACCRUAL']).optional(); // padrão: configuração da empresa

/** GET /reports/panel?year=2026&basis=CASH&costCenterId=... — Painel de acompanhamento (matriz anual) */
reportsRouter.get('/panel', async (req, res) => {
  const q = z
    .object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear()), basis: basisQuery, costCenterId: z.uuid().optional() })
    .parse(req.query);
  res.json(await buildPanel({ companyId: companyIdOf(req), ...q }));
});

/** GET /reports/panel/details?from&to&basis&categoryId|groupId|section — lançamentos que compõem uma célula */
reportsRouter.get('/panel/details', async (req, res) => {
  const q = z
    .object({
      from: isoDate,
      to: isoDate,
      basis: basisQuery,
      costCenterId: z.uuid().optional(),
      categoryId: z.uuid().optional(),
      groupId: z.uuid().optional(),
      section: z.enum(['OPERATING_REVENUE', 'OPERATING_COSTS', 'OPERATING_EXPENSES', 'INVESTING', 'FINANCING']).optional(),
    })
    .parse(req.query);
  if (q.from > q.to) throw new HttpError(400, '"from" deve ser anterior a "to"');
  const result = await panelDetails({ companyId: companyIdOf(req), ...q, to: endOfDay(q.to) });
  res.json({ ...result, rows: sortRows(result.rows) });
});

const entriesReportQuery = z.object({
  type: z.enum(['receivable', 'payable']),
  state: z.enum(['open', 'settled']),
  /** open: due (Caixa) ou competence; settled: payment (Caixa) ou competence */
  dateBy: z.enum(['due', 'payment', 'competence']),
  from: isoDate.optional(),
  to: isoDate.optional(),
  contactId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  costCenterId: z.uuid().optional(),
  bankAccountId: z.uuid().optional(),
  search: z.string().trim().optional(),
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
});

const sortRows = <T extends LedgerRow>(rows: T[]) => rows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.description.localeCompare(b.description) || a.group.localeCompare(b.group));

const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * GET /reports/entries — Contas a receber / recebidas / a pagar / pagas.
 * Uma linha por categoria/centro de custo (rateio aberto), com o valor do movimento ao lado.
 */
reportsRouter.get('/entries', async (req, res) => {
  const companyId = companyIdOf(req);
  const q = entriesReportQuery.parse(req.query);
  const direction = q.type === 'receivable' ? 'RECEIVABLE' : 'PAYABLE';
  const to = q.to && endOfDay(q.to);

  let rows: LedgerRow[];
  if (q.state === 'open') {
    rows = await openEntryRows(companyId, direction, q.from, to, q.dateBy === 'competence' ? 'competence' : 'due');
  } else {
    if (!q.from || !to) throw new HttpError(400, 'Informe o período');
    if (to.getTime() - q.from.getTime() > 400 * 86_400_000) throw new HttpError(400, 'Período máximo de 13 meses');
    const flow = direction === 'RECEIVABLE' ? 'IN' : 'OUT';
    rows = (
      await ledgerRows({ companyId, basis: 'CASH', from: q.from, to, dateBy: q.dateBy === 'competence' ? 'competence' : 'payment', bankAccountId: q.bankAccountId })
    ).filter((r) => r.flow === flow);
  }

  const term = q.search ? normalize(q.search) : null;
  rows = rows.filter(
    (r) =>
      (!q.contactId || r.contactId === q.contactId) &&
      (!q.categoryId || r.categoryId === q.categoryId) &&
      (!q.costCenterId || r.costCenterId === q.costCenterId) &&
      (q.min === undefined || r.groupTotal.abs().gte(q.min)) &&
      (q.max === undefined || r.groupTotal.abs().lte(q.max)) &&
      (!term || [r.description, r.documentNumber, r.contactName].some((v) => v && normalize(v).includes(term))),
  );

  // Total do movimento conta cada baixa/lançamento uma vez só (as linhas do rateio repetem o valor)
  const groups = new Map(rows.map((r) => [r.group, r.groupTotal]));
  res.json({
    rows: sortRows(await withNames(rows)),
    totals: { value: rows.reduce((s, r) => s.plus(r.value), new Prisma.Decimal(0)), groupTotal: [...groups.values()].reduce((s, v) => s.plus(v), new Prisma.Decimal(0)) },
  });
});

/** Resumo para o painel: saldos por conta e status de conciliação */
reportsRouter.get('/summary', async (req, res) => {
  const companyId = companyIdOf(req);
  const [accounts, byStatus] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { companyId, isActive: true },
      select: { id: true, name: true, type: true, currentBalance: true, color: true },
      orderBy: { name: 'asc' },
    }),
    prisma.transaction.groupBy({ by: ['reconciliationStatus'], where: { companyId }, _count: { _all: true } }),
  ]);

  const totalBalance = accounts.reduce((sum, a) => sum.plus(a.currentBalance), new Prisma.Decimal(0));
  res.json({
    totalBalance,
    accounts,
    reconciliation: Object.fromEntries(byStatus.map((s) => [s.reconciliationStatus, s._count._all])),
  });
});

const cashflowQuery = z.object({
  from: z.iso.date().transform((v) => new Date(`${v}T00:00:00.000Z`)),
  to: z.iso.date().transform((v) => new Date(`${v}T00:00:00.000Z`)),
  // "id1,id2" — ausente = todas as contas ativas; vazio = nenhuma
  accounts: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()))
    .optional(),
});

/** GET /reports/cashflow?from=2026-09-01&to=2026-11-30&accounts=... */
reportsRouter.get('/cashflow', async (req, res) => {
  const q = cashflowQuery.parse(req.query);
  if (q.from > q.to) throw new HttpError(400, '"from" deve ser anterior a "to"');
  if (q.to.getTime() - q.from.getTime() > 400 * 86_400_000) throw new HttpError(400, 'Período máximo de 13 meses');
  res.json(await buildCashflow({ companyId: companyIdOf(req), from: q.from, to: q.to, accountIds: q.accounts }));
});

/** Alertas para o sino: contas vencidas em aberto e linhas do extrato sem conciliação */
reportsRouter.get('/alerts', async (req, res) => {
  const companyId = companyIdOf(req);
  const today = startOfTodayUtc();
  const overdueWhere = {
    companyId,
    status: 'PENDING' as const,
    OR: [{ expectedDate: { lt: today } }, { expectedDate: null, dueDate: { lt: today } }],
  };
  const select = { amount: true, interestFine: true, discount: true, settledAmount: true } as const;
  const [receivables, payables, unreconciled] = await Promise.all([
    prisma.receivable.findMany({ where: overdueWhere, select }),
    prisma.payable.findMany({ where: overdueWhere, select }),
    prisma.transaction.count({ where: { companyId, reconciliationStatus: { in: ['PENDING', 'SUGGESTED'] } } }),
  ]);
  const sum = (rows: typeof receivables) => rows.reduce((s, e) => s.plus(openAmount(e)), new Prisma.Decimal(0));
  const openRec = receivables.filter((e) => openAmount(e).gt(0));
  const openPay = payables.filter((e) => openAmount(e).gt(0));
  res.json({
    overdue: { count: openRec.length + openPay.length, receivable: sum(openRec), payable: sum(openPay) },
    unreconciledTransactions: unreconciled,
  });
});
