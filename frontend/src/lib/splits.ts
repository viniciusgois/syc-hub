import { Category, SplitLine } from '../types';

/** Rateio em edição: por valor (digita R$) ou por percentual (digita %, o valor é calculado) */
export type SplitMode = 'value' | 'percent';

export interface SplitDraftLine {
  key: string;
  categoryId: string;
  costCenterId: string;
  amount: number; // sempre positivo; o sinal vem da natureza da categoria
  percent: number;
}

export interface SplitDraft {
  mode: SplitMode;
  lines: SplitDraftLine[];
}

export type Nature = 'INCOME' | 'EXPENSE';

const round2 = (v: number) => Math.round(v * 100) / 100;
let seq = 0;
export const newSplitLine = (patch: Partial<SplitDraftLine> = {}): SplitDraftLine => ({ key: `l${++seq}`, categoryId: '', costCenterId: '', amount: 0, percent: 0, ...patch });

/** +1 quando a categoria tem a natureza do lançamento; −1 quando é oposta (entra subtraindo) */
export const signOf = (categories: Category[], categoryId: string, nature: Nature) => {
  const c = categories.find((x) => x.id === categoryId);
  return c && c.type !== nature && c.type !== 'TRANSFER' ? -1 : 1;
};

/** Começa um rateio a partir da classificação atual: a categoria atual + uma linha em branco */
export function startSplit(total: number, categoryId: string, costCenterId: string): SplitDraft {
  return { mode: 'value', lines: [newSplitLine({ categoryId, costCenterId, amount: round2(total), percent: 100 }), newSplitLine()] };
}

/** Rateio salvo -> rascunho (modo valor) */
export function draftFromSplits(splits: SplitLine[], total: number): SplitDraft {
  return {
    mode: 'value',
    lines: splits.map((s) =>
      newSplitLine({ categoryId: s.categoryId, costCenterId: s.costCenterId ?? '', amount: Math.abs(s.amount), percent: total ? round2((Math.abs(s.amount) / total) * 100) : 0 }),
    ),
  };
}

/**
 * Valores finais das linhas. No modo percentual o valor sai do % sobre o total e, quando os %
 * fecham 100, a sobra de arredondamento vai para a maior linha (igual ao servidor).
 */
export function resolveSplit(draft: SplitDraft, total: number, sign: (categoryId: string) => number): SplitDraftLine[] {
  if (draft.mode === 'value') return draft.lines.map((l) => ({ ...l, percent: total ? round2((l.amount / total) * 100) : 0 }));
  const lines = draft.lines.map((l) => ({ ...l, amount: round2((total * l.percent) / 100) }));
  const pctSum = round2(lines.reduce((s, l) => s + sign(l.categoryId) * l.percent, 0));
  if (pctSum === 100 && lines.length) {
    const diff = round2(total - lines.reduce((s, l) => s + sign(l.categoryId) * l.amount, 0));
    const main = lines.filter((l) => sign(l.categoryId) > 0).sort((a, b) => b.amount - a.amount)[0];
    if (main && diff) main.amount = round2(main.amount + diff);
  }
  return lines;
}

/** Soma com sinal e quanto falta para fechar o total */
export function splitSummary(lines: SplitDraftLine[], total: number, sign: (categoryId: string) => number) {
  const distributed = round2(lines.reduce((s, l) => s + sign(l.categoryId) * l.amount, 0));
  return { distributed, remaining: round2(total - distributed) };
}

/** Erro de validação (ou null) antes de enviar */
export function splitError(lines: SplitDraftLine[], total: number, sign: (categoryId: string) => number): string | null {
  if (lines.length < 2) return 'O rateio precisa de ao menos 2 linhas';
  if (lines.some((l) => !l.categoryId)) return 'Selecione a categoria de todas as linhas';
  if (lines.some((l) => l.amount <= 0)) return 'Todas as linhas precisam de valor';
  const { remaining } = splitSummary(lines, total, sign);
  if (remaining !== 0) return remaining > 0 ? `Falta ratear R$ ${money(remaining)}` : `O rateio passou R$ ${money(-remaining)} do valor`;
  return null;
}

export const splitPayload = (lines: SplitDraftLine[]) => lines.map((l) => ({ categoryId: l.categoryId, costCenterId: l.costCenterId || null, amount: l.amount }));

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rótulo curto para listas: "Rateio · 3 categorias" */
export function splitLabel(splits: SplitLine[]) {
  const n = new Set(splits.map((s) => s.categoryId)).size;
  return n > 1 ? `Rateio · ${n} categorias` : `Rateio · ${splits[0]?.category.name ?? ''}`;
}

export const splitTooltip = (splits: SplitLine[]) =>
  splits.map((s) => `${s.amount < 0 ? '− ' : ''}${s.category.name}${s.costCenter ? ` (${s.costCenter.name})` : ''}: R$ ${money(Math.abs(s.amount))}`).join('\n');
