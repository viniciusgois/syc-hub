import { prisma } from '../lib/prisma.js';
import { findMatchingRule, ruleClassification } from './rules.js';

export function activeRules(companyId: string) {
  return prisma.reconciliationRule.findMany({
    where: { companyId, isActive: true },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
}

/** Aplica as regras ativas às transações PENDING. Retorna quantas foram classificadas. */
export async function applyRulesToPending(companyId: string, bankAccountId?: string) {
  const rules = await activeRules(companyId);
  if (!rules.length) return { matched: 0, scanned: 0 };

  const pending = await prisma.transaction.findMany({
    where: { companyId, bankAccountId, reconciliationStatus: 'PENDING', splits: { none: {} } }, // linha com rateio já foi classificada à mão
    select: { id: true, description: true },
  });

  const now = new Date();
  const updates = [];
  const timesApplied = new Map<string, number>();
  for (const tx of pending) {
    const rule = findMatchingRule(rules, tx.description);
    if (!rule) continue;
    updates.push(prisma.transaction.update({ where: { id: tx.id }, data: ruleClassification(rule, now) }));
    timesApplied.set(rule.id, (timesApplied.get(rule.id) ?? 0) + 1);
  }

  await prisma.$transaction([
    ...updates,
    ...[...timesApplied].map(([id, n]) =>
      prisma.reconciliationRule.update({ where: { id }, data: { timesApplied: { increment: n } } }),
    ),
  ]);

  return { matched: updates.length, scanned: pending.length };
}

