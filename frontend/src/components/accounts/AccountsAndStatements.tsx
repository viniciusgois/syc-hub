import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Printer, Search, Undo2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { accountDetails, accountInstitution } from '../../lib/accounts';
import { api, errorMessage } from '../../lib/api';
import { ENTRY_CONFIG, money, todayIso } from '../../lib/entries';
import { EntryDrawer } from '../entries/EntryDrawer';
import { ReconciliationView } from '../reconciliation/ReconciliationView';
import { AccountBadge } from './AccountBadge';
import { EditAccountModal } from './EditAccountModal';
import { ImportKind } from './OFXDropzoneModal';
import { TransferModal } from './TransferModal';

interface AccountsAndStatementsProps {
  onOpenUpload: (accountId?: string, kind?: ImportKind) => void;
  onAddAccount: () => void;
}

type Direction = 'RECEIVABLE' | 'PAYABLE';

interface StatementRow {
  id: string;
  date: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string;
  bankDescription: string;
  contactName: string | null;
  categoryName: string | null;
  splitCount: number;
  documentNumber: string | null;
  origin: string;
  fromBank: boolean;
  isTransfer: boolean;
  transferAccount: { id: string; name: string } | null;
  entries: { direction: Direction; id: string; description: string }[];
  balance: number;
}

interface Statement {
  previousBalance: number;
  finalBalance: number;
  pendingCount: number;
  rows: StatementRow[];
  daily: { date: string; balance: number }[];
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDate = (v: string) => `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(2, 4)}`;
const compact = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/** Contas & Extratos no padrão Nibo: contas à esquerda, gráfico do saldo, ações e o extrato do mês */
export const AccountsAndStatements: React.FC<AccountsAndStatementsProps> = ({ onOpenUpload, onAddAccount }) => {
  const { currentCompany, accounts, archivedAccounts, selectedAccountId, setSelectedAccountId, can, refreshLedger } = useCompany();
  const [view, setView] = useState<'statement' | 'reconcile'>('statement');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState<Direction | null>(null);
  const [openEntry, setOpenEntry] = useState<{ direction: Direction; id: string } | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const canOperate = can('FINANCIAL_OPERATOR');

  const listed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (showArchived ? archivedAccounts : accounts).filter((a) => !q || a.name.toLowerCase().includes(q) || (a.bankName ?? '').toLowerCase().includes(q));
  }, [accounts, archivedAccounts, showArchived, search]);
  const everyAccount = useMemo(() => [...accounts, ...archivedAccounts], [accounts, archivedAccounts]);
  const account = everyAccount.find((a) => a.id === selectedAccountId) ?? listed[0] ?? accounts[0];

  const from = iso(month);
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));

  // Recarrega o extrato quando muda a conta/mês ou quando o razão é recarregado (saldos mudam após qualquer ação)
  useEffect(() => {
    if (!account || view !== 'statement') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<Statement>(`/companies/${currentCompany.id}/bank-accounts/${account.id}/statement?from=${from}&to=${to}`)
      .then((data) => !cancelled && setStatement(data))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currentCompany.id, account?.id, from, to, accounts, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = async (row: StatementRow) => {
    setUndoing(row.id);
    try {
      await api.post(`/companies/${currentCompany.id}/transactions/${row.id}/unreconcile`);
      await refreshLedger();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUndoing(null);
    }
  };

  if (!account) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white text-slate-600 gap-3">
        <p className="text-sm">Nenhuma conta cadastrada nesta empresa.</p>
        {can('ADMIN') && (
          <button onClick={onAddAccount} className="h-10 px-4 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2">
            <Plus className="w-4 h-4" /> Adicionar conta
          </button>
        )}
      </div>
    );
  }

  if (view === 'reconcile') {
    return <ReconciliationView accountId={account.id} onChangeAccount={setSelectedAccountId} onBack={() => setView('statement')} onOpenUpload={onOpenUpload} />;
  }

  const total = listed.reduce((s, a) => s + a.currentBalance, 0);
  const todayKey = todayIso();
  const chart = (statement?.daily ?? []).map((d) => ({ ...d, label: d.date === todayKey ? 'Hoje' : `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` }));
  const prevDay = iso(new Date(month.getFullYear(), month.getMonth(), 0));
  const pending = statement?.pendingCount ?? account.unreconciledCount ?? 0;

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-800 print:overflow-visible">
      <div className="px-6 pt-5 pb-4 flex items-center justify-between">
        <h1 className="text-xl font-medium text-slate-700">Contas & Extratos</h1>
        <div className="flex items-center gap-4 print:hidden">
          <button type="button" onClick={() => window.print()} title="Imprimir" aria-label="Imprimir" className="p-2 rounded text-slate-500 hover:bg-slate-100">
            <Printer className="w-4 h-4" />
          </button>
          {can('ADMIN') && (
            <button onClick={onAddAccount} className="h-9 px-4 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Adicionar conta
            </button>
          )}
        </div>
      </div>

      <div className="px-6 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        {/* Lista de contas */}
        <section aria-label="Contas" className="border border-slate-200 rounded flex flex-col self-start print:hidden">
          <div className="p-3 flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por..."
                aria-label="Buscar conta"
                className="w-full h-9 pl-9 pr-3 rounded-full bg-slate-100 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-nibo-blueLight"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer whitespace-nowrap">
              <button
                type="button"
                role="switch"
                aria-checked={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                className={`w-9 h-5 rounded-full relative transition-colors ${showArchived ? 'bg-nibo-blue' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${showArchived ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
              Ver arquivadas
            </label>
          </div>
          <ul className="max-h-[300px] overflow-y-auto border-t border-slate-200 divide-y divide-slate-200">
            {listed.length === 0 && <li className="px-4 py-6 text-sm text-slate-500 text-center">{showArchived ? 'Nenhuma conta arquivada.' : 'Nenhuma conta encontrada.'}</li>}
            {listed.map((a) => {
              const active = a.id === account.id;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId(a.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full px-4 py-3 flex items-start justify-between gap-3 text-left ${active ? 'bg-nibo-blueLight' : 'hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0">
                      <span className={`block text-sm truncate ${active ? 'font-medium text-slate-900' : 'text-slate-800'}`}>{a.name}</span>
                      {a.agency && <span className="block text-xs text-slate-500 mt-0.5">{accountDetails(a)}</span>}
                      {(a.unreconciledCount ?? 0) > 0 && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-800">{a.unreconciledCount} a conciliar</span>
                      )}
                    </span>
                    <span className={`text-sm whitespace-nowrap ${a.currentBalance < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{money(a.currentBalance)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!showArchived && (
            <div className="px-4 py-3 bg-slate-100 flex items-center justify-between rounded-b">
              <span className="text-sm text-slate-700">Saldo (R$)</span>
              <span className={`text-base font-medium ${total < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{money(total)}</span>
            </div>
          )}
        </section>

        {/* Conta selecionada + gráfico do saldo no mês */}
        <section aria-label="Saldo da conta" className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <AccountBadge account={account} size="lg" />
              <div className="min-w-0">
                <h2 className="text-2xl font-medium text-slate-700 flex items-center gap-2 min-w-0">
                  <span className="truncate">{account.name}</span>
                  {can('ADMIN') && (
                    <button type="button" onClick={() => setEditing(true)} title="Editar conta" aria-label="Editar conta" className="p-1 rounded text-nibo-blue hover:bg-slate-100 print:hidden">
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </h2>
                <p className="text-xs text-slate-500">
                  {accountInstitution(account)}
                  {account.agency && ` · ${accountDetails(account)}`}
                  {account.isActive === false && ' · arquivada'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mês anterior" className="p-1 rounded text-nibo-blue hover:bg-slate-100">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-lg text-slate-700 w-24 text-center">
                {MONTHS[month.getMonth()]}/{month.getFullYear()}
              </span>
              <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Próximo mês" className="p-1 rounded text-nibo-blue hover:bg-slate-100">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div className="h-[240px] mt-3">
            {chart.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={compact} width={70} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v) => [`R$ ${money(Number(v))}`, 'Saldo']} labelFormatter={(l) => String(l)} />
                  <Area type="stepAfter" dataKey="balance" stroke="#4a90e2" strokeWidth={2} fill="#4a90e2" fillOpacity={0.12} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400">{loading ? 'Carregando...' : 'Mês futuro: ainda sem saldo realizado.'}</div>
            )}
          </div>
        </section>
      </div>

      {/* Ações */}
      <div className="mt-5 px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 print:hidden">
        {canOperate ? (
          <button type="button" onClick={() => setView('reconcile')} className="h-9 px-4 rounded bg-slate-100 hover:bg-slate-200 text-sm text-slate-800 flex items-center gap-2">
            Conciliar extrato
            {pending > 0 && <span className="px-1.5 min-w-[20px] h-5 rounded-full bg-amber-400 text-[11px] font-semibold text-slate-900 flex items-center justify-center">{pending}</span>}
          </button>
        ) : (
          <span />
        )}
        {canOperate && account.isActive !== false && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setNewEntry('PAYABLE')} className="h-9 px-3.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm text-slate-800 flex items-center gap-1.5">
              <ArrowDown className="w-4 h-4" /> Novo pagamento
            </button>
            <button type="button" onClick={() => setNewEntry('RECEIVABLE')} className="h-9 px-3.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm text-slate-800 flex items-center gap-1.5">
              <ArrowUp className="w-4 h-4" /> Novo recebimento
            </button>
            <button type="button" onClick={() => setTransferOpen(true)} className="h-9 px-3.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm text-slate-800 flex items-center gap-1.5">
              <ArrowLeftRight className="w-4 h-4" /> Nova transferência
            </button>
          </div>
        )}
      </div>

      {/* Extrato do mês */}
      <section aria-label="Extrato" className="px-6 pb-8">
        <h3 className="text-base text-slate-800 mb-2 flex items-center gap-2">
          Extrato {loading && <Loader2 className="w-4 h-4 text-nibo-blue animate-spin" />}
        </h3>
        {error && <p className="text-sm text-rose-600 mb-2">{error}</p>}
        <div className="border border-slate-200 rounded overflow-x-auto">
          <table className="w-full text-[13px] text-slate-700">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium w-24">Data</th>
                <th className="px-3 py-2.5 text-left font-medium">Nome</th>
                <th className="px-3 py-2.5 text-left font-medium">Descrição</th>
                <th className="px-3 py-2.5 text-left font-medium">Categoria</th>
                <th className="px-3 py-2.5 text-left font-medium">Ref.</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> Entrada
                  </span>
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1">
                    <ArrowDown className="w-3.5 h-3.5 text-rose-600" /> Saída
                  </span>
                </th>
                <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                {canOperate && <th className="w-10 print:hidden" aria-label="Ações" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statement && (
                <tr>
                  <td className="px-4 py-2.5 whitespace-nowrap">{shortDate(prevDay)}</td>
                  <td />
                  <td className="px-3 py-2.5">Saldo anterior</td>
                  <td colSpan={4} />
                  <td className={`px-4 py-2.5 text-right whitespace-nowrap ${statement.previousBalance < 0 ? 'text-rose-600' : ''}`}>{money(statement.previousBalance)}</td>
                  {canOperate && <td className="print:hidden" />}
                </tr>
              )}
              {statement?.rows.length === 0 && (
                <tr>
                  <td colSpan={canOperate ? 9 : 8} className="px-3 py-2.5 text-slate-500 text-center">
                    Nenhum lançamento no período
                  </td>
                </tr>
              )}
              {statement?.rows.map((r) => {
                const entry = r.entries[0];
                const category = r.isTransfer
                  ? `Transferência${r.transferAccount ? ` ${r.type === 'DEBIT' ? 'para' : 'de'} ${r.transferAccount.name}` : ''}`
                  : r.splitCount > 1
                    ? `Rateio · ${r.splitCount} categorias`
                    : (r.categoryName ?? '—');
                // Baixa registrada no sistema: estorna-se pelo lançamento; o resto volta para a Conciliação
                const undoable = r.origin !== 'SETTLEMENT';
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 whitespace-nowrap">{shortDate(r.date)}</td>
                    <td className="px-3 py-2.5">
                      <span className="block max-w-[160px] truncate" title={r.contactName ?? ''}>
                        {r.contactName}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {entry ? (
                        <button
                          type="button"
                          onClick={() => setOpenEntry({ direction: entry.direction, id: entry.id })}
                          className="block max-w-[320px] truncate text-left text-nibo-blue hover:underline"
                          title={r.entries.length > 1 ? r.entries.map((e) => e.description).join('\n') : r.bankDescription}
                        >
                          {r.description}
                        </button>
                      ) : (
                        <span className="block max-w-[320px] truncate" title={r.bankDescription}>
                          {r.description}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="block max-w-[200px] truncate" title={category}>
                        {category}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.documentNumber}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-emerald-700">{r.type === 'CREDIT' ? money(r.amount) : ''}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-rose-600">{r.type === 'DEBIT' ? money(r.amount) : ''}</td>
                    <td className={`px-4 py-2.5 text-right whitespace-nowrap ${r.balance < 0 ? 'text-rose-600' : ''}`}>{money(r.balance)}</td>
                    {canOperate && (
                      <td className="pr-3 text-right print:hidden">
                        {undoable && (
                          <button
                            type="button"
                            onClick={() => undo(r)}
                            disabled={undoing === r.id}
                            title={r.isTransfer ? 'Desfazer transferência' : r.fromBank ? 'Desfazer conciliação (volta para a Conciliação)' : 'Desfazer lançamento'}
                            aria-label={r.isTransfer ? 'Desfazer transferência' : 'Desfazer conciliação'}
                            className="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {undoing === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {newEntry && (
        <EntryDrawer
          config={ENTRY_CONFIG[newEntry]}
          mode="now"
          isOpen
          defaultBankAccountId={account.id}
          onClose={() => setNewEntry(null)}
          onChanged={() => refreshLedger()}
        />
      )}
      {openEntry && (
        <EntryDrawer config={ENTRY_CONFIG[openEntry.direction]} mode="edit" entryId={openEntry.id} isOpen onClose={() => setOpenEntry(null)} onChanged={() => refreshLedger()} />
      )}
      {transferOpen && <TransferModal defaultFromId={account.id} onClose={() => setTransferOpen(false)} onDone={() => undefined} />}
      {editing && <EditAccountModal account={account} onClose={() => setEditing(false)} />}
    </div>
  );
};
