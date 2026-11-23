import { Category } from '../types';

export type DifferenceMode = 'ADJUST' | 'PARTIAL';
export type DifferenceReason = 'INTEREST' | 'DISCOUNT' | 'CARD_FEE' | 'OTHER_FEES';
/** Motivo escolhido pelo usuário ('' = o primeiro da lista) */
export type DifferenceChoiceValue = DifferenceReason | 'PARTIAL' | '';


/**
 * Motivos possíveis (mesma regra do servidor):
 * - recebimento, banco MENOR: tarifa de cartão, desconto, demais tarifas ou pagamento parcial · banco MAIOR: juros/multa
 * - pagamento,   banco MENOR: desconto ou pagamento parcial · banco MAIOR: juros/multa, tarifa de cartão ou demais tarifas
 */
export function differenceOptions(receiving: boolean, excess: boolean): Exclude<DifferenceChoiceValue, ''>[] {
  if (receiving) return excess ? ['INTEREST'] : ['CARD_FEE', 'DISCOUNT', 'OTHER_FEES', 'PARTIAL'];
  return excess ? ['INTEREST', 'CARD_FEE', 'OTHER_FEES'] : ['DISCOUNT', 'PARTIAL'];
}

/** O que mandar para a API: modo (quitar ou baixa parcial) e motivo do ajuste */
export function resolveDifference(choice: DifferenceChoiceValue, receiving: boolean, statementAmount: number, openTotal: number) {
  const excess = statementAmount > openTotal;
  const options = differenceOptions(receiving, excess);
  const picked = choice && options.includes(choice as Exclude<DifferenceChoiceValue, ''>) ? choice : options[0];
  return picked === 'PARTIAL' ? { mode: 'PARTIAL' as DifferenceMode, reason: null } : { mode: 'ADJUST' as DifferenceMode, reason: picked as DifferenceReason };
}

/** Categoria que recebe o ajuste quando o usuário não escolhe nenhuma (null = não há padrão) */
export function defaultCategory(categories: Category[], reason: DifferenceReason, receiving: boolean, splitsEnabled: boolean) {
  if (reason === 'CARD_FEE' || reason === 'OTHER_FEES') return categories.find((c) => c.systemKey === reason) ?? null;
  if (!splitsEnabled) return null; // juros/desconto sem rateio ficam na categoria do próprio lançamento
  const key = `${receiving ? 'RECEIVABLE' : 'PAYABLE'}_${reason === 'INTEREST' ? 'INTEREST' : 'DISCOUNT'}`;
  return categories.find((c) => c.systemKey === key) ?? null;
}

/** Tarifa sem categoria padrão: o usuário precisa escolher a categoria (senão ela cairia na receita/despesa do lançamento) */
export function differenceNeedsCategory(categories: Category[], reason: DifferenceReason | null, category: string) {
  return !!reason && (reason === 'CARD_FEE' || reason === 'OTHER_FEES') && !category && !categories.some((c) => c.systemKey === reason);
}
