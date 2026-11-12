import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiTransaction, toTransaction } from '../lib/transactions';
import { Loader2, WifiOff, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { Company, BankAccount, BankAccountInput, Category, Contact, Transaction, ReconciliationStatus, TransactionType, UserRole } from '../types';
import { api, errorMessage } from '../lib/api';
import { CreateCompanyModal } from '../components/companies/CreateCompanyModal';

// ----------------------------------------------------------------------------
// Tipos de importação de extrato
// ----------------------------------------------------------------------------

export type ImportRequest = { bankAccountId: string; fileName: string } & (
  | { kind: 'OFX'; content: string }
  | { kind: 'ROWS'; fileType: 'XLSX' | 'CSV' | 'PDF'; rows: { date: string; description: string; amount: number }[]; /** Hash do PDF original (evita importar o mesmo arquivo duas vezes) */ fileHash?: string }
);

export interface ImportPreviewLine {
  date: string;
  description: string;
  type: TransactionType;
  amount: number;
  fitid: string;
  duplicate: boolean;
  ruleName: string | null;
  /** Descrição da baixa (recebimento/pagamento já registrado) que esta linha vai conciliar */
  matchedSettlement?: string | null;
  /** Conta em aberto provável (só sugestão; confirmar no extrato) */
  entryMatch?: string | null;
  reconciliationStatus: ReconciliationStatus | null;
}

export interface ImportResult {
  imported: number;
  skippedDuplicates: number;
  matchedSettlements?: number;
  suggested: number;
  autoReconciled: number;
  totalIncome: number;
  totalExpense: number;
  warnings: string[];
  preview?: ImportPreviewLine[];
}

type ToastKind = 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/** Hierarquia dos papéis: consultor e somente leitura só visualizam */
const ROLE_RANK: Record<UserRole, number> = { VIEWER: 0, CONSULTANT: 0, FINANCIAL_OPERATOR: 1, ADMIN: 2, OWNER: 3 };

interface CompanyContextType {
  currentCompany: Company;
  /** Papel do usuário na empresa atual */
  role: UserRole;
  /** O papel atual alcança `min`? (operador lança e concilia; administrador configura) */
  can: (min: UserRole) => boolean;
  companies: Company[];
  setCurrentCompanyId: (id: string) => void;
  addCompany: (company: Company) => void;
  /** Atualiza a empresa na lista (após editar dados ou configurações) */
  updateCompany: (company: Company) => void;
  /** Remove a empresa excluída e seleciona outra */
  removeCompany: (id: string, opts?: { keepModule?: boolean }) => void;
  accounts: BankAccount[];
  allAccounts: BankAccount[];
  /** Contas arquivadas (inativas): só aparecem em "Ver arquivadas" */
  archivedAccounts: BankAccount[];
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  createBankAccount: (input: BankAccountInput) => Promise<BankAccount>;
  categories: Category[];
  contacts: Contact[];
  reloadContacts: () => Promise<void>;
  reloadCategories: () => Promise<void>;
  transactions: Transaction[];
  isLoading: boolean;
  activeModule: string;
  setActiveModule: (module: string) => void;
  reconcileTransaction: (txId: string, categoryId?: string, contactId?: string) => Promise<void>;
  updateTransaction: (txId: string, patch: { categoryId?: string | null; contactId?: string | null }) => Promise<void>;
  unreconcileTransaction: (txId: string) => Promise<void>;
  ignoreTransaction: (txId: string) => Promise<void>;
  /** Concilia a linha do extrato com contas a pagar/receber em aberto */
  matchTransaction: (
    txId: string,
    entries: { direction: 'RECEIVABLE' | 'PAYABLE'; id: string }[],
    mode?: 'ADJUST' | 'PARTIAL',
    differenceCategoryId?: string | null,
  ) => Promise<boolean>;
  batchReconcile: (txIds: string[]) => Promise<void>;
  previewImport: (req: ImportRequest) => Promise<ImportResult>;
  importStatement: (req: ImportRequest) => Promise<ImportResult>;
  refresh: () => Promise<void>;
  /** Recarrega saldos das contas e transações (após baixas, importações...) */
  refreshLedger: () => Promise<void>;
  notify: (message: string, kind?: ToastKind) => void;
  stats: {
    totalBalance: number;
    totalPending: number;
    totalReconciled: number;
    totalSuggested: number;
    reconciliationRate: number;
    monthlyIncome: number;
    monthlyExpense: number;
  };
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

// ----------------------------------------------------------------------------
// Adaptadores API -> tipos do frontend
// ----------------------------------------------------------------------------

type Nullable<T> = { [K in keyof T]: T[K] | null };

const toAccount = (a: Nullable<BankAccount> & { isActive: boolean }): BankAccount => ({
  ...a,
  bankCode: a.bankCode ?? '',
  bankName: a.bankName ?? '',
  agency: a.agency ?? '',
  accountNumber: a.accountNumber ?? '',
  color: a.color ?? '#3b82f6',
} as BankAccount);

const toCategory = (c: Nullable<Category>): Category => ({
  ...c,
  code: c.code ?? '',
  color: c.color ?? undefined,
  parentId: c.parentId ?? undefined,
} as Category);

const toContact = (c: Nullable<Contact>): Contact => ({
  ...c,
  tradeName: c.tradeName ?? undefined,
  document: c.document ?? undefined,
} as Contact);

const STORAGE_KEY = 'syc.currentCompanyId';
const readStoredCompanyId = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

// ----------------------------------------------------------------------------
// Provider
// ----------------------------------------------------------------------------

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [currentCompanyId, setCurrentCompanyIdState] = useState<string | null>(readStoredCompanyId);
  const [allAccounts, setAllAccounts] = useState<BankAccount[]>([]);
  const [archivedAccounts, setArchivedAccounts] = useState<BankAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [activeModule, setActiveModule] = useState<string>('resumo');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const loadToken = useRef(0);

  const notify = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const loadCompanies = useCallback(async () => {
    setBootError(null);
    try {
      setCompanies(await api.get<Company[]>('/companies'));
    } catch (err) {
      setBootError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const currentCompany = useMemo(() => {
    if (!companies?.length) return null;
    return companies.find((c) => c.id === currentCompanyId) ?? companies[0];
  }, [companies, currentCompanyId]);

  const setCurrentCompanyId = useCallback((id: string) => {
    setCurrentCompanyIdState(id);
    setSelectedAccountId('all');
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // armazenamento indisponível (aba anônima etc.): segue sem lembrar a empresa
    }
  }, []);

  const addCompany = useCallback(
    (company: Company) => {
      setCompanies((prev) => [...(prev ?? []), company].sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'pt-BR')));
      setCurrentCompanyId(company.id);
    },
    [setCurrentCompanyId],
  );

  const updateCompany = useCallback((company: Company) => {
    setCompanies((prev) => (prev ?? []).map((c) => (c.id === company.id ? { ...c, ...company } : c)));
  }, []);

  /** Tira a empresa da lista; se era a selecionada, volta para a primeira. `keepModule` mantém a tela atual (ex.: SYC Empresas) */
  const removeCompany = useCallback(
    (id: string, opts?: { keepModule?: boolean }) => {
      setCompanies((prev) => (prev ?? []).filter((c) => c.id !== id));
      if (!opts?.keepModule) setActiveModule('resumo');
      if (currentCompanyId !== null && currentCompanyId !== id) return;
      setCurrentCompanyIdState(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // armazenamento indisponível
      }
    },
    [currentCompanyId],
  );

  const companyPath = currentCompany ? `/companies/${currentCompany.id}` : '';
  const role: UserRole = currentCompany?.role ?? 'VIEWER';
  const can = useCallback((min: UserRole) => ROLE_RANK[role] >= ROLE_RANK[min], [role]);

  /** Recarrega contas (saldos/pendências) e transações após qualquer mudança */
  const reloadLedger = useCallback(async () => {
    if (!companyPath) return;
    const token = loadToken.current;
    const [accs, txs] = await Promise.all([
      api.get<Parameters<typeof toAccount>[0][]>(`${companyPath}/bank-accounts`),
      // TODO: paginar/filtrar por período quando o volume crescer
      api.get<{ data: ApiTransaction[] }>(`${companyPath}/transactions?pageSize=500`),
    ]);
    if (token !== loadToken.current) return; // empresa trocou durante a requisição
    setAllAccounts(accs.filter((a) => a.isActive).map(toAccount));
    setArchivedAccounts(accs.filter((a) => !a.isActive).map(toAccount));
    setTransactions(txs.data.map(toTransaction));
  }, [companyPath]);

  const refresh = useCallback(async () => {
    if (!companyPath) return;
    const token = ++loadToken.current;
    setIsLoading(true);
    try {
      const [cats, conts] = await Promise.all([
        api.get<Parameters<typeof toCategory>[0][]>(`${companyPath}/categories`),
        api.get<Parameters<typeof toContact>[0][]>(`${companyPath}/contacts`),
        reloadLedger(),
      ]);
      if (token !== loadToken.current) return;
      setCategories(cats.filter((c) => (c as { isActive?: boolean }).isActive !== false).map(toCategory));
      setContacts(conts.filter((c) => (c as { isActive?: boolean }).isActive !== false).map(toContact));
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      if (token === loadToken.current) setIsLoading(false);
    }
  }, [companyPath, reloadLedger, notify]);

  /** Recarrega o plano de contas (usado nos seletores de categoria) */
  const reloadCategories = useCallback(async () => {
    if (!companyPath) return;
    const cats = await api.get<Parameters<typeof toCategory>[0][]>(`${companyPath}/categories`);
    setCategories(cats.map(toCategory));
  }, [companyPath]);

  /** Recarrega contatos ativos (usados nos seletores da conciliação) */
  const reloadContacts = useCallback(async () => {
    if (!companyPath) return;
    const conts = await api.get<Parameters<typeof toContact>[0][]>(`${companyPath}/contacts`);
    setContacts(conts.filter((c) => (c as { isActive?: boolean }).isActive !== false).map(toContact));
  }, [companyPath]);

  useEffect(() => {
    setAllAccounts([]);
    setTransactions([]);
    setCategories([]);
    setContacts([]);
    refresh();
  }, [refresh]);

  /** Executa uma ação na API, recarrega o razão e mostra o erro (se houver) */
  const run = useCallback(
    async (action: () => Promise<unknown>, successMessage?: string) => {
      try {
        await action();
        await reloadLedger();
        if (successMessage) notify(successMessage);
      } catch (err) {
        notify(errorMessage(err), 'error');
      }
    },
    [reloadLedger, notify],
  );

  const reconcileTransaction = useCallback(
    (txId: string, categoryId?: string, contactId?: string) =>
      run(() =>
        api.post(`${companyPath}/transactions/${txId}/reconcile`, {
          ...(categoryId !== undefined && { categoryId: categoryId || null }),
          ...(contactId !== undefined && { contactId: contactId || null }),
        }),
      ),
    [run, companyPath],
  );

  const updateTransaction = useCallback(
    (txId: string, patch: { categoryId?: string | null; contactId?: string | null }) =>
      run(() => api.patch(`${companyPath}/transactions/${txId}`, patch)),
    [run, companyPath],
  );

  const unreconcileTransaction = useCallback(
    (txId: string) => run(() => api.post(`${companyPath}/transactions/${txId}/unreconcile`)),
    [run, companyPath],
  );

  const ignoreTransaction = useCallback(
    (txId: string) => run(() => api.post(`${companyPath}/transactions/${txId}/ignore`), 'Transação ignorada'),
    [run, companyPath],
  );

  const matchTransaction = useCallback(
    async (txId: string, entries: { direction: 'RECEIVABLE' | 'PAYABLE'; id: string }[], mode: 'ADJUST' | 'PARTIAL' = 'ADJUST', differenceCategoryId?: string | null) => {
      try {
        await api.post(`${companyPath}/transactions/${txId}/match`, { entries, mode, differenceCategoryId });
        await reloadLedger();
        notify(entries.length > 1 ? `Linha conciliada com ${entries.length} lançamentos` : 'Linha conciliada com a conta');
        return true;
      } catch (err) {
        notify(errorMessage(err), 'error');
        return false;
      }
    },
    [companyPath, reloadLedger, notify],
  );

  const batchReconcile = useCallback(
    async (txIds: string[]) => {
      // Só concilia em lote o que já tem categoria (sugestão de regra ou escolha manual)
      const ready = transactions.filter((t) => txIds.includes(t.id) && t.categoryId && t.reconciliationStatus !== 'IGNORED');
      const skipped = txIds.length - ready.length;
      if (!ready.length) {
        notify('Selecione transações que já tenham categoria para conciliar em lote', 'error');
        return;
      }
      await run(
        () => api.post(`${companyPath}/transactions/reconcile-bulk`, { ids: ready.map((t) => t.id) }),
        `${ready.length} transações conciliadas${skipped ? ` (${skipped} sem categoria ficaram pendentes)` : ''}`,
      );
    },
    [run, companyPath, transactions, notify],
  );

  const sendImport = useCallback(
    (req: ImportRequest, dryRun: boolean) =>
      req.kind === 'OFX'
        ? api.post<ImportResult>(`${companyPath}/imports/ofx`, {
            bankAccountId: req.bankAccountId,
            fileName: req.fileName,
            content: req.content,
            dryRun,
          })
        : api.post<ImportResult>(`${companyPath}/imports/rows`, {
            bankAccountId: req.bankAccountId,
            fileName: req.fileName,
            fileType: req.fileType,
            rows: req.rows,
            fileHash: req.fileHash,
            dryRun,
          }),
    [companyPath],
  );

  /** Cria a conta, recarrega saldos e seleciona a nova conta */
  const createBankAccount = useCallback(
    async (input: BankAccountInput) => {
      const created = toAccount(await api.post<Parameters<typeof toAccount>[0]>(`${companyPath}/bank-accounts`, input));
      await reloadLedger();
      setSelectedAccountId(created.id);
      return created;
    },
    [companyPath, reloadLedger],
  );

  const previewImport = useCallback((req: ImportRequest) => sendImport(req, true), [sendImport]);

  const importStatement = useCallback(
    async (req: ImportRequest) => {
      const result = await sendImport(req, false);
      await reloadLedger();
      return result;
    },
    [sendImport, reloadLedger],
  );

  const accounts = allAccounts;

  const stats = useMemo(() => {
    const totalBalance = accounts.reduce((acc, a) => acc + a.currentBalance, 0);
    const totalPending = transactions.filter((t) => t.reconciliationStatus === 'PENDING').length;
    const totalSuggested = transactions.filter((t) => t.reconciliationStatus === 'SUGGESTED').length;
    const totalReconciled = transactions.filter((t) => t.reconciliationStatus === 'RECONCILED').length;
    const totalItems = transactions.filter((t) => t.reconciliationStatus !== 'IGNORED').length;
    const reconciliationRate = totalItems > 0 ? Math.round((totalReconciled / totalItems) * 100) : 100;
    const sumOf = (type: TransactionType) =>
      transactions.filter((t) => t.type === type && t.reconciliationStatus !== 'IGNORED').reduce((sum, t) => sum + t.amount, 0);

    return {
      totalBalance,
      totalPending,
      totalReconciled,
      totalSuggested,
      reconciliationRate,
      monthlyIncome: sumOf('CREDIT'),
      monthlyExpense: sumOf('DEBIT'),
    };
  }, [accounts, transactions]);

  // --------------------------------------------------------------------------
  // Estados de inicialização: carregando, API fora do ar, nenhuma empresa
  // --------------------------------------------------------------------------

  const toastLayer = <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />;

  if (bootError) {
    return (
      <FullScreenMessage>
        <WifiOff className="w-8 h-8 text-slate-400" />
        <p className="text-sm font-semibold text-slate-800">Não foi possível carregar o SYC Hub</p>
        <p className="text-xs text-slate-500 max-w-sm text-center">{bootError}</p>
        <button
          onClick={loadCompanies}
          className="mt-2 px-4 py-2 rounded text-xs font-semibold bg-nibo-blue hover:bg-nibo-blueHover text-white"
        >
          Tentar novamente
        </button>
      </FullScreenMessage>
    );
  }

  if (!companies) {
    return (
      <FullScreenMessage>
        <Loader2 className="w-6 h-6 text-nibo-blue animate-spin" />
        <p className="text-xs text-slate-500">Carregando empresas...</p>
      </FullScreenMessage>
    );
  }

  if (!currentCompany) {
    return (
      <FullScreenMessage>
        <p className="text-base font-semibold text-slate-800">Bem-vindo ao SYC Hub</p>
        <p className="text-xs text-slate-500">Cadastre a primeira empresa para começar.</p>
        <CreateCompanyModal isOpen onClose={() => undefined} onCreated={addCompany} />
        {toastLayer}
      </FullScreenMessage>
    );
  }

  return (
    <CompanyContext.Provider
      value={{
        currentCompany,
        role,
        can,
        companies,
        setCurrentCompanyId,
        addCompany,
        updateCompany,
        removeCompany,
        accounts,
        allAccounts,
        archivedAccounts,
        selectedAccountId,
        setSelectedAccountId,
        createBankAccount,
        categories,
        contacts,
        reloadContacts,
        reloadCategories,
        transactions,
        isLoading,
        activeModule,
        setActiveModule,
        reconcileTransaction,
        updateTransaction,
        unreconcileTransaction,
        ignoreTransaction,
        matchTransaction,
        batchReconcile,
        previewImport,
        importStatement,
        refresh,
        refreshLedger: reloadLedger,
        notify,
        stats,
      }}
    >
      {children}
      {toastLayer}
    </CompanyContext.Provider>
  );
};

const FullScreenMessage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="h-screen w-full bg-nibo-bg flex flex-col items-center justify-center gap-2 font-sans">{children}</div>
);

const ToastStack: React.FC<{ toasts: Toast[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => (
  <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
    {toasts.map((t) => (
      <div
        key={t.id}
        role={t.kind === 'error' ? 'alert' : 'status'}
        className={`flex items-start gap-2 px-3.5 py-2.5 rounded-md shadow-lg border text-xs bg-white ${
          t.kind === 'error' ? 'border-rose-200 text-rose-800' : 'border-emerald-200 text-emerald-800'
        }`}
      >
        {t.kind === 'error' ? (
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-px" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-px" />
        )}
        <span className="flex-1">{t.message}</span>
        <button onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-600" aria-label="Fechar aviso">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ))}
  </div>
);

export const useCompany = () => {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany deve ser usado dentro de CompanyProvider');
  }
  return context;
};
