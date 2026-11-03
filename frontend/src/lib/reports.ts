/** Abas de Relatórios (módulo de navegação -> rótulo), na ordem do Nibo */
export const REPORT_TABS = [
  { module: 'rel-painel', label: 'Painel de acompanhamento' },
  { module: 'rel-receber', label: 'Contas a receber' },
  { module: 'rel-recebidas', label: 'Contas recebidas' },
  { module: 'rel-pagar', label: 'Contas a pagar' },
  { module: 'rel-pagas', label: 'Contas pagas' },
  { module: 'rel-mais', label: 'Mais relatórios...' },
] as const;

export const isReportModule = (module: string) => REPORT_TABS.some((t) => t.module === module);

/** Relatórios de contas: tipo, situação e qual data o filtro de período usa em cada regime */
export interface EntriesReportConfig {
  module: string;
  title: string;
  type: 'receivable' | 'payable';
  state: 'open' | 'settled';
  /** Rótulo do período no regime de caixa (no de competência é sempre "Período de competência") */
  cashPeriodLabel: string;
  cashDateBy: 'due' | 'payment';
  amountLabel: string; // "Valor em aberto" / "Valor recebido" / "Valor pago"
}

export const ENTRIES_REPORTS: Record<string, EntriesReportConfig> = {
  'rel-receber': { module: 'rel-receber', title: 'Contas a receber', type: 'receivable', state: 'open', cashPeriodLabel: 'Período de vencimento', cashDateBy: 'due', amountLabel: 'Valor em aberto' },
  'rel-recebidas': { module: 'rel-recebidas', title: 'Contas recebidas', type: 'receivable', state: 'settled', cashPeriodLabel: 'Período de recebimento', cashDateBy: 'payment', amountLabel: 'Valor recebido' },
  'rel-pagar': { module: 'rel-pagar', title: 'Contas a pagar', type: 'payable', state: 'open', cashPeriodLabel: 'Período de vencimento', cashDateBy: 'due', amountLabel: 'Valor em aberto' },
  'rel-pagas': { module: 'rel-pagas', title: 'Contas pagas', type: 'payable', state: 'settled', cashPeriodLabel: 'Período de pagamento', cashDateBy: 'payment', amountLabel: 'Valor pago' },
};

/** Linha dos relatórios (razão gerencial do backend) */
export interface ReportRow {
  group: string;
  flow: 'IN' | 'OUT';
  date: string;
  categoryId: string | null;
  categoryName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  value: number;
  groupTotal: number;
  realized: boolean;
  entry: { id: string; direction: 'RECEIVABLE' | 'PAYABLE' } | null;
  transactionId: string | null;
  description: string;
  documentNumber: string | null;
  contactName: string | null;
  dueDate: string | null;
  issueDate: string | null;
  paidAt: string | null;
  bankAccountName: string | null;
  isOverdue: boolean;
}

/** Valor no padrão do Nibo: negativos entre parênteses */
export const accounting = (v: number, decimals = 2) => {
  const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return v < -0.004 ? `(${s})` : s;
};

export const fileSafe = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_');
