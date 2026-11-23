import { Prisma, type EntryDirection, type Receivable, type RecurrenceFrequency } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { type SplitLine, scaleSplits } from './splits.js';

/**
 * Contas a receber (Receivable) e a pagar (Payable) têm as mesmas colunas;
 * este serviço trata as duas pela "direção".
 */

type Db = Prisma.TransactionClient;
export type Entry = Receivable; // mesmo formato de Payable
type EntryDelegate = Db['receivable'];

export const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);

export function entries(db: Db | typeof prisma, direction: EntryDirection): EntryDelegate {
  return (direction === 'RECEIVABLE' ? db.receivable : db.payable) as unknown as EntryDelegate;
}

/** Filtro de EntrySettlement pelo lançamento (receivableId / payableId) */
export const settlementRef = (direction: EntryDirection, id: string) => (direction === 'RECEIVABLE' ? { receivableId: id } : { payableId: id });

export const settlementType = (direction: EntryDirection) => (direction === 'RECEIVABLE' ? 'CREDIT' : 'DEBIT');

export type MoneyFields = Pick<Entry, 'amount' | 'interestFine' | 'discount' | 'cardFee' | 'otherFees' | 'settledAmount'>;

/** Tarifas (cartão + demais): no recebimento reduzem o que entra; no pagamento aumentam o que sai. Sempre despesa. */
export const feeSign = (direction: EntryDirection) => (direction === 'RECEIVABLE' ? -1 : 1);

/**
 * Total devido = valor + juros/multa − desconto ∓ tarifas
 * (recebimento: − tarifa de cartão − demais tarifas; pagamento: + tarifas)
 */
export const totalDue = (e: Omit<MoneyFields, 'settledAmount'>, direction: EntryDirection) =>
  D(e.amount)
    .plus(e.interestFine)
    .minus(e.discount)
    .plus(D(e.cardFee).plus(e.otherFees).times(feeSign(direction)));

/** Em aberto = total devido − já baixado (nunca negativo) */
export function openAmount(e: MoneyFields, direction: EntryDirection) {
  const open = totalDue(e, direction).minus(e.settledAmount);
  return open.isNegative() ? D(0) : open;
}

export const startOfTodayUtc = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};

/** Descrição com a parcela: "Aluguel - 2/12" (recorrência sem fim mostra só a descrição) */
export const displayDescription = (e: Pick<Entry, 'description' | 'installmentNumber' | 'installmentTotal'>) =>
  e.installmentNumber && e.installmentTotal ? `${e.description} - ${e.installmentNumber}/${e.installmentTotal}` : e.description;

// ----------------------------------------------------------------------------
// Datas de recorrência
// ----------------------------------------------------------------------------

const MONTHS_STEP: Partial<Record<RecurrenceFrequency, number>> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

/** Data da n-ésima ocorrência (0 = primeira). Meses preservam o dia, limitado ao fim do mês (31/01 -> 28/02). */
export function occurrenceDate(start: Date, frequency: RecurrenceFrequency, index: number): Date {
  const months = MONTHS_STEP[frequency];
  if (months) {
    const y = start.getUTCFullYear();
    const m = start.getUTCMonth() + months * index;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay)));
  }
  const days = frequency === 'WEEKLY' ? 7 : 14;
  return new Date(start.getTime() + index * days * 86_400_000);
}

/** Divide um total em N parcelas em centavos; a diferença de arredondamento fica na 1ª */
export function splitInstallments(total: Prisma.Decimal, count: number): Prisma.Decimal[] {
  const cents = total.times(100).toDecimalPlaces(0).toNumber();
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => D(i === 0 ? cents - base * (count - 1) : base).div(100));
}


/**
 * Garante que recorrências ativas sem fim tenham ocorrências geradas até o horizonte.
 * Chamado na leitura das listas (sem necessidade de job agendado).
 */
export async function extendRecurrences(companyId: string, direction: EntryDirection) {
  const recurrences = await prisma.recurrence.findMany({
    where: { companyId, direction, status: 'ACTIVE', occurrences: null },
    include: { splits: { orderBy: { orderIndex: 'asc' } } },
  });
  if (!recurrences.length) return;

  // Meses à frente definidos em Configurações > Avançado ("meses para provisionamento")
  const { provisioningMonths } = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { provisioningMonths: true } });
  const today = startOfTodayUtc();
  const horizon = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + provisioningMonths, today.getUTCDate()));

  for (const r of recurrences) {
    const last = await entries(prisma, direction).findFirst({
      where: { recurrenceId: r.id },
      orderBy: { installmentNumber: 'desc' },
      select: { installmentNumber: true },
    });
    const rows: Prisma.ReceivableCreateManyInput[] = [];
    for (let i = last?.installmentNumber ?? 0; ; i++) {
      const dueDate = occurrenceDate(r.startDate, r.frequency, i);
      if (dueDate > horizon || rows.length > 400) break;
      rows.push(occurrenceRow(r, i + 1, null, dueDate, D(r.amount)));
    }
    if (rows.length) await prisma.$transaction((db) => createOccurrences(db, direction, rows, r.splits));
  }
}

/** Cria as ocorrências e copia o rateio da recorrência (reescalado para o valor de cada uma) */
export async function createOccurrences(db: Db, direction: EntryDirection, rows: Prisma.ReceivableCreateManyInput[], template: SplitLine[]) {
  if (!template.length) {
    await entries(db, direction).createMany({ data: rows });
    return;
  }
  const created = await entries(db, direction).createManyAndReturn({ data: rows, select: { id: true, companyId: true, amount: true } });
  const owner = direction === 'RECEIVABLE' ? 'receivableId' : 'payableId';
  await db.entrySplit.createMany({
    data: created.flatMap((e) =>
      scaleSplits(template, e.amount).map((l, orderIndex) => ({ companyId: e.companyId, [owner]: e.id, categoryId: l.categoryId, costCenterId: l.costCenterId, amount: l.amount, orderIndex })),
    ),
  });
}

export function occurrenceRow(
  r: { id: string; companyId: string; contactId: string | null; categoryId: string | null; costCenterId: string | null; description: string; documentNumber: string | null },
  number: number,
  total: number | null,
  dueDate: Date,
  amount: Prisma.Decimal,
  extra: Partial<Prisma.ReceivableCreateManyInput> = {},
): Prisma.ReceivableCreateManyInput {
  return {
    companyId: r.companyId,
    recurrenceId: r.id,
    installmentNumber: number,
    installmentTotal: total,
    contactId: r.contactId,
    categoryId: r.categoryId,
    costCenterId: r.costCenterId,
    description: r.description,
    documentNumber: r.documentNumber,
    dueDate,
    issueDate: dueDate,
    amount,
    ...extra,
  };
}

// ----------------------------------------------------------------------------
// Baixa (recebimento / pagamento) e estorno
// ----------------------------------------------------------------------------

export async function assertSettlementAccount(db: Db, companyId: string, bankAccountId: string, date: Date) {
  const account = await db.bankAccount.findFirst({ where: { id: bankAccountId, companyId, isActive: true } });
  if (!account) throw new HttpError(400, 'Selecione uma conta válida', { fields: ['bankAccountId'] });
  if (date < account.initialBalanceDate) {
    throw new HttpError(400, `A data é anterior ao início do controle da conta ${account.name} (${account.initialBalanceDate.toISOString().slice(0, 10).split('-').reverse().join('/')})`, {
      fields: ['date'],
    });
  }
  return account;
}

/**
 * Registra a baixa sem extrato (recebido/pago "no sistema"): cria o lançamento na conta, já categorizado,
 * e o vincula à conta a pagar/receber. Quando o OFX chegar, a importação casa a linha com este lançamento.
 */
export async function settleEntry(
  db: Db,
  direction: EntryDirection,
  entry: Entry,
  { amount, date, bankAccountId, userId }: { amount: Prisma.Decimal; date: Date; bankAccountId: string; userId: string },
) {
  assertSettleable(entry);
  if (!amount.gt(0)) throw new HttpError(400, 'O valor da baixa deve ser maior que zero');

  const tx = await db.transaction.create({
    data: {
      companyId: entry.companyId,
      bankAccountId,
      type: settlementType(direction),
      amount,
      date,
      description: displayDescription(entry),
      checknum: entry.documentNumber,
      categoryId: entry.categoryId,
      contactId: entry.contactId,
      costCenterId: entry.costCenterId,
      reconciliationStatus: 'RECONCILED',
      reconciledAt: new Date(),
      reconciledByUserId: userId,
      origin: 'SETTLEMENT',
    },
  });
  const [allocation] = allocate([{ direction, entry }], amount, 'PARTIAL');
  return applyAllocation(db, tx.id, allocation);
}

function assertSettleable(entry: Entry) {
  if (entry.status === 'PAID') throw new HttpError(409, `"${displayDescription(entry)}" já está quitado`);
  if (entry.status === 'LOST' || entry.status === 'CANCELLED') throw new HttpError(409, `"${displayDescription(entry)}" está marcado como perda`);
}

// ----------------------------------------------------------------------------
// Alocação de uma linha do extrato entre lançamentos
// ----------------------------------------------------------------------------

/** Como tratar a diferença quando a linha é MENOR que o total em aberto */
export type DifferenceMode = 'ADJUST' | 'PARTIAL';

/** Motivo da diferença entre o agendado e o que passou no banco (campo do lançamento que recebe o ajuste) */
export type DifferenceReason = 'INTEREST' | 'DISCOUNT' | 'CARD_FEE' | 'OTHER_FEES';

const REASON_FIELD = { INTEREST: 'interestFine', DISCOUNT: 'discount', CARD_FEE: 'cardFee', OTHER_FEES: 'otherFees' } as const;
const REASON_CATEGORY = { INTEREST: 'interestCategoryId', DISCOUNT: 'discountCategoryId', CARD_FEE: 'cardFeeCategoryId', OTHER_FEES: 'otherFeesCategoryId' } as const;

/**
 * Motivos possíveis para cada caso (valor positivo do ajuste):
 * - recebimento, banco MAIOR: juros/multa · banco MENOR: desconto, tarifa de cartão ou demais tarifas
 * - pagamento,   banco MAIOR: juros/multa, tarifa de cartão ou demais tarifas · banco MENOR: desconto
 */
export function differenceReasonFor(direction: EntryDirection, excess: boolean, wanted?: DifferenceReason | null): DifferenceReason {
  const allowed: DifferenceReason[] =
    direction === 'RECEIVABLE' ? (excess ? ['INTEREST'] : ['DISCOUNT', 'CARD_FEE', 'OTHER_FEES']) : excess ? ['INTEREST', 'CARD_FEE', 'OTHER_FEES'] : ['DISCOUNT'];
  return wanted && allowed.includes(wanted) ? wanted : allowed[0];
}

export interface Allocation {
  direction: EntryDirection;
  entry: Entry;
  amount: Prisma.Decimal; // parte da linha alocada ao lançamento
  /** Ajuste para fechar a diferença (positivo) e o motivo */
  adjust: Prisma.Decimal;
  reason: DifferenceReason | null;
}

/**
 * Reparte `total` entre os lançamentos (na ordem recebida, normalmente por vencimento):
 * - total >= soma em aberto: quita todos; o excedente vira juros/multa do último
 * - total <  soma em aberto: ADJUST quita todos com desconto (a partir do último);
 *                            PARTIAL quita na ordem até o dinheiro acabar (o último pode ficar parcial)
 */
export function allocate(
  items: { direction: EntryDirection; entry: Entry }[],
  total: Prisma.Decimal,
  mode: DifferenceMode,
  wantedReason?: DifferenceReason | null,
): Allocation[] {
  const opens = items.map((i) => openAmount(i.entry, i.direction));
  const sumOpen = opens.reduce((s, v) => s.plus(v), D(0));
  const result: Allocation[] = items.map((i, idx) => ({ ...i, amount: opens[idx], adjust: D(0), reason: null }));

  if (total.gte(sumOpen)) {
    const excess = total.minus(sumOpen);
    if (excess.gt(0)) {
      const last = result[result.length - 1];
      last.adjust = excess;
      last.reason = differenceReasonFor(last.direction, true, wantedReason);
      last.amount = last.amount.plus(excess);
    }
    return result;
  }

  if (mode === 'ADJUST') {
    let shortfall = sumOpen.minus(total);
    for (let i = result.length - 1; i >= 0 && shortfall.gt(0); i--) {
      const d = Prisma.Decimal.min(shortfall, result[i].amount);
      result[i].adjust = d;
      result[i].reason = differenceReasonFor(result[i].direction, false, wantedReason);
      result[i].amount = result[i].amount.minus(d);
      shortfall = shortfall.minus(d);
    }
    return result;
  }

  let remaining = total;
  for (const r of result) {
    r.amount = Prisma.Decimal.min(r.amount, remaining);
    remaining = remaining.minus(r.amount);
  }
  return result;
}

/**
 * Grava a alocação: ajusta juros/desconto, cria o vínculo e recalcula o lançamento.
 * `differenceCategoryId` classifica a diferença (ex.: "Taxas de cartão" no lugar de "Descontos concedidos").
 */
export async function applyAllocation(db: Db, transactionId: string, a: Allocation, differenceCategoryId?: string | null) {
  if (a.reason && a.adjust.gt(0)) {
    const field = REASON_FIELD[a.reason];
    await entries(db, a.direction).update({
      where: { id: a.entry.id },
      data: {
        [field]: D(a.entry[field]).plus(a.adjust),
        ...(differenceCategoryId && { [REASON_CATEGORY[a.reason]]: differenceCategoryId }),
      },
    });
  }
  if (a.amount.gt(0)) {
    await db.entrySettlement.create({
      data: { companyId: a.entry.companyId, transactionId, amount: a.amount, ...settlementRef(a.direction, a.entry.id) },
    });
  }
  return recomputeEntry(db, a.direction, a.entry.id);
}

/**
 * Concilia uma linha do extrato com um ou mais lançamentos em aberto (mesma direção).
 * A linha recebe a classificação do lançamento de maior valor e fica RECONCILED.
 */
export async function matchTransaction(
  db: Db,
  tx: { id: string; companyId: string; type: 'CREDIT' | 'DEBIT'; amount: Prisma.Decimal.Value },
  items: { direction: EntryDirection; entry: Entry }[],
  mode: DifferenceMode,
  userId: string,
  differenceCategoryId?: string | null,
  differenceReason?: DifferenceReason | null,
) {
  for (const i of items) {
    assertSettleable(i.entry);
    if (settlementType(i.direction) !== tx.type) {
      throw new HttpError(400, tx.type === 'CREDIT' ? 'Uma entrada só pode conciliar contas a receber' : 'Uma saída só pode conciliar contas a pagar');
    }
  }
  const allocations = allocate(items, D(tx.amount), mode, differenceReason);
  for (const a of allocations) await applyAllocation(db, tx.id, a, differenceCategoryId);
  // Quem classifica a linha passa a ser o(s) lançamento(s); um rateio feito direto na linha deixa de valer
  await db.entrySplit.deleteMany({ where: { transactionId: tx.id } });

  const main = [...allocations].sort((a, b) => b.amount.comparedTo(a.amount))[0].entry;
  const sameContact = items.every((i) => i.entry.contactId === main.contactId);
  return db.transaction.update({
    where: { id: tx.id },
    data: {
      categoryId: main.categoryId,
      contactId: sameContact ? main.contactId : null,
      costCenterId: main.costCenterId,
      customDescription: items.length === 1 ? displayDescription(main) : `${items.length} lançamentos: ${items.map((i) => displayDescription(i.entry)).join(', ')}`.slice(0, 250),
      reconciliationStatus: 'RECONCILED',
      reconciledAt: new Date(),
      reconciledByUserId: userId,
    },
  });
}

/** Recalcula o baixado/status a partir dos vínculos (após baixa, estorno ou desfazer conciliação) */
export async function recomputeEntry(db: Db, direction: EntryDirection, id: string) {
  const entry = await entries(db, direction).findUniqueOrThrow({ where: { id } });
  const links = await db.entrySettlement.findMany({
    where: { ...settlementRef(direction, id), transaction: { reconciliationStatus: { not: 'IGNORED' } } },
    select: { amount: true, transaction: { select: { date: true } } },
  });
  const settledAmount = links.reduce((s, l) => s.plus(l.amount), D(0));
  const settledAt = links.reduce<Date | null>((max, l) => (!max || l.transaction.date > max ? l.transaction.date : max), null);
  const remaining = openAmount({ ...entry, settledAmount }, direction);
  const keepStatus = entry.status === 'LOST' || entry.status === 'CANCELLED';
  return entries(db, direction).update({
    where: { id },
    data: {
      settledAmount,
      settledAt,
      status: keepStatus ? entry.status : remaining.gt(0) || settledAmount.isZero() ? 'PENDING' : 'PAID',
    },
  });
}

/** Recalcula todos os lançamentos vinculados a estas transações (antes de apagá-las ou ignorá-las) */
export async function linkedEntries(db: Db, transactionIds: string[]) {
  const links = await db.entrySettlement.findMany({
    where: { transactionId: { in: transactionIds } },
    select: { receivableId: true, payableId: true },
  });
  const unique = new Map<string, { direction: EntryDirection; id: string }>();
  for (const l of links) {
    if (l.receivableId) unique.set(l.receivableId, { direction: 'RECEIVABLE', id: l.receivableId });
    if (l.payableId) unique.set(l.payableId, { direction: 'PAYABLE', id: l.payableId });
  }
  return [...unique.values()];
}
