import { randomUUID } from 'node:crypto';
import type { CategoryType, DRESection, Prisma } from '@prisma/client';

/**
 * Plano de contas gerencial padrão (genérico, atende a maioria das empresas).
 * Cada empresa nova recebe uma cópia e ajusta conforme a necessidade.
 * "system" = categoria usada pelo sistema (juros, multas, descontos): não pode ser editada/excluída.
 */

type Item = { name: string; type: Exclude<CategoryType, 'TRANSFER'>; system?: true };
type Group = { group: string; items: Item[] };
type SectionChart = { section: DRESection; entries: (Item | Group)[] };

const IN = 'INCOME' as const;
const OUT = 'EXPENSE' as const;

export const DEFAULT_CHART: SectionChart[] = [
  {
    section: 'OPERATING_REVENUE',
    entries: [
      { name: 'Receita com serviços', type: IN },
      { name: 'Receita com vendas', type: IN },
      { name: 'Outras receitas', type: IN, system: true },
      { name: 'Multas recebidas', type: IN, system: true },
      { name: 'Descontos concedidos', type: OUT, system: true },
    ],
  },
  {
    section: 'OPERATING_COSTS',
    entries: [
      { name: 'Custo das mercadorias vendidas (CMV)', type: OUT },
      { name: 'Insumos e matéria-prima', type: OUT },
      { name: 'Produção e serviços terceirizados', type: OUT },
      { name: 'Fretes e entregas', type: OUT },
      { name: 'Comissões sobre vendas', type: OUT },
      { name: 'Taxas de cartão e meios de pagamento', type: OUT },
      {
        group: 'Impostos sobre a receita',
        items: [
          { name: 'Simples Nacional (DAS)', type: OUT },
          { name: 'ISS', type: OUT },
          { name: 'PIS', type: OUT },
          { name: 'COFINS', type: OUT },
          { name: 'ICMS', type: OUT },
          { name: 'IRPJ e CSLL', type: OUT },
        ],
      },
    ],
  },
  {
    section: 'OPERATING_EXPENSES',
    entries: [
      {
        group: 'Despesas administrativas',
        items: [
          { name: 'Aluguel e condomínio', type: OUT },
          { name: 'Energia elétrica', type: OUT },
          { name: 'Água e saneamento', type: OUT },
          { name: 'Telefone e internet', type: OUT },
          { name: 'Sistemas e softwares', type: OUT },
          { name: 'Contabilidade', type: OUT },
          { name: 'Serviços contratados', type: OUT },
          { name: 'Material de escritório e limpeza', type: OUT },
          { name: 'Manutenções e reparos', type: OUT },
          { name: 'Seguros', type: OUT },
          { name: 'Taxas e contribuições', type: OUT },
          { name: 'Despesas com veículos', type: OUT },
          { name: 'Viagens e deslocamentos', type: OUT },
          { name: 'Multas pagas', type: OUT, system: true },
          { name: 'Outras despesas', type: OUT },
        ],
      },
      {
        group: 'Despesas com pessoal',
        items: [
          { name: 'Salários', type: OUT },
          { name: 'Encargos (INSS e FGTS)', type: OUT },
          { name: 'Benefícios (VT, VR, plano de saúde)', type: OUT },
          { name: 'Férias e 13º salário', type: OUT },
          { name: 'Rescisões', type: OUT },
          { name: 'Pró-labore', type: OUT },
          { name: 'Cursos e treinamentos', type: OUT },
        ],
      },
      {
        group: 'Despesas comerciais e marketing',
        items: [
          { name: 'Marketing e publicidade', type: OUT },
          { name: 'Brindes e eventos', type: OUT },
        ],
      },
      {
        group: 'Despesas financeiras',
        items: [
          { name: 'Tarifas bancárias', type: OUT },
          { name: 'IOF', type: OUT },
          { name: 'Juros pagos', type: OUT, system: true },
        ],
      },
      {
        group: 'Outras receitas',
        items: [
          { name: 'Descontos obtidos', type: IN, system: true },
          { name: 'Reembolsos recebidos', type: IN },
          { name: 'Outras receitas não operacionais', type: IN },
        ],
      },
    ],
  },
  {
    section: 'INVESTING',
    entries: [
      { name: 'Compra de ativo imobilizado', type: OUT },
      { name: 'Aquisição de veículos', type: OUT },
      { name: 'Aquisição de máquinas e equipamentos', type: OUT },
      { name: 'Aplicações financeiras', type: OUT },
      { name: 'Resgate de aplicações financeiras', type: IN },
      { name: 'Rendimentos de aplicações financeiras', type: IN },
      { name: 'Venda de ativo imobilizado', type: IN },
    ],
  },
  {
    section: 'FINANCING',
    entries: [
      { name: 'Aporte de capital', type: IN },
      { name: 'Obtenção de empréstimos', type: IN },
      { name: 'Juros recebidos', type: IN, system: true },
      { name: 'Pagamento de empréstimos', type: OUT },
      { name: 'Juros de empréstimos', type: OUT },
      { name: 'Distribuição de lucros', type: OUT },
      { name: 'Retirada de capital', type: OUT },
    ],
  },
];

/** Categoria de sistema fora da DRE (movimentação entre contas da própria empresa) */
export const TRANSFER_CATEGORY_NAME = 'Transferência entre contas';

/**
 * Papel fixo de algumas categorias do plano padrão. O sistema acha essas categorias pela chave (não pelo nome),
 * então o usuário pode renomear e mover à vontade. Com o rateio ativo, juros/multa e desconto vão para elas.
 */
export const SYSTEM_KEYS: Record<string, string> = {
  'Multas recebidas': 'RECEIVABLE_INTEREST',
  'Descontos concedidos': 'RECEIVABLE_DISCOUNT',
  'Multas pagas': 'PAYABLE_INTEREST',
  'Descontos obtidos': 'PAYABLE_DISCOUNT',
};
/** Categorias padrão das tarifas (não são "do sistema": só a sugestão quando o motivo da diferença é uma tarifa) */
const FEE_KEYS: Record<string, string> = {
  'Taxas de cartão e meios de pagamento': 'CARD_FEE',
  'Tarifas bancárias': 'OTHER_FEES',
};
const keyOf = (name: string, system?: boolean) => (system ? (SYSTEM_KEYS[name] ?? null) : (FEE_KEYS[name] ?? null));

/** Linhas do plano padrão para uma empresa (subgrupos com ids gerados para ligar as filhas) */
export function defaultCategoriesFor(companyId: string): Prisma.CategoryCreateManyInput[] {
  const rows: Prisma.CategoryCreateManyInput[] = [];
  for (const { section, entries } of DEFAULT_CHART) {
    entries.forEach((entry, i) => {
      if ('group' in entry) {
        const groupId = randomUUID();
        rows.push({ id: groupId, companyId, section, isGroup: true, name: entry.group, type: 'EXPENSE', orderIndex: i });
        entry.items.forEach((item, j) =>
          rows.push({ companyId, section, parentId: groupId, name: item.name, type: item.type, isSystem: !!item.system, systemKey: keyOf(item.name, item.system), orderIndex: j }),
        );
      } else {
        rows.push({ companyId, section, name: entry.name, type: entry.type, isSystem: !!entry.system, systemKey: keyOf(entry.name, entry.system), orderIndex: i });
      }
    });
  }
  rows.push({ companyId, section: null, name: TRANSFER_CATEGORY_NAME, type: 'TRANSFER', isSystem: true, systemKey: 'TRANSFER', isDREApplicable: false, orderIndex: 0 });
  return rows;
}
