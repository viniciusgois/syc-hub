import { Prisma, type EntryDirection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { displayDescription, openAmount, startOfTodayUtc, totalDue } from './entries.js';

/**
 * Razão gerencial: decompõe o movimento da empresa em linhas (categoria, centro de custo, valor com sinal).
 * É a base única do Painel de acompanhamento, do detalhamento de cada célula e dos relatórios de contas,
 * para que os números batam entre as telas.
 *
 * Regimes (decisão da equipe — não há "visão" separada como no Nibo):
 * - Caixa: só o realizado (linhas do extrato conciliadas e baixas), pela data do pagamento/recebimento
 * - Competência: realizado + agendado, pela data de competência (exceto perdas)
 */

const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);

export type Basis = 'CASH' | 'ACCRUAL';

export interface LedgerRow {
  /** Agrupa as linhas de um mesmo movimento (baixa, linha do extrato ou lançamento) */
  group: string;
  flow: 'IN' | 'OUT';
  /** Data que conta no regime/filtro pedido */
  date: Date;
  categoryId: string | null;
  costCenterId: string | null;
  /** Valor da categoria/centro de custo, com sinal (+ entrada, − saída) */
  value: Prisma.Decimal;
  /** Valor do movimento inteiro (baixa, linha ou em aberto), com sinal */
  groupTotal: Prisma.Decimal;
  realized: boolean;
  entry: { id: string; direction: EntryDirection } | null;
  transactionId: string | null;
  description: string;
  documentNumber: string | null;
  contactId: string | null;
  contactName: string | null;
  dueDate: Date | null;
  issueDate: Date | null;
  paidAt: Date | null;
  bankAccountName: string | null;
  isOverdue: boolean;
}

// ----------------------------------------------------------------------------
// Composição de um lançamento: rateio (ou categoria única) + juros/multa − desconto
// ----------------------------------------------------------------------------

/** Categorias do sistema que recebem juros/multa e desconto quando o rateio está ativo */
const SYSTEM_CATEGORY = {
  RECEIVABLE: { interest: 'Multas recebidas', discount: 'Descontos concedidos' },
  PAYABLE: { interest: 'Multas pagas', discount: 'Descontos obtidos' },
} as const;

export interface LedgerContext {
  /** Rateio ativo: juros/multa e desconto vão para as categorias do sistema (senão, para a categoria do lançamento) */
  separate: boolean;
  system: Record<EntryDirection, { interest?: string; discount?: string }>;
}

export async function ledgerContext(companyId: string): Promise<LedgerContext> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { splitsEnabled: true } });
  const names = Object.values(SYSTEM_CATEGORY).flatMap((v) => Object.values(v));
  const system = await prisma.category.findMany({ where: { companyId, isSystem: true, name: { in: names } }, select: { id: true, name: true } });
  const idOf = (name: string) => system.find((c) => c.name === name)?.id;
  return {
    separate: company.splitsEnabled,
    system: {
      RECEIVABLE: { interest: idOf(SYSTEM_CATEGORY.RECEIVABLE.interest), discount: idOf(SYSTEM_CATEGORY.RECEIVABLE.discount) },
      PAYABLE: { interest: idOf(SYSTEM_CATEGORY.PAYABLE.interest), discount: idOf(SYSTEM_CATEGORY.PAYABLE.discount) },
    },
  };
}

const entrySelect = {
  id: true,
  description: true,
  documentNumber: true,
  installmentNumber: true,
  installmentTotal: true,
  dueDate: true,
  issueDate: true,
  status: true,
  amount: true,
  interestFine: true,
  discount: true,
  settledAmount: true,
  settledAt: true,
  categoryId: true,
  costCenterId: true,
  interestCategoryId: true,
  discountCategoryId: true,
  contactId: true,
  contact: { select: { name: true } },
  splits: { orderBy: { orderIndex: 'asc' }, select: { categoryId: true, costCenterId: true, amount: true } },
} as const;

type EntryRecord = Prisma.ReceivableGetPayload<{ select: typeof entrySelect }>;

/** (categoria, centro de custo, valor com sinal) somando o total devido do lançamento */
function entryComponents(e: EntryRecord, direction: EntryDirection, ctx: LedgerContext) {
  const sign = direction === 'RECEIVABLE' ? 1 : -1;
  const parts = e.splits.length
    ? e.splits.map((l) => ({ categoryId: l.categoryId as string | null, costCenterId: l.costCenterId, value: D(l.amount) }))
    : [{ categoryId: e.categoryId, costCenterId: e.costCenterId, value: D(e.amount) }];
  const target = (explicit: string | null, system?: string) => explicit ?? (ctx.separate && system ? system : e.categoryId);
  if (D(e.interestFine).gt(0)) parts.push({ categoryId: target(e.interestCategoryId, ctx.system[direction].interest), costCenterId: e.costCenterId, value: D(e.interestFine) });
  if (D(e.discount).gt(0)) parts.push({ categoryId: target(e.discountCategoryId, ctx.system[direction].discount), costCenterId: e.costCenterId, value: D(e.discount).negated() });
  return parts.map((p) => ({ ...p, value: p.value.times(sign) }));
}

function entryBase(e: EntryRecord, direction: EntryDirection) {
  return {
    flow: direction === 'RECEIVABLE' ? ('IN' as const) : ('OUT' as const),
    entry: { id: e.id, direction },
    description: displayDescription(e),
    documentNumber: e.documentNumber,
    contactId: e.contactId,
    contactName: e.contact?.name ?? null,
    dueDate: e.dueDate,
    issueDate: e.issueDate,
  };
}

/** Linhas de um lançamento escaladas por `factor` (baixa parcial, em aberto...) */
function entryRows(e: EntryRecord, direction: EntryDirection, ctx: LedgerContext, factor: Prisma.Decimal, fixed: Omit<LedgerRow, keyof ReturnType<typeof entryBase> | 'categoryId' | 'costCenterId' | 'value'>): LedgerRow[] {
  const base = entryBase(e, direction);
  return entryComponents(e, direction, ctx).map((c) => ({ ...base, ...fixed, categoryId: c.categoryId, costCenterId: c.costCenterId, value: c.value.times(factor).toDecimalPlaces(2) }));
}

// ----------------------------------------------------------------------------
// Fontes
// ----------------------------------------------------------------------------

/** Linhas do extrato sem transferências entre contas */
const notTransfer: Prisma.TransactionWhereInput = { isTransfer: false, NOT: { category: { is: { type: 'TRANSFER' } } } };

/** Linhas do extrato categorizadas direto (sem conta a pagar/receber vinculada), com ou sem rateio */
async function directRows(where: Prisma.TransactionWhereInput): Promise<LedgerRow[]> {
  const txs = await prisma.transaction.findMany({
    where: { ...where, ...notTransfer, settlements: { none: {} } },
    select: {
      id: true,
      type: true,
      amount: true,
      date: true,
      description: true,
      customDescription: true,
      checknum: true,
      categoryId: true,
      costCenterId: true,
      contactId: true,
      contact: { select: { name: true } },
      bankAccount: { select: { name: true } },
      splits: { orderBy: { orderIndex: 'asc' }, select: { categoryId: true, costCenterId: true, amount: true } },
    },
  });
  return txs.flatMap((t) => {
    const sign = t.type === 'CREDIT' ? 1 : -1;
    const parts = t.splits.length ? t.splits : [{ categoryId: t.categoryId, costCenterId: t.costCenterId, amount: t.amount }];
    return parts.map((p) => ({
      group: `t${t.id}`,
      flow: t.type === 'CREDIT' ? ('IN' as const) : ('OUT' as const),
      date: t.date,
      categoryId: p.categoryId,
      costCenterId: p.costCenterId,
      value: D(p.amount).times(sign),
      groupTotal: D(t.amount).times(sign),
      realized: true,
      entry: null,
      transactionId: t.id,
      description: t.customDescription || t.description,
      documentNumber: t.checknum,
      contactId: t.contactId,
      contactName: t.contact?.name ?? null,
      dueDate: t.date,
      issueDate: t.date,
      paidAt: t.date,
      bankAccountName: t.bankAccount.name,
      isOverdue: false,
    }));
  });
}

/** Baixas (parte de cada linha do extrato que quitou uma conta), proporcionais à composição da conta */
async function settlementRows(where: Prisma.EntrySettlementWhereInput, ctx: LedgerContext, dateBy: 'payment' | 'competence'): Promise<LedgerRow[]> {
  const links = await prisma.entrySettlement.findMany({
    where,
    select: {
      id: true,
      amount: true,
      transaction: { select: { id: true, date: true, bankAccount: { select: { name: true } } } },
      receivable: { select: entrySelect },
      payable: { select: entrySelect },
    },
  });
  return links.flatMap((l) => {
    const [e, direction] = l.receivable ? [l.receivable, 'RECEIVABLE' as const] : [l.payable!, 'PAYABLE' as const];
    const due = totalDue(e);
    if (due.isZero()) return [];
    const sign = direction === 'RECEIVABLE' ? 1 : -1;
    return entryRows(e, direction, ctx, D(l.amount).div(due), {
      group: `s${l.id}`,
      date: dateBy === 'competence' ? e.issueDate : l.transaction.date,
      groupTotal: D(l.amount).times(sign),
      realized: true,
      transactionId: l.transaction.id,
      paidAt: l.transaction.date,
      bankAccountName: l.transaction.bankAccount.name,
      isOverdue: false,
    });
  });
}

export interface LedgerQuery {
  companyId: string;
  basis: Basis;
  from: Date;
  to: Date;
  /** Só no caixa: filtrar o realizado pela data do pagamento (padrão) ou pela competência */
  dateBy?: 'payment' | 'competence';
  costCenterId?: string;
  bankAccountId?: string;
}

/** Linhas do razão no período, conforme o regime */
export async function ledgerRows(q: LedgerQuery, ctx?: LedgerContext): Promise<LedgerRow[]> {
  const context = ctx ?? (await ledgerContext(q.companyId));
  const period = { gte: q.from, lte: q.to };
  const reconciled = { companyId: q.companyId, bankAccountId: q.bankAccountId, reconciliationStatus: 'RECONCILED' as const };
  let rows: LedgerRow[];

  if (q.basis === 'CASH') {
    const byCompetence = q.dateBy === 'competence';
    const [direct, settled] = await Promise.all([
      directRows({ ...reconciled, date: period }),
      settlementRows(
        byCompetence
          ? { transaction: reconciled, OR: [{ receivable: { issueDate: period } }, { payable: { issueDate: period } }] }
          : { transaction: { ...reconciled, date: period } },
        context,
        byCompetence ? 'competence' : 'payment',
      ),
    ]);
    rows = [...direct, ...settled];
  } else {
    const where = { companyId: q.companyId, issueDate: period, status: { notIn: ['LOST' as const, 'CANCELLED' as const] } };
    const today = startOfTodayUtc();
    const [receivables, payables, direct] = await Promise.all([
      prisma.receivable.findMany({ where, select: entrySelect }),
      prisma.payable.findMany({ where, select: entrySelect }),
      directRows({ ...reconciled, date: period, origin: { not: 'SETTLEMENT' } }),
    ]);
    const full = (e: EntryRecord, direction: EntryDirection) =>
      entryRows(e, direction, context, D(1), {
        group: `e${e.id}`,
        date: e.issueDate,
        groupTotal: totalDue(e).times(direction === 'RECEIVABLE' ? 1 : -1),
        realized: e.status === 'PAID',
        transactionId: null,
        paidAt: e.settledAt,
        bankAccountName: null,
        isOverdue: e.status === 'PENDING' && openAmount(e).gt(0) && e.dueDate < today,
      });
    rows = [...receivables.flatMap((e) => full(e, 'RECEIVABLE')), ...payables.flatMap((e) => full(e, 'PAYABLE')), ...direct];
  }
  return q.costCenterId ? rows.filter((r) => r.costCenterId === q.costCenterId) : rows;
}

/**
 * Contas em aberto (a receber / a pagar), uma linha por categoria/centro de custo,
 * com o valor em aberto repartido na proporção da composição.
 */
export async function openEntryRows(companyId: string, direction: EntryDirection, from: Date | undefined, to: Date | undefined, dateBy: 'due' | 'competence', ctx?: LedgerContext) {
  const context = ctx ?? (await ledgerContext(companyId));
  const period = from || to ? { gte: from, lte: to } : undefined;
  const delegate = (direction === 'RECEIVABLE' ? prisma.receivable : prisma.payable) as unknown as typeof prisma.receivable;
  const list = await delegate.findMany({
    where: { companyId, status: 'PENDING', ...(dateBy === 'due' ? { dueDate: period } : { issueDate: period }) },
    select: entrySelect,
  });
  const today = startOfTodayUtc();
  const sign = direction === 'RECEIVABLE' ? 1 : -1;
  return list.flatMap((e) => {
    const open = openAmount(e);
    const due = totalDue(e);
    if (!open.gt(0) || due.isZero()) return [];
    return entryRows(e, direction, context, open.div(due), {
      group: `e${e.id}`,
      date: dateBy === 'due' ? e.dueDate : e.issueDate,
      groupTotal: open.times(sign),
      realized: false,
      transactionId: null,
      paidAt: null,
      bankAccountName: null,
      isOverdue: e.dueDate < today,
    });
  });
}
