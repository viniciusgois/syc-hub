import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type EntryDirection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError, companyIdOf, idParam, notFound, pagination } from '../lib/http.js';
import { currentUser, userIdOf } from '../middleware/currentUser.js';
import { assertRefsBelongToCompany } from '../services/ownership.js';
import { recalculateBalance, recalculateBalances } from '../services/balance.js';
import { type Entry, displayDescription, entries, linkedEntries, matchTransaction, recomputeEntry } from '../services/entries.js';
import { entryCandidates, suggestEntryMatches } from '../services/matching.js';
import { type SplitLine, mainLine, replaceSplits, resolveSplits, splitInclude, splitsSchema } from '../services/splits.js';
import { TRANSFER_WINDOW_MS, createTransfer, undoTransfer } from '../services/transfers.js';

export const transactionsRouter = Router({ mergeParams: true });

const statusEnum = z.enum(['PENDING', 'SUGGESTED', 'RECONCILED', 'IGNORED']);
const optionalId = z.uuid().nullable().optional();

const listQuery = pagination.extend({
  bankAccountId: z.uuid().optional(),
  status: z
    .string()
    .transform((s) => s.split(','))
    .pipe(z.array(statusEnum))
    .optional(),
  categoryId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  type: z.enum(['CREDIT', 'DEBIT']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().optional(),
  importBatchId: z.uuid().optional(),
  min: z.coerce.number().nonnegative().optional(),
  max: z.coerce.number().nonnegative().optional(),
  order: z.enum(['date_desc', 'date_asc', 'amount_desc']).default('date_desc'),
});

const ORDER: Record<z.infer<typeof listQuery>['order'], Prisma.TransactionOrderByWithRelationInput[]> = {
  date_desc: [{ date: 'desc' }, { createdAt: 'desc' }],
  date_asc: [{ date: 'asc' }, { createdAt: 'asc' }],
  amount_desc: [{ amount: 'desc' }, { date: 'asc' }],
};

/**
 * Palpites para linhas em aberto: a classificação da última linha conciliada com a mesma descrição
 * (categoria, contato e centro de custo), como o Nibo faz com o histórico.
 */
async function historyGuesses(companyId: string, lines: { description: string }[]) {
  const descriptions = [...new Set(lines.map((l) => l.description))];
  if (!descriptions.length) return new Map<string, { categoryId: string; contactId: string | null; costCenterId: string | null }>();
  const past = await prisma.transaction.findMany({
    where: { companyId, description: { in: descriptions }, reconciliationStatus: 'RECONCILED', isTransfer: false, categoryId: { not: null }, splits: { none: {} } },
    orderBy: { date: 'desc' },
    distinct: ['description'],
    select: { description: true, categoryId: true, contactId: true, costCenterId: true },
  });
  return new Map(past.map((p) => [p.description, { categoryId: p.categoryId!, contactId: p.contactId, costCenterId: p.costCenterId }]));
}

/** Linha em aberto de outra conta, em sentido oposto e mesmo valor, até 3 dias de diferença: provável transferência */
async function transferSuggestions(companyId: string, lines: { id: string; bankAccountId: string; type: 'CREDIT' | 'DEBIT'; amount: Prisma.Decimal; date: Date }[]) {
  const result = new Map<string, { transactionId: string; bankAccountId: string; accountName: string; date: Date; description: string }>();
  if (!lines.length) return result;
  const dates = lines.map((l) => l.date.getTime());
  const others = await prisma.transaction.findMany({
    where: {
      companyId,
      reconciliationStatus: { in: ['PENDING', 'SUGGESTED'] },
      settlements: { none: {} },
      amount: { in: [...new Set(lines.map((l) => l.amount.toString()))].map((v) => new Prisma.Decimal(v)) },
      date: { gte: new Date(Math.min(...dates) - TRANSFER_WINDOW_MS), lte: new Date(Math.max(...dates) + TRANSFER_WINDOW_MS) },
    },
    select: { id: true, bankAccountId: true, type: true, amount: true, date: true, description: true, bankAccount: { select: { name: true } } },
  });
  for (const l of lines) {
    const best = others
      .filter((o) => o.bankAccountId !== l.bankAccountId && o.type !== l.type && l.amount.eq(o.amount) && Math.abs(o.date.getTime() - l.date.getTime()) <= TRANSFER_WINDOW_MS)
      .sort((a, b) => Math.abs(a.date.getTime() - l.date.getTime()) - Math.abs(b.date.getTime() - l.date.getTime()))[0];
    if (best) result.set(l.id, { transactionId: best.id, bankAccountId: best.bankAccountId, accountName: best.bankAccount.name, date: best.date, description: best.description });
  }
  return result;
}

const classificationSchema = z.object({
  categoryId: optionalId,
  contactId: optionalId,
  costCenterId: optionalId,
  customDescription: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  splits: splitsSchema.nullish(), // rateio da linha (null remove)
});

const manualSchema = classificationSchema.omit({ splits: true }).extend({
  bankAccountId: z.uuid(),
  type: z.enum(['CREDIT', 'DEBIT']),
  amount: z.number().positive(),
  date: z.coerce.date(),
  description: z.string().min(1),
  checknum: z.string().optional(),
});

async function findOwned(companyId: string, id: string) {
  const tx = await prisma.transaction.findFirst({ where: { id, companyId } });
  if (!tx) throw notFound('Transação');
  return tx;
}

/**
 * Resolve o rateio pedido para a linha. Devolve as linhas a gravar (lista vazia = remover) ou
 * undefined (não mexer). Com rateio, a categoria/centro de custo "de capa" vira o da maior linha.
 */
async function splitsFor(
  companyId: string,
  tx: { id: string; type: 'CREDIT' | 'DEBIT'; amount: Prisma.Decimal },
  input: z.infer<typeof classificationSchema>['splits'],
  data: { categoryId?: string | null; costCenterId?: string | null },
): Promise<SplitLine[] | undefined> {
  if (input === undefined) return data.categoryId !== undefined ? [] : undefined; // trocar a categoria desfaz o rateio
  if (input === null || !input.length) return [];
  if (await prisma.entrySettlement.count({ where: { transactionId: tx.id } })) {
    throw new HttpError(400, 'Esta linha quita contas a pagar/receber; faça o rateio no lançamento');
  }
  const lines = await resolveSplits(prisma, companyId, tx.type === 'CREDIT' ? 'INCOME' : 'EXPENSE', tx.amount, input);
  const main = mainLine(lines);
  data.categoryId = main.categoryId;
  data.costCenterId = main.costCenterId;
  return lines;
}

transactionsRouter.get('/', async (req, res) => {
  const q = listQuery.parse(req.query);
  const where: Prisma.TransactionWhereInput = {
    companyId: companyIdOf(req),
    bankAccountId: q.bankAccountId,
    reconciliationStatus: q.status ? { in: q.status } : undefined,
    categoryId: q.categoryId,
    contactId: q.contactId,
    type: q.type,
    importBatchId: q.importBatchId,
    date: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    amount: q.min !== undefined || q.max !== undefined ? { gte: q.min, lte: q.max } : undefined,
    ...(q.search && {
      OR: [
        { description: { contains: q.search, mode: 'insensitive' } },
        { customDescription: { contains: q.search, mode: 'insensitive' } },
        { contact: { is: { name: { contains: q.search, mode: 'insensitive' } } } },
        { checknum: { contains: q.search, mode: 'insensitive' } },
      ],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: ORDER[q.order],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        category: { select: { id: true, name: true, code: true, section: true, color: true } },
        contact: { select: { id: true, name: true } },
        rule: { select: { id: true, name: true } },
        splits: splitInclude,
        settlements: { select: { id: true, amount: true, receivable: { select: { id: true, description: true, installmentNumber: true, installmentTotal: true } }, payable: { select: { id: true, description: true, installmentNumber: true, installmentTotal: true } } } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);
  // Sugestão de conciliação com contas em aberto (só para linhas ainda sem vínculo e não conciliadas)
  const open = data.filter((t) => t.reconciliationStatus !== 'RECONCILED' && t.reconciliationStatus !== 'IGNORED' && !t.settlements.length);
  const [suggestions, guesses, transfers] = await Promise.all([
    suggestEntryMatches(
      companyIdOf(req),
      open.map((t) => ({ key: t.id, type: t.type, amount: t.amount, date: t.date })),
    ),
    historyGuesses(companyIdOf(req), open),
    transferSuggestions(companyIdOf(req), open),
  ]);
  res.json({
    data: data.map(({ settlements, ...t }) => ({
      ...t,
      entryLinks: settlements.map((l) => {
        const e = l.receivable ?? l.payable!;
        return { settlementId: l.id, direction: l.receivable ? 'RECEIVABLE' : 'PAYABLE', id: e.id, description: displayDescription(e), amount: l.amount };
      }),
      matchSuggestion: suggestions.get(t.id) ?? null,
      guess: guesses.get(t.description) ?? null,
      transferSuggestion: transfers.get(t.id) ?? null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});

transactionsRouter.get('/:id', async (req, res) => {
  res.json(await findOwned(companyIdOf(req), idParam(req)));
});

/** Lançamento manual (caixa / espécie) */
transactionsRouter.post('/', currentUser, async (req, res) => {
  const companyId = companyIdOf(req);
  const data = manualSchema.parse(req.body);
  await assertRefsBelongToCompany(companyId, data);

  const tx = await prisma.$transaction(async (db) => {
    const created = await db.transaction.create({
      data: {
        ...data,
        companyId,
        origin: 'MANUAL_CASH',
        // Com categoria informada, o lançamento manual já nasce conciliado
        ...(data.categoryId && {
          reconciliationStatus: 'RECONCILED',
          reconciledAt: new Date(),
          reconciledByUserId: userIdOf(res),
        }),
      },
    });
    await recalculateBalance(db, data.bankAccountId);
    return created;
  });
  res.status(201).json(tx);
});

/** Edição da classificação sem alterar o status de conciliação */
transactionsRouter.patch('/:id', async (req, res) => {
  const companyId = companyIdOf(req);
  const { splits: splitsInput, ...data } = classificationSchema.parse(req.body);
  const tx = await findOwned(companyId, idParam(req));
  await assertRefsBelongToCompany(companyId, data);
  const lines = await splitsFor(companyId, tx, splitsInput, data);
  const updated = await prisma.$transaction(async (db) => {
    if (lines) await replaceSplits(db, companyId, { transactionId: tx.id }, lines);
    return db.transaction.update({ where: { id: tx.id }, data });
  });
  res.json(updated);
});

/** Conciliar: aplica a classificação (ou aceita a sugestão) e marca como RECONCILED */
transactionsRouter.post('/:id/reconcile', currentUser, async (req, res) => {
  const companyId = companyIdOf(req);
  const { splits: splitsInput, ...data } = classificationSchema.parse(req.body ?? {});
  const tx = await findOwned(companyId, idParam(req));
  await assertRefsBelongToCompany(companyId, data);
  if (tx.isTransfer) throw new HttpError(400, 'Esta linha é uma transferência; desfaça a transferência antes');
  const lines = await splitsFor(companyId, tx, splitsInput, data);

  if (!(data.categoryId ?? tx.categoryId)) throw new HttpError(400, 'Informe a categoria para conciliar');

  const updated = await prisma.$transaction(async (db) => {
    if (lines) await replaceSplits(db, companyId, { transactionId: tx.id }, lines);
    const result = await db.transaction.update({
      where: { id: tx.id },
      data: { ...data, reconciliationStatus: 'RECONCILED', reconciledAt: new Date(), reconciledByUserId: userIdOf(res) },
    });
    await recalculateBalance(db, tx.bankAccountId);
    return result;
  });
  res.json(updated);
});

/** Conciliação em lote: aceita sugestões ou aplica a mesma classificação a várias transações */
transactionsRouter.post('/reconcile-bulk', currentUser, async (req, res) => {
  const companyId = companyIdOf(req);
  const { ids, ...data } = classificationSchema.omit({ splits: true }).extend({ ids: z.array(z.uuid()).min(1).max(1000) }).parse(req.body);
  await assertRefsBelongToCompany(companyId, data);

  const targets = await prisma.transaction.findMany({
    where: { id: { in: ids }, companyId, isTransfer: false },
    select: { id: true, categoryId: true, bankAccountId: true },
  });
  const withoutCategory = targets.filter((t) => !(data.categoryId ?? t.categoryId)).map((t) => t.id);
  if (withoutCategory.length) throw new HttpError(400, 'Transações sem categoria', { ids: withoutCategory });

  const result = await prisma.$transaction(async (db) => {
    // Uma categoria única aplicada em lote substitui rateios feitos nas linhas
    if (data.categoryId) await db.entrySplit.deleteMany({ where: { transactionId: { in: targets.map((t) => t.id) } } });
    const updated = await db.transaction.updateMany({
      where: { id: { in: targets.map((t) => t.id) }, companyId, reconciliationStatus: { not: 'IGNORED' } },
      data: { ...data, reconciliationStatus: 'RECONCILED', reconciledAt: new Date(), reconciledByUserId: userIdOf(res) },
    });
    await recalculateBalances(db, targets.map((t) => t.bankAccountId));
    return updated;
  });
  res.json({ reconciled: result.count, notFound: ids.length - targets.length });
});

/** Desfaz a conciliação (volta para PENDING mantendo a classificação) */
transactionsRouter.post('/:id/unreconcile', async (req, res) => {
  const tx = await findOwned(companyIdOf(req), idParam(req));
  if (tx.origin === 'SETTLEMENT') throw new HttpError(400, 'Este lançamento é a baixa de uma conta a pagar/receber; estorne a baixa por lá');
  if (tx.isTransfer) {
    res.json(await prisma.$transaction((db) => undoTransfer(db, tx.companyId, tx.id)));
    return;
  }
  const updated = await prisma.$transaction(async (db) => {
    const affected = await linkedEntries(db, [tx.id]);
    await db.entrySettlement.deleteMany({ where: { transactionId: tx.id } });
    for (const e of affected) await recomputeEntry(db, e.direction, e.id);
    const result = await db.transaction.update({
      where: { id: tx.id },
      data: {
        reconciliationStatus: 'PENDING',
        reconciledAt: null,
        reconciledByUserId: null,
        ...(affected.length && { customDescription: null }),
      },
    });
    await recalculateBalance(db, tx.bankAccountId);
    return result;
  });
  res.json(updated);
});

const matchSchema = z.object({
  entries: z.array(z.object({ direction: z.enum(['RECEIVABLE', 'PAYABLE']), id: z.uuid() })).min(1, 'Selecione ao menos um lançamento').max(100),
  mode: z.enum(['ADJUST', 'PARTIAL']).default('ADJUST'),
  differenceCategoryId: z.uuid().nullish(), // categoria da diferença (desconto/taxa ou juros)
});

/**
 * Concilia a linha do extrato com contas a pagar/receber em aberto (uma ou várias).
 * Diferença de valor: excedente vira juros; falta vira desconto (ADJUST) ou deixa saldo em aberto (PARTIAL).
 */
transactionsRouter.post('/:id/match', currentUser, async (req, res) => {
  const companyId = companyIdOf(req);
  const tx = await findOwned(companyId, idParam(req));
  if (tx.reconciliationStatus === 'IGNORED') throw new HttpError(400, 'Linha ignorada não pode ser conciliada');
  if (tx.isTransfer) throw new HttpError(400, 'Esta linha é uma transferência; desfaça a transferência antes');
  if (tx.origin === 'SETTLEMENT') throw new HttpError(400, 'Este lançamento já é uma baixa');
  if (await prisma.entrySettlement.count({ where: { transactionId: tx.id } })) {
    throw new HttpError(409, 'Esta linha já está conciliada com contas; desfaça a conciliação para refazer');
  }
  const { entries: refs, mode, differenceCategoryId } = matchSchema.parse(req.body);
  if (differenceCategoryId) {
    const c = await prisma.category.findFirst({ where: { id: differenceCategoryId, companyId, isGroup: false, section: { not: null } } });
    if (!c) throw new HttpError(400, 'Categoria da diferença inválida');
  }

  const items: { direction: EntryDirection; entry: Entry }[] = [];
  for (const ref of refs) {
    const entry = await entries(prisma, ref.direction).findFirst({ where: { id: ref.id, companyId } });
    if (!entry) throw notFound(ref.direction === 'RECEIVABLE' ? 'Recebimento' : 'Pagamento');
    items.push({ direction: ref.direction, entry });
  }
  // Ordem de alocação: vencimento mais antigo primeiro
  items.sort((a, b) => a.entry.dueDate.getTime() - b.entry.dueDate.getTime());

  const result = await prisma.$transaction(async (db) => {
    const matched = await matchTransaction(db, tx, items, mode, userIdOf(res), differenceCategoryId);
    await recalculateBalance(db, tx.bankAccountId);
    return matched;
  });
  res.json(result);
});

/** Lançamentos em aberto candidatos para conciliar esta linha */
transactionsRouter.get('/:id/candidates', async (req, res) => {
  const companyId = companyIdOf(req);
  const tx = await findOwned(companyId, idParam(req));
  const { search } = z.object({ search: z.string().trim().optional() }).parse(req.query);
  res.json(await entryCandidates(companyId, tx, search));
});

const transferSchema = z.object({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amount: z.number().positive().optional(),
  date: z.iso.date().transform((d) => new Date(`${d}T00:00:00.000Z`)).optional(),
  description: z.string().trim().max(250).nullish(),
  transactionId: z.uuid().nullish(),
  counterpartId: z.uuid().nullish(),
});

/** Transferência entre contas (nova, ou conciliando uma linha do extrato como transferência) */
transactionsRouter.post('/transfer', currentUser, async (req, res) => {
  const body = transferSchema.parse(req.body);
  const companyId = companyIdOf(req);
  res.status(201).json(await prisma.$transaction((db) => createTransfer(db, companyId, userIdOf(res), body)));
});

/** Ignorar: remove a transação do saldo e da DRE (ex.: duplicidade de importação) */
transactionsRouter.post('/:id/ignore', async (req, res) => {
  const tx = await findOwned(companyIdOf(req), idParam(req));
  if (await prisma.entrySettlement.count({ where: { transactionId: tx.id } })) {
    throw new HttpError(400, 'Esta linha está conciliada com uma conta a pagar/receber; desfaça a conciliação (ou estorne a baixa) antes');
  }
  if (tx.isTransfer) throw new HttpError(400, 'Esta linha é uma transferência; desfaça a transferência antes');
  const updated = await prisma.$transaction(async (db) => {
    const result = await db.transaction.update({
      where: { id: tx.id },
      data: { reconciliationStatus: 'IGNORED', reconciledAt: null, reconciledByUserId: null },
    });
    await recalculateBalance(db, tx.bankAccountId);
    return result;
  });
  res.json(updated);
});

/** Apenas lançamentos manuais podem ser excluídos; os bancários devem ser ignorados */
transactionsRouter.delete('/:id', async (req, res) => {
  const tx = await findOwned(companyIdOf(req), idParam(req));
  if (tx.origin !== 'MANUAL_CASH') throw new HttpError(400, 'Transações importadas não podem ser excluídas; use "ignorar"');
  if (tx.isTransfer) {
    await prisma.$transaction((db) => undoTransfer(db, tx.companyId, tx.id));
    res.status(204).end();
    return;
  }
  await prisma.$transaction(async (db) => {
    const affected = await linkedEntries(db, [tx.id]);
    await db.transaction.delete({ where: { id: tx.id } });
    for (const e of affected) await recomputeEntry(db, e.direction, e.id);
    await recalculateBalance(db, tx.bankAccountId);
  });
  res.status(204).end();
});
