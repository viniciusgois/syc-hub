import { Prisma, type DRESection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { type Basis, type LedgerRow, ledgerRows } from './ledger.js';

const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);

export const SECTION_ORDER: DRESection[] = ['OPERATING_REVENUE', 'OPERATING_COSTS', 'OPERATING_EXPENSES', 'INVESTING', 'FINANCING'];
export const SECTION_LABEL: Record<DRESection, string> = {
  OPERATING_REVENUE: 'Receitas operacionais',
  OPERATING_COSTS: 'Custos operacionais',
  OPERATING_EXPENSES: 'Despesas operacionais e outras receitas',
  INVESTING: 'Atividades de investimento',
  FINANCING: 'Atividades de financiamento',
};
const SECTION_LETTER: Record<DRESection, string> = { OPERATING_REVENUE: 'A', OPERATING_COSTS: 'B', OPERATING_EXPENSES: 'C', INVESTING: 'E', FINANCING: 'F' };

/** 12 meses + total do ano */
const COLS = 13;
type Values = Prisma.Decimal[];
const zeros = (): Values => Array.from({ length: COLS }, () => D());
const sum = (a: Values, b: Values) => a.map((v, i) => v.plus(b[i]));

export interface PanelLine {
  id: string;
  name: string;
  kind: 'GROUP' | 'CATEGORY';
  direction: 'INCOME' | 'EXPENSE' | null;
  values: Values;
  children?: PanelLine[];
}

/** Ponto de equilíbrio: receita necessária para cobrir as despesas (C) com a margem atual = |C| ÷ (lucro bruto ÷ receita) */
function breakEven(revenue: Prisma.Decimal, grossProfit: Prisma.Decimal, expenses: Prisma.Decimal) {
  if (!revenue.gt(0) || !grossProfit.gt(0) || !expenses.lt(0)) return null;
  return expenses.abs().div(grossProfit.div(revenue)).toDecimalPlaces(2);
}

/**
 * Painel de acompanhamento: matriz anual (Jan–Dez + ano) pelas 5 seções fixas da DRE gerencial,
 * com Lucro bruto (A+B), Margem de contribuição (%), Ponto de equilíbrio, Resultado operacional (A+B+C=D),
 * Investimento (E), Financiamento (F) e Variação de caixa / Resultado (D+E+F).
 */
export async function buildPanel({ companyId, year, basis: wanted, costCenterId }: { companyId: string; year: number; basis?: Basis; costCenterId?: string }) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { accrualBasis: true } });
  const basis: Basis = wanted ?? (company.accrualBasis ? 'ACCRUAL' : 'CASH');
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  const rows = await ledgerRows({ companyId, basis, from, to, costCenterId });

  const byCategory = new Map<string, Values>();
  for (const r of rows) {
    if (!r.categoryId) continue;
    const v = byCategory.get(r.categoryId) ?? zeros();
    const m = r.date.getUTCMonth();
    v[m] = v[m].plus(r.value);
    v[12] = v[12].plus(r.value);
    byCategory.set(r.categoryId, v);
  }

  const categories = await prisma.category.findMany({
    where: { companyId, section: { not: null }, isDREApplicable: true },
    orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, type: true, section: true, isGroup: true, parentId: true, isActive: true },
  });
  const valuesOf = (id: string) => (byCategory.get(id) ?? zeros()).map((v) => v.toDecimalPlaces(2));
  const leaf = (c: (typeof categories)[number]): PanelLine => ({ id: c.id, name: c.name, kind: 'CATEGORY', direction: c.type === 'INCOME' ? 'INCOME' : 'EXPENSE', values: valuesOf(c.id) });
  // Categorias e subgrupos inativos só aparecem se tiveram movimento no ano
  const visible = (l: PanelLine, active: boolean) => active || l.values.some((v) => !v.isZero());

  const sections = SECTION_ORDER.map((section) => {
    const items: PanelLine[] = [];
    for (const c of categories.filter((x) => x.section === section && !x.parentId)) {
      if (c.isGroup) {
        const children = categories
          .filter((x) => x.parentId === c.id && !x.isGroup)
          .map((x) => ({ line: leaf(x), active: x.isActive }))
          .filter(({ line, active }) => visible(line, active))
          .map(({ line }) => line);
        const values = children.reduce((s, l) => sum(s, l.values), zeros());
        if (c.isActive || values.some((v) => !v.isZero())) items.push({ id: c.id, name: c.name, kind: 'GROUP', direction: null, values, children });
      } else {
        const line = leaf(c);
        if (visible(line, c.isActive)) items.push(line);
      }
    }
    return { section, label: SECTION_LABEL[section], letter: SECTION_LETTER[section], totals: items.reduce((s, l) => sum(s, l.values), zeros()), items };
  });

  const total = (s: DRESection) => sections.find((x) => x.section === s)!.totals;
  const revenue = total('OPERATING_REVENUE');
  const grossProfit = sum(revenue, total('OPERATING_COSTS'));
  const expenses = total('OPERATING_EXPENSES');
  const operatingResult = sum(grossProfit, expenses);
  const netResult = sum(sum(operatingResult, total('INVESTING')), total('FINANCING'));

  return {
    year,
    basis,
    sections,
    results: {
      grossProfit,
      contributionMarginPct: revenue.map((r, i) => (r.isZero() ? null : grossProfit[i].div(r).times(100).toDecimalPlaces(1))),
      breakEven: revenue.map((r, i) => breakEven(r, grossProfit[i], expenses[i])),
      operatingResult,
      netResult,
    },
  };
}

/** Linhas que compõem uma célula do painel (categoria, subgrupo ou seção num período) */
export async function panelDetails(q: { companyId: string; basis?: Basis; from: Date; to: Date; costCenterId?: string; categoryId?: string; groupId?: string; section?: DRESection }) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: q.companyId }, select: { accrualBasis: true } });
  const basis: Basis = q.basis ?? (company.accrualBasis ? 'ACCRUAL' : 'CASH');
  const categories = await prisma.category.findMany({
    where: {
      companyId: q.companyId,
      isGroup: false,
      ...(q.categoryId && { id: q.categoryId }),
      ...(q.groupId && { parentId: q.groupId }),
      ...(q.section && { section: q.section }),
      ...(!q.categoryId && !q.groupId && !q.section && { section: { not: null } }),
    },
    select: { id: true, name: true },
  });
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const rows = (await ledgerRows({ companyId: q.companyId, basis, from: q.from, to: q.to, costCenterId: q.costCenterId })).filter((r) => r.categoryId && names.has(r.categoryId));
  return { basis, rows: await withNames(rows), total: rows.reduce((s, r) => s.plus(r.value), D()) };
}

/** Acrescenta nome da categoria e do centro de custo às linhas do razão */
export async function withNames(rows: LedgerRow[]) {
  const catIds = [...new Set(rows.map((r) => r.categoryId).filter((v): v is string => !!v))];
  const ccIds = [...new Set(rows.map((r) => r.costCenterId).filter((v): v is string => !!v))];
  const [cats, ccs] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } }),
    prisma.costCenter.findMany({ where: { id: { in: ccIds } }, select: { id: true, name: true } }),
  ]);
  const cat = new Map(cats.map((c) => [c.id, c.name]));
  const cc = new Map(ccs.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, categoryName: r.categoryId ? (cat.get(r.categoryId) ?? null) : null, costCenterName: r.costCenterId ? (cc.get(r.costCenterId) ?? null) : null }));
}
