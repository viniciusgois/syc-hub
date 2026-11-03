export type TaxRegime = 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'MEI';

export type AccountType = 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CASH' | 'CREDIT_CARD' | 'PAYMENT_GATEWAY' | 'OTHER';

export type TransactionType = 'CREDIT' | 'DEBIT';

export type ReconciliationStatus = 'PENDING' | 'SUGGESTED' | 'RECONCILED' | 'IGNORED';

export type TransactionOrigin = 'OFX_IMPORT' | 'SPREADSHEET_IMPORT' | 'MANUAL_CASH' | 'API_INTEGRATION' | 'SYSTEM_RECURRING';

/** Seções fixas da DRE gerencial */
export type DRESection = 'OPERATING_REVENUE' | 'OPERATING_COSTS' | 'OPERATING_EXPENSES' | 'INVESTING' | 'FINANCING';

export type PersonType = 'LEGAL' | 'NATURAL' | 'FOREIGN';

/** Papel do usuário na empresa */
export type UserRole = 'OWNER' | 'ADMIN' | 'FINANCIAL_OPERATOR' | 'CONSULTANT' | 'VIEWER';

export interface Company {
  id: string;
  personType: PersonType;
  code?: string | null;
  legalName: string;
  tradeName: string;
  cnpj: string; // CNPJ (PJ) ou CPF (PF), somente dígitos
  cei?: string | null;
  stateReg?: string | null;
  cityReg?: string | null;
  taxRegime: TaxRegime;
  email?: string | null;
  phone?: string | null;
  postalCode?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  district?: string | null;
  city?: string | null;
  cityIbgeCode?: string | null;
  state?: string | null;
  segment?: string | null;
  cnae?: string | null;
  cnaeDescription?: string | null;
  logoUrl?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'TRIAL' | 'SUSPENDED';
  // Configurações avançadas
  provisioningMonths: number;
  accrualBasis: boolean;
  costCentersEnabled: boolean;
  /** Rateio por categoria e centro de custo; juros/multa/desconto em categorias próprias */
  splitsEnabled: boolean;
  /** Marcar pagamentos agendados como "programado no banco" */
  bankScheduleEnabled: boolean;
  /** Papel do usuário logado nesta empresa */
  role?: UserRole;
}

/** Linha de rateio. Valor com sinal: negativo = categoria de natureza oposta (ex.: taxa num recebimento) */
export interface SplitLine {
  id: string;
  categoryId: string;
  costCenterId: string | null;
  amount: number;
  category: { name: string; type: 'INCOME' | 'EXPENSE' | 'TRANSFER' };
  costCenter: { name: string } | null;
}

/** Dados enviados para criar/editar uma empresa */
export type CompanyInput = Omit<Company, 'id' | 'status' | 'taxRegime' | 'tradeName' | 'provisioningMonths' | 'accrualBasis' | 'costCentersEnabled' | 'splitsEnabled' | 'bankScheduleEnabled' | 'role'> & {
  tradeName?: string | null;
  taxRegime?: TaxRegime | null;
};

export interface BankAccount {
  id: string;
  companyId: string;
  name: string;
  type: AccountType;
  bankCode: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  accountDigit?: string | null;
  holderType?: PersonType;
  initialBalanceDate?: string;
  currentBalance: number;
  initialBalance: number;
  color: string;
  unreconciledCount?: number;
  isActive?: boolean;
}

export interface Category {
  id: string;
  companyId: string;
  code?: string | null;
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  /** null = fora da DRE (ex.: transferência entre contas) */
  section: DRESection | null;
  /** Subgrupo (agrupa categorias dentro da seção) */
  isGroup: boolean;
  isSystem: boolean;
  isActive: boolean;
  orderIndex: number;
  color?: string;
  parentId?: string | null;
  usageCount?: number;
}

export type ContactType = 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' | 'PARTNER' | 'OTHER';

export interface ContactBankDetails {
  bankCode?: string | null;
  bankName?: string | null;
  agency?: string | null;
  accountNumber?: string | null;
  accountDigit?: string | null;
  accountType?: 'CHECKING' | 'SAVINGS' | null;
  pixKeyType?: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM' | null;
  pixKey?: string | null;
}

export interface Contact {
  id: string;
  companyId: string;
  name: string;
  tradeName?: string;
  document?: string;
  type: ContactType;
  personType?: PersonType;
  isActive?: boolean;
}

/** Contato completo (tela de Contatos) */
export interface ContactDetails {
  id: string;
  type: ContactType;
  personType: PersonType;
  name: string;
  tradeName: string | null;
  document: string | null;
  cityReg: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  contactPerson: string | null;
  website: string | null;
  postalCode: string | null;
  address: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  district: string | null;
  city: string | null;
  cityIbgeCode: string | null;
  state: string | null;
  country: string | null;
  bankDetails: ContactBankDetails | null;
  isActive: boolean;
  openAmount: number;
  overdueAmount: number;
}

export interface Transaction {
  id: string;
  companyId: string;
  bankAccountId: string;
  importBatchId?: string;
  categoryId?: string;
  costCenterId?: string;
  contactId?: string;
  type: TransactionType;
  amount: number;
  date: string; // YYYY-MM-DD
  description: string;
  customDescription?: string;
  fitid?: string;
  checknum?: string;
  reconciliationStatus: ReconciliationStatus;
  reconciledAt?: string;
  origin: TransactionOrigin;
  suggestedCategoryId?: string;
  suggestedContactId?: string;
  ruleMatchReason?: string;
  /** Contas a pagar/receber quitadas por esta linha */
  entryLinks?: EntryLink[];
  /** Conta em aberto provável (valor exato, data próxima) — sugestão para confirmar */
  matchSuggestion?: MatchSuggestion | null;
  /** Rateio feito direto na linha (sem conta vinculada) */
  splits?: SplitLine[];
  isTransfer?: boolean;
  /** Palpite: classificação da última linha conciliada com a mesma descrição */
  guess?: { categoryId: string; contactId: string | null; costCenterId: string | null } | null;
  /** Linha em aberto de outra conta com o mesmo valor em sentido oposto (provável transferência) */
  transferSuggestion?: { transactionId: string; bankAccountId: string; accountName: string; date: string; description: string } | null;
}

export interface ImportBatch {
  id: string;
  companyId: string;
  bankAccountId: string;
  fileName: string;
  fileType: 'OFX' | 'XLSX' | 'CSV';
  totalTransactions: number;
  reconciledCount: number;
  pendingCount: number;
  totalIncome: number;
  totalExpense: number;
  createdAt: string;
}

/** Dados enviados para criar uma conta bancária / caixinha / cartão */
export interface BankAccountInput {
  name: string;
  type: AccountType;
  bankCode?: string | null;
  bankName?: string | null;
  agency?: string | null;
  accountNumber?: string | null;
  accountDigit?: string | null;
  initialBalance: number;
  initialBalanceDate: string; // aaaa-mm-dd
  holderType: PersonType;
  color: string;
  isDefault?: boolean;
}

export interface EntryLink {
  settlementId: string;
  direction: 'RECEIVABLE' | 'PAYABLE';
  id: string;
  description: string;
  amount: number;
}

export interface MatchSuggestion {
  direction: 'RECEIVABLE' | 'PAYABLE';
  id: string;
  description: string;
  contactName: string | null;
  categoryName: string | null;
  dueDate: string;
  expectedDate: string | null;
  openAmount: number;
  exactAmount: boolean;
  daysApart: number;
}
