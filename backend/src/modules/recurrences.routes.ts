import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { companyIdOf, idParam, notFound } from '../lib/http.js';
import { D, entries, extendRecurrences, startOfTodayUtc } from '../services/entries.js';
import { splitInclude } from '../services/splits.js';

export const recurrencesRouter = Router({ mergeParams: true });

const listQuery = z.object({
  direction: z.enum(['RECEIVABLE', 'PAYABLE']),
  contactId: z.uuid().optional(),
  search: z.string().trim().optional(),
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
  frequency: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL']).optional(),
  status: z.enum(['ACTIVE', 'ENDED']).optional(),
});

/** Recorrências e parcelamentos com próximo vencimento e progresso (quitadas / total) */
recurrencesRouter.get('/', async (req, res) => {
  const companyId = companyIdOf(req);
  const q = listQuery.parse(req.query);
  await extendRecurrences(companyId, q.direction);

  const recurrences = await prisma.recurrence.findMany({
    where: {
      companyId,
      direction: q.direction,
      contactId: q.contactId,
      frequency: q.frequency,
      status: q.status,
      ...(q.search && {
        OR: [
          { description: { contains: q.search, mode: 'insensitive' } },
          { documentNumber: { contains: q.search, mode: 'insensitive' } },
        ],
      }),
      ...((q.min !== undefined || q.max !== undefined) && { amount: { gte: q.min, lte: q.max } }),
    },
    include: { contact: { select: { id: true, name: true } }, category: { select: { id: true, name: true } }, splits: splitInclude },
    orderBy: { createdAt: 'desc' },
  });

  const ids = recurrences.map((r) => r.id);
  const delegate = entries(prisma, q.direction);
  const [paid, generated, next] = await Promise.all([
    delegate.groupBy({ by: ['recurrenceId'], where: { recurrenceId: { in: ids }, status: 'PAID' }, _count: { _all: true } }),
    delegate.groupBy({ by: ['recurrenceId'], where: { recurrenceId: { in: ids } }, _count: { _all: true } }),
    delegate.groupBy({ by: ['recurrenceId'], where: { recurrenceId: { in: ids }, status: 'PENDING' }, _min: { dueDate: true } }),
  ]);
  const byId = <T extends { recurrenceId: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.recurrenceId, r]));
  const paidMap = byId(paid);
  const generatedMap = byId(generated);
  const nextMap = byId(next);

  const data = recurrences.map((r) => ({
    ...r,
    nextDueDate: r.status === 'ACTIVE' ? (nextMap.get(r.id)?._min.dueDate ?? null) : null,
    progress: {
      paid: paidMap.get(r.id)?._count._all ?? 0,
      generated: generatedMap.get(r.id)?._count._all ?? 0,
      total: r.occurrences, // null = sem data de término
    },
  }));
  res.json({ data, total: data.reduce((s, r) => s.plus(r.amount), D(0)) });
});

/** Encerra: remove ocorrências futuras sem baixa e para de gerar novas */
recurrencesRouter.post('/:id/end', async (req, res) => {
  const recurrence = await prisma.recurrence.findFirst({ where: { id: idParam(req), companyId: companyIdOf(req) } });
  if (!recurrence) throw notFound('Recorrência');

  const removed = await prisma.$transaction(async (db) => {
    const { count } = await entries(db, recurrence.direction).deleteMany({
      where: { recurrenceId: recurrence.id, status: 'PENDING', settledAmount: 0, dueDate: { gte: startOfTodayUtc() } },
    });
    await db.recurrence.update({ where: { id: recurrence.id }, data: { status: 'ENDED' } });
    return count;
  });
  res.json({ removedOccurrences: removed });
});
