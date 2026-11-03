import { Transaction } from '../types';

/** Linha do extrato como vem da API (nulos em vez de ausentes) */
export type ApiTransaction = Omit<Transaction, 'date'> & {
  date: string;
  categoryId: string | null;
  contactId: string | null;
  customDescription: string | null;
  fitid: string | null;
  checknum: string | null;
  rule?: { id: string; name: string } | null;
};

export function toTransaction(t: ApiTransaction): Transaction {
  const suggested = t.reconciliationStatus === 'SUGGESTED';
  return {
    ...t,
    date: t.date.slice(0, 10),
    categoryId: t.categoryId ?? undefined,
    contactId: t.contactId ?? undefined,
    customDescription: t.customDescription ?? undefined,
    fitid: t.fitid ?? undefined,
    checknum: t.checknum ?? undefined,
    suggestedCategoryId: suggested ? (t.categoryId ?? undefined) : undefined,
    suggestedContactId: suggested ? (t.contactId ?? undefined) : undefined,
    ruleMatchReason: t.rule ? `Regra: ${t.rule.name}` : undefined,
  };
}
