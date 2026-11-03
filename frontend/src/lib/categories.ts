import { Category, DRESection } from '../types';

export const SECTION_ORDER: DRESection[] = ['OPERATING_REVENUE', 'OPERATING_COSTS', 'OPERATING_EXPENSES', 'INVESTING', 'FINANCING'];

export const SECTION_LABEL: Record<DRESection, string> = {
  OPERATING_REVENUE: 'Receitas operacionais',
  OPERATING_COSTS: 'Custos operacionais',
  OPERATING_EXPENSES: 'Despesas operacionais e outras receitas',
  INVESTING: 'Atividades de investimento',
  FINANCING: 'Atividades de financiamento',
};

export interface CategoryOption {
  value: string;
  label: string; // "Subgrupo › Categoria" ou só o nome
  group: string; // seção
  type: Category['type'];
}

/**
 * Categorias lançáveis (sem subgrupos), na ordem do plano de contas, agrupadas pela seção da DRE.
 * `type` filtra entradas (INCOME) ou saídas (EXPENSE).
 */
export function categoryChoices(categories: Category[], type?: 'INCOME' | 'EXPENSE'): CategoryOption[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out: CategoryOption[] = [];
  for (const section of SECTION_ORDER) {
    const roots = categories.filter((c) => c.section === section && !c.parentId).sort((a, b) => a.orderIndex - b.orderIndex);
    for (const root of roots) {
      const leaves = root.isGroup
        ? categories.filter((c) => c.parentId === root.id && !c.isGroup).sort((a, b) => a.orderIndex - b.orderIndex)
        : [root];
      for (const c of leaves) {
        if (type && c.type !== type) continue;
        const parent = c.parentId ? byId.get(c.parentId) : undefined;
        out.push({ value: c.id, label: parent ? `${parent.name} › ${c.name}` : c.name, group: SECTION_LABEL[section], type: c.type });
      }
    }
  }
  return out;
}
