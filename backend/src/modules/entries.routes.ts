import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type EntryDirection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError, companyIdOf, idParam, notFound } from '../lib/http.js';
import { currentUser, userIdOf } from '../middleware/currentUser.js';
import { assertRefsBelongToCompany } from '../services/ownership.js';
import { recalculateBalance } from '../services/balance.js';
import { statementCandidates } from '../services/matching.js';
import { type SplitLine, mainLine, replaceSplits, resolveSplits, scaleSplits, splitInclude, splitsSchema } from '../services/splits.js';
import {
  D,
  assertSettlementAccount,
  createOccurrences,
  displayDescription,
  entries,
  extendRecurrences,
  matchTransaction,
  settlementRef,
  settlementType,
  occurrenceDate,
  occurrenceRow,
  openAmount,
  recomputeEntry,
  settleEntry,
  splitInstallments,
  startOfTodayUtc,
  totalDue,
} from '../services/entries.js';

/** Linha do extrato ainda em aberto (sem conciliação, baixa ou transferência) */
async function statementLine(companyId: string, id: string) {
  const line = await prisma.transaction.findFirst({ where: { id, companyId }, include: { _count: { select: { settlements: true } } } });
  if (!line) throw notFound('Movimentação');
  if (line.reconciliationStatus === 'RECONCILED' || line.reconciliationStatus === 'IGNORED' || line.isTransfer || line._count.settlements) {
    throw new HttpError(409, 'Esta movimentação já foi conciliada ou descartada');
  }
  return line;
}

const LABEL: Record<EntryDirection, { entry: string; default: string }> = {
  RECEIVABLE: { entry: 'Recebimento', default: 'Recebimento' },
  PAYABLE: { entry: 'Pagamento', default: 'Pagamento' },
};

const optionalText = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullish();
const money = z.number().min(0).max(9_999_999_999);
const isoDate = z.iso.date().transform((v) => new Date(`${v}T00:00:00.000Z`));

const entryFields = {
  dueDate: isoDate,
  issueDate: isoDate.optional(), // competência
  expectedDate: isoDate.nullish(), // previsto para
  contactId: z.uuid().nullish(),
  categoryId: z.uuid({ message: 'Selecione uma categoria' }).optional(), // obrigatória sem rateio
  costCenterId: z.uuid().nullish(),
  splits: splitsSchema.nullish(), // rateio por categoria/centro de custo (null remove)
  scheduledAtBank: z.boolean().optional(), // só pagamentos: "programado no banco"
  description: optionalText,
  documentNumber: optionalText,
  notes: optionalText,
  amount: money.refine((v) => v > 0, 'Informe o valor'),
  interestFine: money.optional(),
  discount: money.optional(),
};

const createSchema = z
  .object({
    ...entryFields,
    dueDate: isoDate.optional(),
    recurrence: z
      .object({
        type: z.enum(['RECURRING', 'INSTALLMENT']),
        frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL']).default('MONTHLY'),
        occurrences: z.number().int().min(2).max(360).nullish(), // null = sem data de término
      })
      .nullish(),
    // "não agendado": já nasce baixado numa conta, ou conciliado com uma linha do extrato importado
    settlement: z.union([z.object({ bankAccountId: z.uuid(), date: isoDate }), z.object({ transactionId: z.uuid() })]).nullish(),
  })
  .superRefine((v, ctx) => {
    if (!v.categoryId && !v.splits?.length) ctx.addIssue({ code: 'custom', message: 'Selecione uma categoria', path: ['categoryId'] });
    if (!v.dueDate && !v.settlement) ctx.addIssue({ code: 'custom', message: 'Informe o vencimento', path: ['dueDate'] });
    if (v.recurrence && v.settlement) ctx.addIssue({ code: 'custom', message: 'Recorrência não pode ser baixada na criação', path: ['recurrence'] });
    if (v.recurrence?.type === 'INSTALLMENT' && !v.recurrence.occurrences) {
      ctx.addIssue({ code: 'custom', message: 'Informe a quantidade de parcelas', path: ['recurrence', 'occurrences'] });
    }
    if ((v.discount ?? 0) > v.amount + (v.interestFine ?? 0)) {
      ctx.addIssue({ code: 'custom', message: 'O desconto não pode ser maior que o valor', path: ['discount'] });
    }
  });

const updateSchema = z.object({ ...entryFields, isStarred: z.boolean() }).partial();

const listQuery = z.object({
  status: z.enum(['open', 'settled', 'lost', 'all']).default('open'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  contactId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  search: z.string().trim().optional(),
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

const settleSchema = z.object({
  bankAccountId: z.uuid({ message: 'Selecione uma conta' }),
  date: isoDate.optional(), // data padrão para os itens sem data própria
  items: z
    .array(z.object({ id: z.uuid(), amount: money.optional(), date: isoDate.optional() }))
    .min(1, 'Selecione ao menos um item')
    .max(500),
});

const listInclude = {
  contact: { select: { id: true, name: true, document: true } },
  category: { select: { id: true, name: true, code: true } },
  costCenter: { select: { id: true, name: true } },
  recurrence: { select: { id: true, type: true, frequency: true } },
  splits: splitInclude,
} as const;

function serialize<T extends Parameters<typeof openAmount>[0] & { dueDate: Date; status: string; description: string; installmentNumber: number | null; installmentTotal: number | null }>(
  e: T,
  today = startOfTodayUtc(),
) {
  const open = openAmount(e);
  return {
    ...e,
    displayDescription: displayDescription(e),
    total: totalDue(e),
    openAmount: e.status === 'LOST' || e.status === 'CANCELLED' ? D(0) : open,
    isOverdue: e.status === 'PENDING' && open.gt(0) && e.dueDate < today,
  };
}

export function entriesRouter(direction: EntryDirection) {
  const router = Router({ mergeParams: true });
  const label = LABEL[direction];
  const nature = direction === 'RECEIVABLE' ? 'INCOME' : 'EXPENSE';
  const owner = (id: string) => (direction === 'RECEIVABLE' ? { receivableId: id } : { payableId: id });

  /** "Programado no banco" só existe em pagamentos */
  function assertScheduleFlag(flag: boolean | undefined) {
    if (flag !== undefined && direction === 'RECEIVABLE') throw new HttpError(400, '"Programado no banco" é só para pagamentos');
  }

  async function findOwned(companyId: string, id: string) {
    const entry = await entries(prisma, direction).findFirst({ where: { id, companyId } });
    if (!entry) throw notFound(label.entry);
    return entry;
  }

  /** Lista com filtros + totais (em aberto / vencido) */
  router.get('/', async (req, res) => {
    const companyId = companyIdOf(req);
    const q = listQuery.parse(req.query);
    await extendRecurrences(companyId, direction);

    const statusFilter = {
      open: { status: 'PENDING' as const },
      settled: { settledAmount: { gt: 0 } },
      lost: { status: { in: ['LOST' as const, 'CANCELLED' as const] } },
      all: {},
    }[q.status];

    const rows = await entries(prisma, direction).findMany({
      where: {
        companyId,
        ...statusFilter,
        contactId: q.contactId,
        dueDate: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
        // Categoria: a "de capa" ou qualquer linha do rateio
        ...(q.categoryId && { AND: [{ OR: [{ categoryId: q.categoryId }, { splits: { some: { categoryId: q.categoryId } } }] }] }),
        ...(q.search && {
          OR: [
            { description: { contains: q.search, mode: 'insensitive' } },
            { documentNumber: { contains: q.search, mode: 'insensitive' } },
            { contact: { name: { contains: q.search, mode: 'insensitive' } } },
          ],
        }),
      },
      include: listInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      take: q.limit,
    });

    const today = startOfTodayUtc();
    const data = rows
      .map((r) => serialize(r, today))
      .filter((r) => (q.min === undefined || r.openAmount.gte(q.min)) && (q.max === undefined || r.openAmount.lte(q.max)));

    res.json({
      data,
      totals: {
        count: data.length,
        open: data.reduce((s, r) => s.plus(r.openAmount), D(0)),
        overdue: data.filter((r) => r.isOverdue).reduce((s, r) => s.plus(r.openAmount), D(0)),
      },
    });
  });

  /** Detalhe com histórico de baixas */
  router.get('/:id', async (req, res) => {
    const companyId = companyIdOf(req);
    const entry = await entries(prisma, direction).findFirst({
      where: { id: idParam(req), companyId },
      include: { ...listInclude, recurrence: { select: { id: true, type: true, frequency: true, occurrences: true, status: true } } },
    });
    if (!entry) throw notFound(label.entry);
    const links = await prisma.entrySettlement.findMany({
      where: settlementRef(direction, entry.id),
      include: {
        transaction: {
          select: { id: true, date: true, amount: true, fitid: true, origin: true, description: true, bankAccount: { select: { id: true, name: true } } },
        },
      },
    });
    const settlements = links
      .map((l) => ({
        id: l.id,
        transactionId: l.transaction.id,
        date: l.transaction.date,
        amount: l.amount,
        transactionAmount: l.transaction.amount,
        statementDescription: l.transaction.fitid ? l.transaction.description : null,
        matchedWithStatement: !!l.transaction.fitid,
        bankAccount: l.transaction.bankAccount,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    res.json({ ...serialize(entry), settlements });
  });

  /** Cria: agendado, recorrente/parcelado ou "não agendado" (já baixado) */
  router.post('/', currentUser, async (req, res) => {
    const companyId = companyIdOf(req);
    const body = createSchema.parse(req.body);
    await assertRefsBelongToCompany(companyId, { categoryId: body.categoryId, contactId: body.contactId, costCenterId: body.costCenterId });
    assertScheduleFlag(body.scheduledAtBank);

    // Rateio: valida a soma e define a categoria/centro de custo "de capa" pela maior linha
    const splits: SplitLine[] = body.splits?.length ? await resolveSplits(prisma, companyId, nature, body.amount, body.splits) : [];
    const main = splits.length ? mainLine(splits) : null;
    const categoryId = main?.categoryId ?? body.categoryId!;
    const contact = body.contactId ? await prisma.contact.findUnique({ where: { id: body.contactId }, select: { name: true } }) : null;
    const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { name: true } });
    const description = body.description ?? contact?.name ?? category?.name ?? label.default;
    // Lançamento detalhado criado na Conciliação: quita a linha do extrato em vez de gerar outra
    const line = body.settlement && 'transactionId' in body.settlement ? await statementLine(companyId, body.settlement.transactionId) : null;
    if (line && line.type !== settlementType(direction)) {
      throw new HttpError(400, line.type === 'CREDIT' ? 'Uma entrada só pode virar um recebimento' : 'Uma saída só pode virar um pagamento');
    }
    const dueDate = body.dueDate ?? line?.date ?? (body.settlement as { date: Date }).date;
    const base = {
      companyId,
      contactId: body.contactId ?? null,
      categoryId,
      costCenterId: main ? main.costCenterId : (body.costCenterId ?? null),
      description,
      documentNumber: body.documentNumber ?? null,
      notes: body.notes ?? null,
    };

    const result = await prisma.$transaction(async (db) => {
      // Recorrência / parcelamento
      if (body.recurrence) {
        const { type, frequency, occurrences } = body.recurrence;
        const amounts = type === 'INSTALLMENT' ? splitInstallments(D(body.amount), occurrences!) : null;
        const recurrence = await db.recurrence.create({
          data: {
            ...base,
            notes: undefined,
            direction,
            type,
            frequency,
            amount: amounts ? amounts[amounts.length - 1] : body.amount,
            startDate: dueDate,
            occurrences: occurrences ?? null,
          } as Prisma.RecurrenceUncheckedCreateInput,
        });
        if (splits.length) await replaceSplits(db, companyId, { recurrenceId: recurrence.id }, scaleSplits(splits, recurrence.amount));
        const count = occurrences ?? 1; // sem fim: a extensão automática gera o restante
        const rows = Array.from({ length: count }, (_, i) =>
          occurrenceRow(recurrence, i + 1, occurrences ?? null, occurrenceDate(dueDate, frequency, i), amounts ? amounts[i] : D(body.amount), {
            notes: base.notes,
            ...(i === 0 && {
              issueDate: body.issueDate ?? dueDate,
              expectedDate: body.expectedDate ?? null,
              interestFine: body.interestFine ?? 0,
              discount: body.discount ?? 0,
            }),
            ...(body.scheduledAtBank && { scheduledAtBank: true }),
          }),
        );
        await createOccurrences(db, direction, rows, splits);
        const first = await entries(db, direction).findFirstOrThrow({ where: { recurrenceId: recurrence.id }, orderBy: { installmentNumber: 'asc' } });
        return { entry: first, created: rows.length, recurrenceId: recurrence.id };
      }

      const entry = await entries(db, direction).create({
        data: {
          ...base,
          dueDate,
          issueDate: body.issueDate ?? dueDate,
          expectedDate: body.expectedDate ?? null,
          amount: body.amount,
          interestFine: body.interestFine ?? 0,
          discount: body.discount ?? 0,
          ...(body.scheduledAtBank && { scheduledAtBank: true }),
        },
      });
      await replaceSplits(db, companyId, owner(entry.id), splits);

      if (!body.settlement) return { entry, created: 1, recurrenceId: null };
      if (line) {
        await matchTransaction(db, line, [{ direction, entry }], 'ADJUST', userIdOf(res));
        await recalculateBalance(db, line.bankAccountId);
        return { entry: await entries(db, direction).findUniqueOrThrow({ where: { id: entry.id } }), created: 1, recurrenceId: null };
      }

      const { bankAccountId, date } = body.settlement as { bankAccountId: string; date: Date };
      await assertSettlementAccount(db, companyId, bankAccountId, date);
      const settled = await settleEntry(db, direction, entry, { amount: totalDue(entry), date, bankAccountId, userId: userIdOf(res) });
      await recalculateBalance(db, bankAccountId);
      return { entry: settled, created: 1, recurrenceId: null };
    });

    if (result.recurrenceId) await extendRecurrences(companyId, direction);
    res.status(201).json({ ...serialize(result.entry), created: result.created });
  });

  router.patch('/:id', async (req, res) => {
    const companyId = companyIdOf(req);
    const current = await findOwned(companyId, idParam(req));
    const { splits: splitsInput, ...data } = updateSchema.parse(req.body);
    await assertRefsBelongToCompany(companyId, { categoryId: data.categoryId, contactId: data.contactId, costCenterId: data.costCenterId });
    assertScheduleFlag(data.scheduledAtBank);

    // Rateio: novo (lista), removido (null) ou mantido e reescalado se o valor mudou
    const amount = data.amount ?? current.amount;
    let splits: SplitLine[] | undefined;
    if (splitsInput === null) splits = [];
    else if (splitsInput?.length) splits = await resolveSplits(prisma, companyId, nature, amount, splitsInput);
    else if (data.amount !== undefined && !D(data.amount).equals(current.amount)) {
      const existing = await prisma.entrySplit.findMany({ where: owner(current.id), orderBy: { orderIndex: 'asc' } });
      if (existing.length) splits = scaleSplits(existing, amount);
    }
    if (splits?.length) {
      const main = mainLine(splits);
      data.categoryId = main.categoryId;
      data.costCenterId = main.costCenterId;
    } else if (splitsInput === null && !data.categoryId) {
      throw new HttpError(400, 'Selecione uma categoria', { fields: ['categoryId'] });
    }

    const updated = await prisma.$transaction(async (db) => {
      const entry = await entries(db, direction).update({
        where: { id: current.id },
        data: { ...data, description: data.description === null ? current.description : data.description },
      });
      if (splits) await replaceSplits(db, companyId, owner(entry.id), splits);
      // Baixas já feitas acompanham a classificação (mantém a DRE coerente)
      const reclass = {
        ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
        ...(data.contactId !== undefined && { contactId: data.contactId }),
        ...(data.costCenterId !== undefined && { costCenterId: data.costCenterId }),
      };
      if (Object.keys(reclass).length) {
        // Só linhas que quitam exclusivamente este lançamento (uma linha que paga vários mantém a sua)
        const ref = settlementRef(direction, entry.id);
        await db.transaction.updateMany({ where: { settlements: { some: ref, every: ref } }, data: reclass });
      }
      return recomputeEntry(db, direction, entry.id);
    });
    res.json(serialize(updated));
  });

  router.delete('/:id', async (req, res) => {
    const entry = await findOwned(companyIdOf(req), idParam(req));
    if (D(entry.settledAmount).gt(0)) throw new HttpError(409, 'Estorne as baixas antes de excluir este lançamento');
    await entries(prisma, direction).delete({ where: { id: entry.id } });
    res.status(204).end();
  });

  /** Baixa em lote (barra "Receber"/"Pagar" da lista) */
  router.post('/settle', currentUser, async (req, res) => {
    const companyId = companyIdOf(req);
    const { bankAccountId, date, items } = settleSchema.parse(req.body);
    const today = startOfTodayUtc();

    const result = await prisma.$transaction(async (db) => {
      const settled = [];
      for (const item of items) {
        const entry = await entries(db, direction).findFirst({ where: { id: item.id, companyId } });
        if (!entry) throw notFound(label.entry);
        const when = item.date ?? date ?? today;
        await assertSettlementAccount(db, companyId, bankAccountId, when);
        const amount = item.amount !== undefined ? D(item.amount) : openAmount(entry);
        settled.push(await settleEntry(db, direction, entry, { amount, date: when, bankAccountId, userId: userIdOf(res) }));
      }
      await recalculateBalance(db, bankAccountId);
      return settled;
    });
    res.json({ settled: result.length, total: result.reduce((s, e) => s.plus(e.settledAmount), D(0)) });
  });

  /** Marcar como perda (o valor em aberto não será recebido/pago) */
  router.post('/write-off', async (req, res) => {
    const companyId = companyIdOf(req);
    const { ids } = z.object({ ids: z.array(z.uuid()).min(1).max(500) }).parse(req.body);
    const { count } = await entries(prisma, direction).updateMany({
      where: { id: { in: ids }, companyId, status: 'PENDING' },
      data: { status: 'LOST' },
    });
    res.json({ updated: count });
  });

  /** Marca/desmarca pagamentos como "programado no banco" (Configurações > Avançado) */
  if (direction === 'PAYABLE') {
    router.post('/bank-schedule', async (req, res) => {
      const companyId = companyIdOf(req);
      const { ids, value } = z.object({ ids: z.array(z.uuid()).min(1).max(500), value: z.boolean() }).parse(req.body);
      const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { bankScheduleEnabled: true } });
      if (!company.bankScheduleEnabled) throw new HttpError(400, 'Ative "Programado no banco" em Configurações > Avançado');
      const { count } = await prisma.payable.updateMany({ where: { id: { in: ids }, companyId, status: 'PENDING' }, data: { scheduledAtBank: value } });
      res.json({ updated: count });
    });
  }

  /** Desfaz a perda */
  router.post('/:id/reopen', async (req, res) => {
    const entry = await findOwned(companyIdOf(req), idParam(req));
    if (entry.status !== 'LOST' && entry.status !== 'CANCELLED') throw new HttpError(409, 'O lançamento não está marcado como perda');
    await entries(prisma, direction).update({ where: { id: entry.id }, data: { status: 'PENDING' } });
    res.json(serialize(await prisma.$transaction((db) => recomputeEntry(db, direction, entry.id))));
  });

  /**
   * Estorna uma baixa. Baixa feita só no sistema: o lançamento da conta é removido.
   * Baixa conciliada com o extrato: desfaz o vínculo; a linha do banco continua e volta a ficar pendente.
   */
  router.post('/:id/settlements/:settlementId/reverse', async (req, res) => {
    const companyId = companyIdOf(req);
    const entry = await findOwned(companyId, idParam(req));
    const link = await prisma.entrySettlement.findFirst({
      where: { id: idParam(req, 'settlementId'), companyId, ...settlementRef(direction, entry.id) },
      include: { transaction: { include: { _count: { select: { settlements: true } } } } },
    });
    if (!link) throw notFound('Baixa');
    const tx = link.transaction;

    const updated = await prisma.$transaction(async (db) => {
      if (tx.origin === 'SETTLEMENT' && !tx.fitid) {
        await db.transaction.delete({ where: { id: tx.id } });
        await recalculateBalance(db, tx.bankAccountId);
      } else {
        await db.entrySettlement.delete({ where: { id: link.id } });
        if (tx._count.settlements === 1) {
          await db.transaction.update({
            where: { id: tx.id },
            data: {
              origin: tx.importBatchId ? 'OFX_IMPORT' : tx.origin,
              reconciliationStatus: 'SUGGESTED',
              reconciledAt: null,
              reconciledByUserId: null,
              customDescription: null,
            },
          });
        }
      }
      return recomputeEntry(db, direction, entry.id);
    });
    res.json(serialize(updated));
  });

  /** Linhas do extrato que podem ser esta conta (para "buscar no extrato" a partir do lançamento) */
  router.get('/:id/statement-candidates', async (req, res) => {
    const companyId = companyIdOf(req);
    const entry = await findOwned(companyId, idParam(req));
    const { search } = z.object({ search: z.string().trim().optional() }).parse(req.query);
    res.json(await statementCandidates(companyId, direction, entry, search));
  });

  return router;
}
