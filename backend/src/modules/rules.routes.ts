import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { recalculateBalances } from '../services/balance.js';
import { HttpError, companyIdOf, idParam, notFound } from '../lib/http.js';
import { assertRefsBelongToCompany } from '../services/ownership.js';
import { applyRulesToPending } from '../services/applyRules.js';

export const rulesRouter = Router({ mergeParams: true });

const ruleSchema = z.object({
  name: z.string().min(1),
  matchType: z.enum(['CONTAINS', 'EXACT', 'STARTS_WITH', 'REGEX']).optional(),
  pattern: z.string().min(1),
  targetCategoryId: z.uuid(),
  targetContactId: z.uuid().nullable().optional(),
  targetCostCenterId: z.uuid().nullable().optional(),
  autoReconcile: z.boolean().optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

function assertValidRegex(matchType: string | undefined, pattern: string | undefined) {
  if (matchType !== 'REGEX' || pattern === undefined) return;
  try {
    new RegExp(pattern);
  } catch {
    throw new HttpError(400, 'Expressão regular inválida');
  }
}

rulesRouter.get('/', async (req, res) => {
  const rules = await prisma.reconciliationRule.findMany({
    where: { companyId: companyIdOf(req) },
    orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    include: { targetCategory: { select: { id: true, name: true, code: true } } },
  });
  res.json(rules);
});

rulesRouter.post('/', async (req, res) => {
  const companyId = companyIdOf(req);
  const data = ruleSchema.parse(req.body);
  assertValidRegex(data.matchType, data.pattern);
  await assertRefsBelongToCompany(companyId, {
    categoryId: data.targetCategoryId,
    contactId: data.targetContactId,
    costCenterId: data.targetCostCenterId,
  });
  res.status(201).json(await prisma.reconciliationRule.create({ data: { ...data, companyId } }));
});

rulesRouter.patch('/:id', async (req, res) => {
  const companyId = companyIdOf(req);
  const data = ruleSchema.partial().parse(req.body);
  const rule = await prisma.reconciliationRule.findFirst({ where: { id: idParam(req), companyId } });
  if (!rule) throw notFound('Regra');
  assertValidRegex(data.matchType ?? rule.matchType, data.pattern ?? rule.pattern);
  await assertRefsBelongToCompany(companyId, {
    categoryId: data.targetCategoryId,
    contactId: data.targetContactId,
    costCenterId: data.targetCostCenterId,
  });
  res.json(await prisma.reconciliationRule.update({ where: { id: rule.id }, data }));
});

rulesRouter.delete('/:id', async (req, res) => {
  const rule = await prisma.reconciliationRule.findFirst({ where: { id: idParam(req), companyId: companyIdOf(req) } });
  if (!rule) throw notFound('Regra');
  await prisma.reconciliationRule.delete({ where: { id: rule.id } });
  res.status(204).end();
});

/** Reaplica as regras ativas sobre todas as transações PENDING da empresa */
rulesRouter.post('/apply', async (req, res) => {
  const { bankAccountId } = z.object({ bankAccountId: z.uuid().optional() }).parse(req.body ?? {});
  const companyId = companyIdOf(req);
  const result = await applyRulesToPending(companyId, bankAccountId);
  // Regras com "conciliar automaticamente" mudam o saldo das contas
  const accounts = await prisma.bankAccount.findMany({ where: { companyId, ...(bankAccountId && { id: bankAccountId }) }, select: { id: true } });
  await prisma.$transaction((db) => recalculateBalances(db, accounts.map((a) => a.id)));
  res.json(result);
});
