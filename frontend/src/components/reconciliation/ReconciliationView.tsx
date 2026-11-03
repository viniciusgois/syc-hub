import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, ChevronDown, FileSpreadsheet, FileText, Loader2, Sparkles } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { accountDetails } from '../../lib/accounts';
import { api, errorMessage } from '../../lib/api';
import { categoryChoices } from '../../lib/categories';
import { ENTRY_CONFIG, brDate, contactOptions, money } from '../../lib/entries';
import { ApiTransaction, toTransaction } from '../../lib/transactions';
import { Transaction } from '../../types';
import { AccountBadge } from '../accounts/AccountBadge';
import { ImportKind } from '../accounts/OFXDropzoneModal';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';
import { SearchSelect } from '../common/SearchSelect';
import { useCostCenters } from '../common/useCostCenters';
import { EntryDrawer } from '../entries/EntryDrawer';
import { CardAction, ReconcileCard } from './ReconcileCard';
import { QuickRuleModal } from './QuickRuleModal';
import { ReconcileDialog } from './ReconcileDialog';
import { SplitTransactionDialog } from './SplitTransactionDialog';

interface Filters {
  from: string;
  to: string;
  search: string;
  min: string;
  max: string;
  type: '' | 'CREDIT' | 'DEBIT';
  status: 'open' | 'ignored';
}

const EMPTY: Filters = { from: '', to: '', search: '', min: '', max: '', type: '', status: 'open' };
const GUESSES_KEY = 'syc.reconcile.guesses';

/** Conciliação (Nibo): movimentações importadas do banco × como entram no extrato do sistema */
export const ReconciliationView: React.FC<{
  accountId: string;
  onChangeAccount: (id: string) => void;
  onBack: () => void;
  onOpenUpload: (accountId?: string, kind?: ImportKind) => void;
}> = ({ accountId, onChangeAccount, onBack, onOpenUpload }) => {
  const { currentCompany, accounts, archivedAccounts, can, setActiveModule, refreshLedger, notify } = useCompany();
  const costCenters = useCostCenters();
  const account = [...accounts, ...archivedAccounts].find((a) => a.id === accountId)!;
  const [mode, setMode] = useState<'manual' | 'batch'>('manual');
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [order, setOrder] = useState<'date_asc' | 'date_desc' | 'amount_desc'>('date_asc');
  const [showGuesses, setShowGuesses] = useState(() => {
    try {
      return localStorage.getItem(GUESSES_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<'import' | 'account' | null>(null);
  const [dialog, setDialog] = useState<{ action: CardAction; tx: Transaction } | null>(null);
  const requestRef = useRef(0);

  // Recarrega quando muda a conta/filtros ou quando o razão é recarregado (qualquer conciliação muda os saldos)
  useEffect(() => {
    const params = new URLSearchParams({ bankAccountId: accountId, status: filters.status === 'open' ? 'PENDING,SUGGESTED' : 'IGNORED', order, pageSize: '200' });
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.min) params.set('min', filters.min.replace(/\./g, '').replace(',', '.'));
    if (filters.max) params.set('max', filters.max.replace(/\./g, '').replace(',', '.'));
    if (filters.type) params.set('type', filters.type);
    const ticket = ++requestRef.current;
    setLoading(true);
    setError(null);
    api
      .get<{ data: ApiTransaction[]; total: number }>(`/companies/${currentCompany.id}/transactions?${params}`)
      .then((res) => {
        if (ticket !== requestRef.current) return;
        setRows(res.data.map(toTransaction));
        setTotal(res.total);
      })
      .catch((err) => ticket === requestRef.current && setError(errorMessage(err)))
      .finally(() => ticket === requestRef.current && setLoading(false));
  }, [currentCompany.id, accountId, filters, order, accounts]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const toggleGuesses = () =>
    setShowGuesses((v) => {
      try {
        localStorage.setItem(GUESSES_KEY, v ? '0' : '1');
      } catch {
        // sem armazenamento: vale só nesta sessão
      }
      return !v;
    });

  const done = () => refreshLedger();

  const onAction = async (action: CardAction, tx: Transaction) => {
    if (action === 'restore') {
      try {
        await api.post(`/companies/${currentCompany.id}/transactions/${tx.id}/unreconcile`);
        notify('Movimentação restaurada');
        await refreshLedger();
      } catch (err) {
        notify(errorMessage(err), 'error');
      }
      return;
    }
    setDialog({ action, tx });
  };

  const ignore = async (tx: Transaction) => {
    try {
      await api.post(`/companies/${currentCompany.id}/transactions/${tx.id}/ignore`);
      notify('Movimentação descartada');
      setDialog(null);
      await refreshLedger();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const pendingTotal = account.unreconciledCount ?? 0;

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-800">
      {/* Cabeçalho */}
      <div className="px-6 pt-5 flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-medium text-slate-700 mr-auto lg:mr-0 lg:w-56">Conciliação</h1>
        <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm lg:mr-auto" role="radiogroup" aria-label="Modo">
          {(
            [
              ['manual', 'Manual'],
              ['batch', 'Em lote'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`px-5 h-9 rounded-full ${mode === value ? 'bg-white shadow text-slate-800' : 'text-slate-700 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onBack} className="text-sm text-nibo-blue hover:underline flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Voltar para o extrato
        </button>
        {can('ADMIN') && (
          <button type="button" onClick={() => setActiveModule('config-regras')} className="text-sm text-nibo-blue hover:underline flex items-center gap-1.5">
            <BookOpen className="w-4 h-4" /> Regras de conciliação
          </button>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => (m === 'import' ? null : 'import'));
            }}
            aria-expanded={menu === 'import'}
            className="h-9 px-4 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2"
          >
            Importar <ChevronDown className="w-4 h-4" />
          </button>
          {menu === 'import' && (
            <div className="absolute right-0 mt-1 w-60 bg-white border border-slate-200 rounded shadow-lg z-30 py-2" role="menu">
              <p className="px-4 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">Conta bancária</p>
              <button type="button" role="menuitem" onClick={() => onOpenUpload(accountId, 'OFX')} className="w-full px-4 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-500" /> Extrato em OFX
              </button>
              <button type="button" role="menuitem" onClick={() => onOpenUpload(accountId, 'SHEET')} className="w-full px-4 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-slate-500" /> Extrato em planilha
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Conta */}
      <div className="px-6 mt-4 flex items-center gap-3">
        <AccountBadge account={account} />
        <div>
          <p className="text-base text-slate-800">{account.name}</p>
          <p className="text-xs text-slate-500 flex items-center gap-2">
            {account.agency ? accountDetails(account) : null}
            <span className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu((m) => (m === 'account' ? null : 'account'));
                }}
                aria-expanded={menu === 'account'}
                className="text-sm text-nibo-blue hover:underline flex items-center gap-0.5"
              >
                Alterar conta <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {menu === 'account' && (
                <span className="absolute left-0 mt-1 w-72 bg-white border border-slate-200 rounded shadow-lg z-30 py-1 block" role="menu">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="menuitem"
                      onClick={() => onChangeAccount(a.id)}
                      className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between gap-3 hover:bg-slate-50 ${a.id === accountId ? 'text-nibo-blue font-medium' : 'text-slate-800'}`}
                    >
                      <span className="truncate">{a.name}</span>
                      {(a.unreconciledCount ?? 0) > 0 && <span className="text-[11px] text-amber-700">{a.unreconciledCount} a conciliar</span>}
                    </button>
                  ))}
                </span>
              )}
            </span>
          </p>
        </div>
      </div>

      {/* Filtros */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
        className="px-6 mt-5 flex flex-wrap items-end gap-4"
      >
        <div>
          <p className="text-sm font-medium text-slate-800 mb-1.5">Período</p>
          <div className="flex gap-2">
            <input type="date" aria-label="De" value={draft.from} onChange={(e) => set('from', e.target.value)} className={`${fieldClass()} w-40`} />
            <input type="date" aria-label="Até" value={draft.to} onChange={(e) => set('to', e.target.value)} className={`${fieldClass()} w-40`} />
          </div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="rc-search" className="block text-sm font-medium text-slate-800 mb-1.5">
            Descrição ou nome
          </label>
          <input id="rc-search" value={draft.search} onChange={(e) => set('search', e.target.value)} className={fieldClass()} />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-800 mb-1.5">Valor</p>
          <div className="flex gap-2">
            <input inputMode="decimal" aria-label="Valor mínimo" placeholder="Min" value={draft.min} onChange={(e) => set('min', e.target.value)} className={`${fieldClass()} w-24`} />
            <input inputMode="decimal" aria-label="Valor máximo" placeholder="Max" value={draft.max} onChange={(e) => set('max', e.target.value)} className={`${fieldClass()} w-24`} />
          </div>
        </div>
        <div className="w-40">
          <label htmlFor="rc-type" className="block text-sm font-medium text-slate-800 mb-1.5">
            Tipo
          </label>
          <select id="rc-type" value={draft.type} onChange={(e) => set('type', e.target.value as Filters['type'])} className={fieldClass()}>
            <option value="">Todos</option>
            <option value="CREDIT">Entradas</option>
            <option value="DEBIT">Saídas</option>
          </select>
        </div>
        <div className="w-40">
          <label htmlFor="rc-status" className="block text-sm font-medium text-slate-800 mb-1.5">
            Mostrar
          </label>
          <select id="rc-status" value={draft.status} onChange={(e) => set('status', e.target.value as Filters['status'])} className={fieldClass()}>
            <option value="open">A conciliar</option>
            <option value="ignored">Descartadas</option>
          </select>
        </div>
        <button type="submit" className="h-10 px-5 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight">
          Filtrar
        </button>
      </form>

      {/* Barra das duas colunas */}
      <div className="mx-6 mt-5 rounded bg-slate-100 flex flex-col md:flex-row md:items-center">
        <div className="md:w-[340px] shrink-0 px-4 h-11 flex items-center justify-between gap-3">
          <span className="text-[15px] text-slate-800">Movimentações importadas</span>
          <select aria-label="Ordenar" value={order} onChange={(e) => setOrder(e.target.value as typeof order)} className="h-8 px-2 rounded bg-transparent text-sm text-slate-700 focus:outline-none">
            <option value="date_asc">Por data</option>
            <option value="date_desc">Mais recentes</option>
            <option value="amount_desc">Por valor</option>
          </select>
        </div>
        <div className="flex-1 px-4 h-11 flex items-center justify-between gap-3 bg-slate-200/60 rounded-r">
          <span className="text-[15px] text-slate-800">Extrato no SYC Hub</span>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer" title="Preenche a categoria e o nome com a regra ou com a última conciliação da mesma descrição">
            <button
              type="button"
              role="switch"
              aria-checked={showGuesses}
              onClick={toggleGuesses}
              className={`w-9 h-5 rounded-full relative transition-colors ${showGuesses ? 'bg-nibo-blue' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${showGuesses ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            Exibir palpites
          </label>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        <p className="text-xs text-slate-500 flex items-center gap-2">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-nibo-blue" />}
          {filters.status === 'open'
            ? `${total} movimentação(ões) a conciliar${total !== pendingTotal ? ` (de ${pendingTotal} nesta conta)` : ''}${total > 200 ? ' — mostrando as 200 primeiras' : ''}`
            : `${total} movimentação(ões) descartada(s)`}
        </p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {rows?.length === 0 && (
          <div className="py-12 text-center text-slate-500">
            <p className="text-sm">{filters.status === 'open' ? 'Nenhuma movimentação a conciliar nesta conta.' : 'Nenhuma movimentação descartada.'}</p>
            {filters.status === 'open' && <p className="text-xs mt-1">Importe o extrato do banco pelo botão Importar (OFX ou planilha).</p>}
          </div>
        )}
        {rows && rows.length > 0 && mode === 'manual' &&
          rows.map((tx) => <ReconcileCard key={`${tx.id}-${showGuesses}-${tx.reconciliationStatus}-${tx.categoryId ?? ''}`} tx={tx} showGuesses={showGuesses} costCenters={costCenters} onAction={onAction} onDone={done} />)}
        {rows && rows.length > 0 && mode === 'batch' && <BatchTable rows={rows} showGuesses={showGuesses} costCenters={costCenters} onDone={done} disabled={filters.status !== 'open'} />}
      </div>

      {dialog?.action === 'rule' && <QuickRuleModal tx={dialog.tx} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.action === 'search' && <ReconcileDialog tx={dialog.tx} onClose={() => setDialog(null)} />}
      {dialog?.action === 'split' && <SplitTransactionDialog tx={dialog.tx} onClose={() => setDialog(null)} />}
      {dialog?.action === 'detail' && (
        <EntryDrawer
          config={ENTRY_CONFIG[dialog.tx.type === 'CREDIT' ? 'RECEIVABLE' : 'PAYABLE']}
          mode="now"
          isOpen
          statementTx={{
            id: dialog.tx.id,
            bankAccountId: dialog.tx.bankAccountId,
            date: dialog.tx.date,
            amount: dialog.tx.amount,
            description: dialog.tx.customDescription || dialog.tx.description,
            contactId: dialog.tx.contactId,
            categoryId: dialog.tx.categoryId,
            costCenterId: dialog.tx.costCenterId,
          }}
          onClose={() => setDialog(null)}
          onChanged={done}
        />
      )}
      {dialog?.action === 'ignore' && (
        <Modal
          title="Descartar movimentação"
          onClose={() => setDialog(null)}
          footer={
            <>
              <LinkButton onClick={() => setDialog(null)}>Cancelar</LinkButton>
              <PrimaryButton onClick={() => ignore(dialog.tx)}>Descartar</PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            {brDate(dialog.tx.date)} · {dialog.tx.description} · R$ {money(dialog.tx.amount)}
          </p>
          <p className="text-sm text-slate-600 mt-3">
            Use para linhas duplicadas ou que não devem entrar no sistema. A movimentação sai da conciliação e não entra no saldo; dá para restaurar em "Mostrar: Descartadas".
          </p>
        </Modal>
      )}
    </div>
  );
};

/** Em lote: marcar várias movimentações e aplicar a mesma classificação (ou os palpites de cada uma) */
const BatchTable: React.FC<{ rows: Transaction[]; showGuesses: boolean; costCenters: { id: string; name: string }[]; onDone: () => Promise<void>; disabled: boolean }> = ({
  rows,
  showGuesses,
  costCenters,
  onDone,
  disabled,
}) => {
  const { currentCompany, categories, contacts, notify } = useCompany();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ categoryId: '', contactId: '', costCenterId: '' });
  const [busy, setBusy] = useState(false);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const catOptions = useMemo(() => categoryChoices(categories).map((o) => ({ value: o.value, label: `${o.type === 'INCOME' ? '↑' : '↓'} ${o.label}`, group: o.group })), [categories]);
  const contOptions = useMemo(() => [...contactOptions(contacts, 'RECEIVABLE'), ...contactOptions(contacts, 'PAYABLE')].filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i), [contacts]);

  const guessOf = (t: Transaction) =>
    t.reconciliationStatus === 'SUGGESTED' && t.suggestedCategoryId
      ? { categoryId: t.suggestedCategoryId, contactId: t.suggestedContactId ?? null, costCenterId: null }
      : showGuesses && t.guess
        ? t.guess
        : null;

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    const chosen = rows.filter((r) => selected.has(r.id));
    // Agrupa por classificação: a escolhida na barra vale para todas; sem ela, cada uma usa o seu palpite
    const groups = new Map<string, { ids: string[]; categoryId: string; contactId: string | null; costCenterId: string | null }>();
    let skipped = 0;
    for (const t of chosen) {
      const g = form.categoryId ? { categoryId: form.categoryId, contactId: form.contactId || null, costCenterId: form.costCenterId || null } : guessOf(t);
      if (!g) {
        skipped++;
        continue;
      }
      const key = `${g.categoryId}|${g.contactId ?? ''}|${g.costCenterId ?? ''}`;
      const group = groups.get(key) ?? { ids: [], categoryId: g.categoryId, contactId: g.contactId, costCenterId: g.costCenterId };
      group.ids.push(t.id);
      groups.set(key, group);
    }
    if (!groups.size) return notify('Escolha a categoria na barra (ou marque linhas que tenham palpite)', 'error');
    setBusy(true);
    try {
      let done = 0;
      for (const g of groups.values()) {
        const res = await api.post<{ reconciled: number }>(`/companies/${currentCompany.id}/transactions/reconcile-bulk`, {
          ids: g.ids,
          categoryId: g.categoryId,
          contactId: g.contactId,
          ...(g.costCenterId && { costCenterId: g.costCenterId }),
        });
        done += res.reconciled;
      }
      notify(`${done} movimentação(ões) conciliada(s)${skipped ? ` · ${skipped} sem categoria ficaram de fora` : ''}`);
      setSelected(new Set());
      await onDone();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {!disabled && (
        <div className="sticky top-0 z-10 p-3 rounded border border-slate-200 bg-white shadow-sm flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-700 w-28">{selected.size} selecionada(s)</span>
          <div className="w-72">
            <SearchSelect value={form.categoryId} onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))} options={catOptions} placeholder="Categoria (vazio = palpites)" clearable size="sm" />
          </div>
          <div className="w-60">
            <SearchSelect value={form.contactId} onChange={(v) => setForm((f) => ({ ...f, contactId: v }))} options={contOptions} placeholder="Nome" clearable size="sm" />
          </div>
          {costCenters.length > 0 && (
            <select aria-label="Centro de custo" value={form.costCenterId} onChange={(e) => setForm((f) => ({ ...f, costCenterId: e.target.value }))} className="h-9 px-3 rounded border border-slate-300 text-sm">
              <option value="">Centro de custo</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <PrimaryButton onClick={apply} disabled={busy || !selected.size} className="ml-auto h-9">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Conciliar selecionadas
          </PrimaryButton>
        </div>
      )}
      <div className="border border-slate-200 rounded overflow-x-auto">
        <table className="w-full text-[13px] text-slate-700">
          <thead className="bg-slate-100">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input type="checkbox" aria-label="Selecionar todas" disabled={disabled} checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} className="w-4 h-4 accent-nibo-blue" />
              </th>
              <th className="px-3 py-2.5 text-left font-medium w-28">Data</th>
              <th className="px-3 py-2.5 text-left font-medium">Descrição</th>
              <th className="px-3 py-2.5 text-left font-medium">Palpite / sugestão</th>
              <th className="px-3 py-2.5 text-right font-medium">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => {
              const g = guessOf(t);
              const isCredit = t.type === 'CREDIT';
              return (
                <tr key={t.id} className={selected.has(t.id) ? 'bg-nibo-blueLight' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2.5 text-center">
                    <input type="checkbox" aria-label={`Selecionar ${t.description}`} disabled={disabled} checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="w-4 h-4 accent-nibo-blue" />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{brDate(t.date)}</td>
                  <td className="px-3 py-2.5">
                    <span className="block max-w-[420px] truncate uppercase" title={t.description}>
                      {t.description}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {g ? (
                      <span className="flex items-center gap-1 text-amber-800">
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate max-w-[260px]">{catName.get(g.categoryId) ?? '—'}</span>
                      </span>
                    ) : t.matchSuggestion ? (
                      <span className="text-slate-500 text-xs">Conta agendada: concilie no modo Manual</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                    <span className="inline-flex items-center gap-0.5">
                      {isCredit ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                      {money(t.amount)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
