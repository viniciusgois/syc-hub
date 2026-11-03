import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Printer, Star, ChevronDown, ChevronUp, Loader2, Split, Landmark } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { EntryConfig, EntryRow, brDate, categoryOptions, contactOptions, money } from '../../lib/entries';
import { splitLabel, splitTooltip } from '../../lib/splits';
import { MoneyInput } from '../common/MoneyInput';
import { SearchSelect } from '../common/SearchSelect';
import { EntryDrawer, EntryDrawerMode } from './EntryDrawer';

type SortKey = 'dueDate' | 'name' | 'description' | 'ref' | 'open';
type StatusFilter = 'open' | 'settled' | 'lost' | 'all';

interface Filters {
  from: string;
  to: string;
  contactId: string;
  search: string;
  min: string;
  max: string;
  categoryId: string;
  status: StatusFilter;
}

const EMPTY_FILTERS: Filters = { from: '', to: '', contactId: '', search: '', min: '', max: '', categoryId: '', status: 'open' };

const inputClass = 'w-full h-10 px-3 rounded border border-slate-300 text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight';

const SortHeader: React.FC<{ k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; onToggle: (k: SortKey) => void; className?: string }> = ({
  k,
  label,
  sort,
  onToggle,
  className = '',
}) => (
  <button
    type="button"
    onClick={() => onToggle(k)}
    className={`inline-flex items-center gap-1 font-medium ${sort.key === k ? 'text-nibo-blue' : 'text-slate-700'} ${className}`}
  >
    {sort.key === k && sort.dir === -1 ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
    {label}
  </button>
);

export const EntriesView: React.FC<{ config: EntryConfig; openScheduleOnMount?: boolean; onScheduleClosed?: () => void }> = ({
  config,
  openScheduleOnMount,
  onScheduleClosed,
}) => {
  const { currentCompany, accounts, categories, contacts, notify, refreshLedger } = useCompany();
  const base = `/companies/${currentCompany.id}/${config.endpoint}`;

  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<EntryRow[] | null>(null);
  const [totals, setTotals] = useState({ open: 0, overdue: 0, count: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'dueDate', dir: 1 });
  const [selected, setSelected] = useState<Record<string, { amount: number; date: string }>>({});
  const [bankAccountId, setBankAccountId] = useState('');
  const [settleDate, setSettleDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; mode: EntryDrawerMode; id?: string }>({
    open: !!openScheduleOnMount,
    mode: 'schedule',
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status: filters.status });
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.contactId) params.set('contactId', filters.contactId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.search) params.set('search', filters.search);
    if (filters.min) params.set('min', filters.min.replace(',', '.'));
    if (filters.max) params.set('max', filters.max.replace(',', '.'));
    try {
      setLoadError(null);
      const res = await api.get<{ data: EntryRow[]; totals: typeof totals }>(`${base}?${params}`);
      setRows(res.data);
      setTotals(res.totals);
      setSelected((sel) => Object.fromEntries(Object.entries(sel).filter(([id]) => res.data.some((r) => r.id === id && r.openAmount > 0))));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [base, filters]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (accounts.length === 1) setBankAccountId(accounts[0].id);
  }, [accounts]);

  const sorted = useMemo(() => {
    const key = (r: EntryRow): string | number =>
      ({ dueDate: r.dueDate, name: r.contact?.name ?? '', description: r.displayDescription, ref: r.documentNumber ?? '', open: r.openAmount })[sort.key];
    return [...(rows ?? [])].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (typeof ka === 'number' ? ka - (kb as number) : String(ka).localeCompare(String(kb), 'pt-BR')) * sort.dir;
    });
  }, [rows, sort]);

  const toggleSort = (k: SortKey) => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : 1 }));
  const selectable = (r: EntryRow) => r.status === 'PENDING' && r.openAmount > 0;
  const selectedIds = Object.keys(selected);
  const totalToSettle = Object.values(selected).reduce((s, v) => s + v.amount, 0);

  const toggleRow = (r: EntryRow, on: boolean) =>
    setSelected((sel) => {
      const next = { ...sel };
      if (on) next[r.id] = sel[r.id] ?? { amount: r.openAmount, date: '' };
      else delete next[r.id];
      return next;
    });

  const allSelectable = sorted.filter(selectable);
  const allChecked = allSelectable.length > 0 && allSelectable.every((r) => selected[r.id]);

  const toggleStar = async (r: EntryRow) => {
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, isStarred: !x.isStarred } : x)) ?? null);
    try {
      await api.patch(`${base}/${r.id}`, { isStarred: !r.isStarred });
    } catch (err) {
      notify(errorMessage(err), 'error');
      load();
    }
  };

  const settle = async () => {
    if (!bankAccountId) {
      notify('Selecione a conta', 'error');
      return;
    }
    if (Object.values(selected).some((v) => v.amount <= 0)) {
      notify(`Informe o ${config.amountToSettle.toLowerCase()} de todos os itens selecionados`, 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post(`${base}/settle`, {
        bankAccountId,
        ...(settleDate && { date: settleDate }),
        items: selectedIds.map((id) => ({ id, amount: selected[id].amount, ...(selected[id].date && { date: selected[id].date }) })),
      });
      notify(`${selectedIds.length} ${selectedIds.length > 1 ? 'itens baixados' : 'item baixado'} · R$ ${money(totalToSettle)}`);
      setSelected({});
      await load();
      refreshLedger();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const writeOff = async () => {
    if (!window.confirm(`Marcar ${selectedIds.length} ${selectedIds.length > 1 ? 'itens' : 'item'} como perda? O valor em aberto deixa de ser cobrado.`)) return;
    setBusy(true);
    try {
      await api.post(`${base}/write-off`, { ids: selectedIds });
      notify('Marcado como perda');
      setSelected({});
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  // "Programado no banco": marca todos os selecionados (ou desmarca, se todos já estão marcados)
  const canBankSchedule = config.direction === 'PAYABLE' && currentCompany.bankScheduleEnabled;
  const allScheduled = selectedIds.length > 0 && selectedIds.every((id) => rows?.find((r) => r.id === id)?.scheduledAtBank);
  const bankSchedule = async () => {
    setBusy(true);
    try {
      await api.post(`${base}/bank-schedule`, { ids: selectedIds, value: !allScheduled });
      notify(allScheduled ? 'Desmarcado como programado no banco' : 'Marcado como programado no banco');
      setSelected({});
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const catOptions = categoryOptions(categories, config.categoryType);
  const contOptions = contactOptions(contacts, config.direction);
  const isOpenList = filters.status === 'open';

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white text-slate-800">
      {/* Cabeçalho */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-medium text-slate-700">{config.listTitle}</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => window.print()} aria-label="Imprimir" title="Imprimir" className="p-2 rounded text-slate-500 hover:bg-slate-100">
            <Printer className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDrawer({ open: true, mode: 'schedule' })}
            className="px-4 h-9 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight whitespace-nowrap"
          >
            {config.scheduleTitle}
          </button>
          <button
            onClick={() => setDrawer({ open: true, mode: 'now' })}
            className="flex items-center gap-1.5 px-4 h-9 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> {config.newUnscheduled}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <form
        className="px-6 pb-4 flex flex-wrap gap-3 items-end shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <div className="w-[300px]">
          <label className="block text-sm font-medium text-slate-800 mb-1.5">Período de agendamento</label>
          <div className="flex gap-2">
            <input type="date" aria-label="De" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={`${inputClass} min-w-0 px-2`} />
            <input type="date" aria-label="Até" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={`${inputClass} min-w-0 px-2`} />
          </div>
        </div>
        <div className="w-[210px]">
          <label className="block text-sm font-medium text-slate-800 mb-1.5">Nome</label>
          <SearchSelect value={draft.contactId} onChange={(v) => setDraft({ ...draft, contactId: v })} options={contOptions} placeholder="Selecione um contato..." clearable />
        </div>
        <div className="flex-1 min-w-[170px]">
          <label htmlFor="flt-search" className="block text-sm font-medium text-slate-800 mb-1.5">
            Descrição ou Referência
          </label>
          <input id="flt-search" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} className={inputClass} />
        </div>
        <div className="w-[180px]">
          <label className="block text-sm font-medium text-slate-800 mb-1.5">Valor em aberto</label>
          <div className="flex gap-2">
            <input inputMode="decimal" placeholder="De" aria-label="Valor de" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} className={inputClass} />
            <input inputMode="decimal" placeholder="Até" aria-label="Valor até" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} className={inputClass} />
          </div>
        </div>
        <div className="w-[210px]">
          <label className="block text-sm font-medium text-slate-800 mb-1.5">Categoria</label>
          <SearchSelect value={draft.categoryId} onChange={(v) => setDraft({ ...draft, categoryId: v })} options={catOptions} placeholder="Selecione uma categoria..." clearable />
        </div>
        <div className="w-[130px]">
          <label htmlFor="flt-status" className="block text-sm font-medium text-slate-800 mb-1.5">
            Situação
          </label>
          <select id="flt-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as StatusFilter })} className={inputClass}>
            <option value="open">Em aberto</option>
            <option value="settled">{config.settledStatus}</option>
            <option value="lost">Perdas</option>
            <option value="all">Todos</option>
          </select>
        </div>
        <div>
          <button type="submit" className="px-5 h-10 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight">
            Filtrar
          </button>
        </div>
      </form>

      <div className="px-6 pb-2 flex items-center justify-between text-sm shrink-0">
        <span className="font-medium text-slate-700">
          {selectedIds.length} {selectedIds.length === 1 ? 'item selecionado' : 'itens selecionados'}
        </span>
        <span className="text-slate-600">
          {totals.count} itens · em aberto <strong className="text-slate-800">{money(totals.open)}</strong> · vencido{' '}
          <strong className="text-rose-600">{money(totals.overdue)}</strong>
        </span>
      </div>

      {/* Tabela */}
      <div className="flex-1 min-h-0 overflow-auto px-6">
        <table className="w-full text-sm min-w-[1100px]">
          <thead className="bg-slate-100 sticky top-0 z-10">
            <tr className="text-left">
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos"
                  checked={allChecked}
                  disabled={!allSelectable.length}
                  onChange={(e) => allSelectable.forEach((r) => toggleRow(r, e.target.checked))}
                  className="w-4 h-4 accent-nibo-blue"
                />
              </th>
              <th className="w-8" />
              <th className="px-2 py-3 whitespace-nowrap">
                <SortHeader k="dueDate" label="Agendamento" sort={sort} onToggle={toggleSort} />
              </th>
              <th className="px-2 py-3">
                <SortHeader k="name" label="Nome" sort={sort} onToggle={toggleSort} />
              </th>
              <th className="px-2 py-3">
                <SortHeader k="description" label="Descrição" sort={sort} onToggle={toggleSort} />
              </th>
              <th className="px-2 py-3">
                <SortHeader k="ref" label="Ref" sort={sort} onToggle={toggleSort} />
              </th>
              <th className="px-2 py-3 font-medium text-slate-700">Categoria</th>
              <th className="px-2 py-3 text-right whitespace-nowrap">
                <SortHeader k="open" label="Valor em aberto" sort={sort} onToggle={toggleSort} />
              </th>
              {isOpenList && <th className="px-2 py-3 font-medium text-slate-700 text-right w-36 whitespace-nowrap">{config.amountToSettle}</th>}
              {isOpenList && <th className="px-2 py-3 font-medium text-slate-700 w-40">{config.settleDateColumn}</th>}
              {!isOpenList && <th className="px-2 py-3 font-medium text-slate-700">Situação</th>}
            </tr>
          </thead>
          <tbody>
            {!rows && !loadError && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando...
                </td>
              </tr>
            )}
            {loadError && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-rose-600">
                  {loadError}
                </td>
              </tr>
            )}
            {rows && sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-slate-500">
                  Nenhum lançamento encontrado.{' '}
                  <button onClick={() => setDrawer({ open: true, mode: 'schedule' })} className="text-nibo-blue hover:underline">
                    {config.scheduleTitle}
                  </button>
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const sel = selected[r.id];
              const canSelect = selectable(r);
              return (
                <tr key={r.id} className={`border-b border-slate-100 ${sel ? 'bg-nibo-blueLight/50' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${r.displayDescription}`}
                      checked={!!sel}
                      disabled={!canSelect}
                      onChange={(e) => toggleRow(r, e.target.checked)}
                      className="w-4 h-4 accent-nibo-blue"
                    />
                  </td>
                  <td>
                    <button onClick={() => toggleStar(r)} aria-label={r.isStarred ? 'Desmarcar favorito' : 'Marcar favorito'} className="p-1">
                      <Star className={`w-4 h-4 ${r.isStarred ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-400'}`} />
                    </button>
                  </td>
                  <td className={`px-2 py-2.5 whitespace-nowrap ${r.isOverdue ? 'text-rose-600 font-medium' : ''}`}>{brDate(r.dueDate)}</td>
                  <td className="px-2 py-2.5">{r.contact?.name ?? <span className="text-slate-400">-</span>}</td>
                  <td className="px-2 py-2.5">
                    <button onClick={() => setDrawer({ open: true, mode: 'edit', id: r.id })} className="text-nibo-blue hover:underline text-left">
                      {r.displayDescription}
                    </button>
                    {r.scheduledAtBank && (
                      <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-[11px] text-sky-700 align-middle" title="Pagamento já programado no banco">
                        <Landmark className="w-3 h-3" /> Programado
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-slate-600">{r.documentNumber}</td>
                  <td className="px-2 py-2.5 text-slate-700">
                    {r.splits.length ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap" title={splitTooltip(r.splits)}>
                        <Split className="w-3.5 h-3.5 text-slate-400" /> {splitLabel(r.splits)}
                      </span>
                    ) : (
                      r.category?.name
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">{money(r.openAmount)}</td>
                  {isOpenList && (
                    <td className="px-2 py-1.5">
                      <MoneyInput
                        aria-label={config.amountToSettle}
                        value={sel?.amount ?? 0}
                        allowNegative={false}
                        onChange={(v) => setSelected((s) => ({ ...s, [r.id]: { amount: v, date: s[r.id]?.date ?? '' } }))}
                        className="h-8"
                      />
                    </td>
                  )}
                  {isOpenList && (
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        aria-label={config.settleDateColumn}
                        value={sel?.date ?? ''}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [r.id]: { amount: s[r.id]?.amount ?? r.openAmount, date: e.target.value } }))
                        }
                        className="w-full h-8 px-2 rounded border border-slate-300 text-sm focus:outline-none focus:border-nibo-blue"
                      />
                    </td>
                  )}
                  {!isOpenList && (
                    <td className="px-2 py-2.5 whitespace-nowrap text-slate-600">
                      {r.status === 'LOST'
                        ? 'Perda'
                        : r.status === 'PAID'
                          ? `Quitado em ${brDate(r.settledAt)}`
                          : r.settledAmount > 0
                            ? `Parcial: ${money(r.settledAmount)}`
                            : r.isOverdue
                              ? 'Vencido'
                              : 'Em aberto'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Barra de baixa */}
      {isOpenList && (
        <div className="mx-6 mb-4 mt-2 px-5 py-4 rounded bg-slate-100 flex flex-wrap items-end gap-5 shrink-0">
          <div className="w-72">
            <label htmlFor="settle-account" className="block text-sm font-medium text-slate-800 mb-1.5">
              Conta
            </label>
            <select
              id="settle-account"
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className={`${inputClass} ${bankAccountId ? '' : 'text-slate-400'}`}
            >
              <option value="">Selecione uma conta</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-44">
            <label htmlFor="settle-date" className="block text-sm font-medium text-slate-800 mb-1.5">
              {config.settledDateLabel} <span className="italic font-normal text-xs text-slate-400">(opcional)</span>
            </label>
            <input
              id="settle-date"
              type="date"
              value={settleDate}
              onChange={(e) => setSettleDate(e.target.value)}
              title="Data usada para os itens sem data própria. Em branco: hoje."
              className={inputClass}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-800 mb-1.5">{config.totalToSettle}</p>
            <p className="h-10 flex items-center text-base font-medium">{money(totalToSettle)}</p>
          </div>
          <button
            onClick={settle}
            disabled={!selectedIds.length || busy}
            className="h-10 px-5 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {config.verb}
          </button>
          <button
            onClick={writeOff}
            disabled={!selectedIds.length || busy}
            className="h-10 px-4 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Marcar como perda
          </button>
          {canBankSchedule && (
            <button
              onClick={bankSchedule}
              disabled={!selectedIds.length || busy}
              className="h-10 px-4 rounded border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Landmark className="w-4 h-4" />
              {allScheduled ? 'Desmarcar programado' : 'Programado no banco'}
            </button>
          )}
        </div>
      )}

      <EntryDrawer
        config={config}
        mode={drawer.mode}
        entryId={drawer.id}
        isOpen={drawer.open}
        onClose={() => {
          const wasSchedule = drawer.mode === 'schedule';
          setDrawer((d) => ({ ...d, open: false }));
          if (wasSchedule) onScheduleClosed?.();
        }}
        onChanged={load}
      />
    </div>
  );
};
