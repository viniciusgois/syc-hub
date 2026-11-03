import { Category, Contact, SplitLine } from '../types';
import { categoryChoices } from './categories';
import { SearchOption } from '../components/common/SearchSelect';
import { formatDocument } from './documents';

export type EntryDirection = 'RECEIVABLE' | 'PAYABLE';

export interface EntryRow {
  id: string;
  description: string;
  displayDescription: string;
  documentNumber: string | null;
  notes: string | null;
  dueDate: string;
  issueDate: string;
  expectedDate: string | null;
  amount: number;
  interestFine: number;
  discount: number;
  settledAmount: number;
  settledAt: string | null;
  total: number;
  openAmount: number;
  isOverdue: boolean;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'LOST';
  isStarred: boolean;
  scheduledAtBank?: boolean; // só pagamentos
  contactId: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  recurrenceId: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  contact: { id: string; name: string; document: string | null } | null;
  category: { id: string; name: string; code: string | null } | null;
  costCenter: { id: string; name: string } | null;
  splits: SplitLine[];
  recurrence: { id: string; type: 'RECURRING' | 'INSTALLMENT'; frequency: string; occurrences?: number | null; status?: string } | null;
}

export interface EntryDetail extends EntryRow {
  settlements: {
    id: string;
    transactionId: string;
    date: string;
    amount: number;
    transactionAmount: number;
    statementDescription: string | null;
    matchedWithStatement: boolean;
    bankAccount: { id: string; name: string };
  }[];
}

export interface EntryConfig {
  direction: EntryDirection;
  endpoint: 'receivables' | 'payables';
  section: string; // "Recebimentos"
  listTitle: string; // "Receber"
  listModule: string;
  scheduleModule: string;
  recurrencesModule: string;
  noun: string; // "recebimento"
  verb: string; // "Receber"
  newUnscheduled: string;
  scheduleTitle: string;
  editTitle: string;
  settledDateLabel: string; // "Recebimento"
  amountToSettle: string; // "Valor a receber"
  settleDateColumn: string;
  totalToSettle: string; // "Total a receber"
  totalSettled: string; // "Total recebido"
  continueCreating: string;
  settledStatus: string; // "Recebidos"
  categoryType: 'INCOME' | 'EXPENSE';
  recurrencesTitle: string;
}

export const ENTRY_CONFIG: Record<EntryDirection, EntryConfig> = {
  RECEIVABLE: {
    direction: 'RECEIVABLE',
    endpoint: 'receivables',
    section: 'Recebimentos',
    listTitle: 'Receber',
    listModule: 'contas-receber',
    scheduleModule: 'agendar-receber',
    recurrencesModule: 'recorrencias-receber',
    noun: 'recebimento',
    verb: 'Receber',
    newUnscheduled: 'Recebimento não agendado',
    scheduleTitle: 'Agendar recebimento',
    editTitle: 'Editar recebimento',
    settledDateLabel: 'Recebimento',
    amountToSettle: 'Valor a receber',
    settleDateColumn: 'Data do recebimento',
    totalToSettle: 'Total a receber',
    totalSettled: 'Total recebido',
    continueCreating: 'Continuar criando recebimentos',
    settledStatus: 'Recebidos',
    categoryType: 'INCOME',
    recurrencesTitle: 'Recebimentos recorrentes',
  },
  PAYABLE: {
    direction: 'PAYABLE',
    endpoint: 'payables',
    section: 'Pagamentos',
    listTitle: 'Pagar',
    listModule: 'contas-pagar',
    scheduleModule: 'agendar-pagar',
    recurrencesModule: 'recorrencias-pagar',
    noun: 'pagamento',
    verb: 'Pagar',
    newUnscheduled: 'Pagamento não agendado',
    scheduleTitle: 'Agendar pagamento',
    editTitle: 'Editar pagamento',
    settledDateLabel: 'Pagamento',
    amountToSettle: 'Valor a pagar',
    settleDateColumn: 'Data do pagamento',
    totalToSettle: 'Total a pagar',
    totalSettled: 'Total pago',
    continueCreating: 'Continuar criando pagamentos',
    settledStatus: 'Pagos',
    categoryType: 'EXPENSE',
    recurrencesTitle: 'Pagamentos recorrentes',
  },
};

/** Módulo da navegação -> configuração + aba */
export function entryRoute(module: string): { config: EntryConfig; tab: 'list' | 'schedule' | 'recurrences' } | null {
  for (const config of Object.values(ENTRY_CONFIG)) {
    if (module === config.listModule) return { config, tab: 'list' };
    if (module === config.scheduleModule) return { config, tab: 'schedule' };
    if (module === config.recurrencesModule) return { config, tab: 'recurrences' };
  }
  return null;
}

export const FREQUENCIES = [
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'BIWEEKLY', label: 'Quinzenal' },
  { value: 'MONTHLY', label: 'Mensal' },
  { value: 'BIMONTHLY', label: 'Bimestral' },
  { value: 'QUARTERLY', label: 'Trimestral' },
  { value: 'SEMIANNUAL', label: 'Semestral' },
  { value: 'ANNUAL', label: 'Anual' },
] as const;

export const frequencyLabel = (v: string) => FREQUENCIES.find((f) => f.value === v)?.label ?? v;

/** Categorias da direção (receitas para receber, despesas para pagar), agrupadas pela seção da DRE */
export function categoryOptions(categories: Category[], type: 'INCOME' | 'EXPENSE'): SearchOption[] {
  return categoryChoices(categories, type).map(({ value, label, group }) => ({ value, label, group }));
}

const CONTACT_GROUP: Record<string, string> = {
  CUSTOMER: 'Clientes',
  SUPPLIER: 'Fornecedores',
  EMPLOYEE: 'Funcionários',
  PARTNER: 'Sócios',
  OTHER: 'Outros',
};

/** Contatos agrupados por tipo; o grupo mais provável da direção vem primeiro */
export function contactOptions(contacts: Contact[], direction: EntryDirection): SearchOption[] {
  const order = direction === 'RECEIVABLE' ? ['CUSTOMER', 'PARTNER', 'SUPPLIER', 'EMPLOYEE', 'OTHER'] : ['SUPPLIER', 'EMPLOYEE', 'PARTNER', 'CUSTOMER', 'OTHER'];
  return [...contacts]
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.name.localeCompare(b.name, 'pt-BR'))
    .map((c) => ({
      value: c.id,
      label: c.name,
      sublabel: c.document ? (c.personType === 'FOREIGN' ? c.document : formatDocument(c.document)) : undefined,
      group: CONTACT_GROUP[c.type],
    }));
}

export const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const brDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
