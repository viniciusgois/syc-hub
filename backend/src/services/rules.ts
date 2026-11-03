import type { ReconciliationRule } from '@prisma/client';

export function ruleMatches(rule: Pick<ReconciliationRule, 'matchType' | 'pattern'>, description: string): boolean {
  const text = description.toUpperCase();
  const pattern = rule.pattern.toUpperCase();
  switch (rule.matchType) {
    case 'CONTAINS':
      return text.includes(pattern);
    case 'EXACT':
      return text.trim() === pattern.trim();
    case 'STARTS_WITH':
      return text.startsWith(pattern);
    case 'REGEX':
      try {
        return new RegExp(rule.pattern, 'i').test(description);
      } catch {
        return false;
      }
  }
}

/** Retorna a primeira regra (por prioridade desc) que casa com a descrição */
export function findMatchingRule<R extends Pick<ReconciliationRule, 'matchType' | 'pattern'>>(
  rules: R[],
  description: string,
): R | undefined {
  return rules.find((r) => ruleMatches(r, description));
}

/** Campos aplicados a uma transação quando uma regra casa */
export function ruleClassification(rule: ReconciliationRule, now = new Date()) {
  return {
    reconciliationRuleId: rule.id,
    categoryId: rule.targetCategoryId,
    contactId: rule.targetContactId,
    costCenterId: rule.targetCostCenterId,
    reconciliationStatus: rule.autoReconcile ? ('RECONCILED' as const) : ('SUGGESTED' as const),
    reconciledAt: rule.autoReconcile ? now : null,
  };
}
