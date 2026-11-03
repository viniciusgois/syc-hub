import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer, Pencil, ArrowUp, ArrowDown, Loader2, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import * as XLSX from 'xlsx';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { accountDetails } from '../../lib/accounts';
import { ENTRY_CONFIG, EntryDirection, brDate, money } from '../../lib/entries';
import { EntryDrawer } from '../entries/EntryDrawer';
import { StatementSearchDialog } from '../reconciliation/StatementSearchDialog';

interface CashflowItem {
  id: string;
  direction: EntryDirection;
  date: string;
  dueDate: string;
  contactName: string | null;
  description: string;
  amount: number;
  balance?: number;
}

interface Cashflow {
  from: string;
  to: string;
  today: string;
  balanceToday: number;
  series: { date: string; actual: number | null; projected: number | null }[];
  past: CashflowItem[];
  future: { openingBalance: number; items: CashflowItem[] };
  totals: { pastIn: number; pastOut: number; futureIn: number; futureOut: number; projectedEnd: number };
}

/** Valor no padrão Nibo: negativos entre parênteses */
const nibo = (v: number) => (v < 0 ? `(${money(-v)})` : money(v));
const shortDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
};
const monthLabel = (d: Date) =>
  d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).replace('. de ', '/').replace(' de ', '/').replace('.', '');

/** Janela de 3 meses centrada no mês âncora (mês anterior, atual e seguinte) */
function windowFor(offset: number) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m + 2, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: `${monthLabel(from)} - ${monthLabel(to)}` };
}

export const CashflowView: React.FC = () => {
  const { currentCompany, accounts, transactions, refreshLedger } = useCompany();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [data, setData] = useState<Cashflow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ direction: EntryDirection; id: string } | null>(null);
  const [searching, setSearching] = useState<CashflowItem | null>(null);
  const period = windowFor(offset);

  // Novas contas entram marcadas; desmarcações do usuário são mantidas
  useEffect(() => {
    setSelected((prev) => Object.fromEntries(accounts.map((a) => [a.id, prev[a.id] ?? true])));
  }, [accounts]);

  const selectedIds = accounts.filter((a) => selected[a.id] !== false).map((a) => a.id);
  const accountsParam = selectedIds.length === accounts.length ? '' : `&accounts=${selectedIds.join(',')}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      setData(await api.get<Cashflow>(`/companies/${currentCompany.id}/reports/cashflow?from=${period.from}&to=${period.to}${accountsParam}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [currentCompany.id, period.from, period.to, accountsParam]);

  // Também recarrega quando o razão muda (baixas, importações): `transactions` muda de referência
  useEffect(() => {
    load();
  }, [load, transactions]);

  const selectedTotal = accounts.filter((a) => selected[a.id] !== false).reduce((s, a) => s + a.currentBalance, 0);

  const chart = useMemo(() => (data?.series ?? []).map((p) => ({ ...p, label: p.date.slice(8, 10) + '/' + p.date.slice(5, 7) })), [data]);
  const ticks = useMemo(() => chart.filter((_, i) => i % 14 === 13).map((p) => p.label), [chart]);

  const saveExpectedDate = async (item: CashflowItem, value: string) => {
    setEditingDate(null);
    if (!value || value === item.date.slice(0, 10)) return;
    try {
      await api.patch(`/companies/${currentCompany.id}/${ENTRY_CONFIG[item.direction].endpoint}/${item.id}`, { expectedDate: value });
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const exportXlsx = () => {
    if (!data) return;
    const rows: (string | number)[][] = [
      [`Fluxo de Caixa - ${currentCompany.legalName}`],
      [`Período: ${brDate(data.from)} a ${brDate(data.to)} · gerado em ${new Date().toLocaleDateString('pt-BR')}`],
      [],
      ['Agendamentos Passados'],
      ['Data', 'Vencimento', 'Nome', 'Descrição', 'Entrada', 'Saída'],
      ...data.past.map((i) => [brDate(i.date), brDate(i.dueDate), i.contactName ?? '', i.description, i.direction === 'RECEIVABLE' ? i.amount : '', i.direction === 'PAYABLE' ? -i.amount : '']),
      [],
      ['Agendamentos Futuros'],
      ['Data', 'Vencimento', 'Nome', 'Descrição', 'Entrada', 'Saída', 'Saldo'],
      [brDate(data.today), '', '', 'Saldo anterior', '', '', data.future.openingBalance],
      ...data.future.items.map((i) => [
        brDate(i.date),
        brDate(i.dueDate),
        i.contactName ?? '',
        i.description,
        i.direction === 'RECEIVABLE' ? i.amount : '',
        i.direction === 'PAYABLE' ? -i.amount : '',
        i.balance ?? '',
      ]),
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Fluxo de Caixa');
    XLSX.writeFile(wb, `Fluxo_de_Caixa_${currentCompany.tradeName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_')}_${data.from}_${data.to}.xlsx`);
  };

  const renderDateCell = (item: CashflowItem) =>
    editingDate === item.id ? (
      <input
        type="date"
        autoFocus
        defaultValue={item.date.slice(0, 10)}
        aria-label="Nova data prevista"
        onKeyDown={(e) => e.key === 'Escape' && setEditingDate(null)}
        onBlur={(e) => saveExpectedDate(item, e.target.value)}
        onChange={(e) => e.target.value && saveExpectedDate(item, e.target.value)}
        className="h-7 px-1.5 rounded border border-nibo-blue text-sm"
      />
    ) : (
      <span className="group inline-flex items-center gap-1.5">
        {shortDate(item.date)}
        <button
          type="button"
          onClick={() => setEditingDate(item.id)}
          aria-label="Alterar data prevista"
          title="Alterar a data prevista (não muda o vencimento)"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-nibo-blue"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </span>
    );

  const renderRow = (item: CashflowItem, showBalance = false) => {
    const overdue = item.dueDate.slice(0, 10) < (data?.today ?? '');
    return (
      <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
        <td className="px-5 py-2.5 whitespace-nowrap">
          {renderDateCell(item)}
        </td>
        <td className={`px-3 py-2.5 whitespace-nowrap ${overdue ? 'text-rose-600' : ''}`}>{shortDate(item.dueDate)}</td>
        <td className="px-3 py-2.5">{item.contactName ?? ''}</td>
        <td className="px-3 py-2.5">
          <button onClick={() => setDrawer({ direction: item.direction, id: item.id })} className="text-nibo-blue hover:underline text-left">
            {item.description}
          </button>
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">{item.direction === 'RECEIVABLE' ? money(item.amount) : ''}</td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap text-rose-600">{item.direction === 'PAYABLE' ? `(${money(item.amount)})` : ''}</td>
        {showBalance && <td className={`px-5 py-2.5 text-right whitespace-nowrap ${(item.balance ?? 0) < 0 ? 'text-rose-600' : ''}`}>{nibo(item.balance ?? 0)}</td>}
        {!showBalance && (
          <td className="px-3 py-2 text-right whitespace-nowrap">
            <button
              type="button"
              onClick={() => setSearching(item)}
              title="Já aconteceu: encontrar a linha no extrato e conciliar"
              className="text-xs text-nibo-blue hover:underline mr-3"
            >
              Conciliar
            </button>
            <button type="button" onClick={() => setEditingDate(item.id)} title="Não aconteceu: escolher nova data prevista" className="text-xs text-nibo-blue hover:underline">
              Reprogramar
            </button>
          </td>
        )}
      </tr>
    );
  };

  const renderHead = (showBalance = false) => (
    <thead className="bg-slate-100 sticky top-0 z-10">
      <tr className="text-left text-slate-700">
        <th className="px-5 py-3 font-medium w-32">Data</th>
        <th className="px-3 py-3 font-medium w-28">Vencimento</th>
        <th className="px-3 py-3 font-medium">Nome</th>
        <th className="px-3 py-3 font-medium">Descrição</th>
        <th className="px-3 py-3 font-medium text-right w-32">
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> Entrada
          </span>
        </th>
        <th className="px-3 py-3 font-medium text-right w-32">
          <span className="inline-flex items-center gap-1">
            <ArrowDown className="w-3.5 h-3.5 text-rose-600" /> Saída
          </span>
        </th>
        {showBalance ? <th className="px-5 py-3 font-medium text-right w-36">Saldo</th> : <th className="px-3 py-3 w-44" aria-label="Ações" />}
      </tr>
    </thead>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-800 px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-medium text-slate-700">Fluxo de Caixa</h1>
        <div className="flex items-center gap-1">
          <button onClick={exportXlsx} disabled={!data} aria-label="Exportar para Excel" title="Exportar para Excel" className="p-2 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={() => window.print()} aria-label="Imprimir" title="Imprimir" className="p-2 rounded text-slate-500 hover:bg-slate-100">
            <Printer className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Contas */}
        <div className="border border-slate-200 rounded overflow-hidden self-start">
          {accounts.length === 0 && <p className="px-5 py-4 text-sm text-slate-500">Nenhuma conta cadastrada.</p>}
          {accounts.map((a) => (
            <label key={a.id} className="flex items-start gap-3 px-5 py-3 border-b border-slate-100 cursor-pointer hover:bg-slate-50">
              <input
                type="checkbox"
                checked={selected[a.id] !== false}
                onChange={(e) => setSelected((s) => ({ ...s, [a.id]: e.target.checked }))}
                className="w-4 h-4 mt-0.5 accent-nibo-blue"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-slate-800 truncate">{a.name}</span>
                {(a.agency || a.accountNumber) && <span className="block text-xs text-slate-500">{accountDetails(a)}</span>}
              </span>
              <span className={`text-sm whitespace-nowrap ${a.currentBalance < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{nibo(a.currentBalance)}</span>
            </label>
          ))}
          <div className="px-5 py-4 bg-slate-100 flex items-center justify-between">
            <span className="text-sm text-slate-700">Saldo (R$)</span>
            <span className={`text-lg ${selectedTotal < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{nibo(selectedTotal)}</span>
          </div>
        </div>

        {/* Gráfico */}
        <div className="min-w-0">
          <div className="flex items-center justify-end gap-3 mb-2">
            {loading && <Loader2 className="w-4 h-4 text-nibo-blue animate-spin" />}
            <button onClick={() => setOffset((o) => o - 1)} aria-label="Período anterior" className="p-1 rounded text-nibo-blue hover:bg-nibo-blueLight">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-lg text-slate-700 min-w-[190px] text-center">{period.label}</span>
            <button onClick={() => setOffset((o) => o + 1)} aria-label="Próximo período" className="p-1 rounded text-nibo-blue hover:bg-nibo-blueLight">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="h-[290px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="cfActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5aa9e6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#5aa9e6" stopOpacity={0.15} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="label" ticks={ticks} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={80}
                  domain={['auto', 'auto']}
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={(v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                />
                <Tooltip
                  formatter={(v, name) => [`R$ ${nibo(Number(v))}`, name === 'actual' ? 'Saldo realizado' : 'Saldo projetado']}
                  labelFormatter={(l) => `Dia ${l}`}
                  contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#e2e8f0' }}
                />
                {data && <ReferenceLine x={chart.find((p) => p.date === data.today)?.label} stroke="#cbd5e1" />}
                <Area type="monotone" dataKey="actual" stroke="#5aa9e6" strokeWidth={2} fill="url(#cfActual)" connectNulls={false} isAnimationActive={false} />
                <Area
                  type="monotone"
                  dataKey="projected"
                  stroke="#5aa9e6"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="#5aa9e6"
                  fillOpacity={0.06}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {data && (
            <p className="text-xs text-slate-500 text-right mt-1">
              Saldo projetado em {brDate(data.to)}: <strong className={data.totals.projectedEnd < 0 ? 'text-rose-600' : 'text-slate-700'}>R$ {nibo(data.totals.projectedEnd)}</strong>
            </p>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      {/* Alerta: vencidos em aberto não entram na projeção */}
      {!!data?.past.length && (
        <div role="alert" className="mt-6 flex items-start gap-3 px-4 py-3 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p>
              <strong>
                {data.past.length} {data.past.length === 1 ? 'lançamento vencido' : 'lançamentos vencidos'} em aberto
              </strong>{' '}
              ({data.totals.pastIn > 0 && `R$ ${money(data.totals.pastIn)} a receber`}
              {data.totals.pastIn > 0 && data.totals.pastOut > 0 && ' · '}
              {data.totals.pastOut > 0 && `R$ ${money(data.totals.pastOut)} a pagar`}) não {data.past.length === 1 ? 'entra' : 'entram'} na projeção.
            </p>
            <p className="text-amber-800 mt-0.5">Confira cada um: se já aconteceu, concilie com o extrato; se não aconteceu, reprograme para uma nova data.</p>
          </div>
          <button
            type="button"
            onClick={() => document.getElementById('cf-past')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-sm text-nibo-blue hover:underline whitespace-nowrap"
          >
            Ver vencidos
          </button>
        </div>
      )}

      {/* Passados */}
      <h2 id="cf-past" className="text-lg text-slate-700 mt-8 mb-2">
        Agendamentos Passados
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          {renderHead()}
          <tbody>
            {data?.past.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-4 text-slate-500">
                  Nenhum agendamento vencido em aberto.
                </td>
              </tr>
            )}
            {data?.past.map((i) => renderRow(i))}
          </tbody>
          {!!data?.past.length && (
            <tfoot>
              <tr className="font-medium">
                <td colSpan={4} className="px-5 py-2.5 text-right text-slate-600">
                  Total vencido
                </td>
                <td className="px-3 py-2.5 text-right">{money(data.totals.pastIn)}</td>
                <td className="px-3 py-2.5 text-right text-rose-600">{data.totals.pastOut ? `(${money(data.totals.pastOut)})` : ''}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Futuros */}
      <h2 className="text-lg text-slate-700 mt-8 mb-2">Agendamentos Futuros</h2>
      <div className="overflow-auto max-h-[480px] border-b border-slate-200">
        <table className="w-full text-sm min-w-[960px]">
          {renderHead(true)}
          <tbody>
            {data && (
              <tr className="border-b border-slate-100">
                <td className="px-5 py-2.5 text-slate-600">{shortDate(data.today)}</td>
                <td />
                <td />
                <td className="px-3 py-2.5 text-slate-700">Saldo anterior</td>
                <td />
                <td />
                <td className="px-5 py-2.5 text-right">{nibo(data.future.openingBalance)}</td>
              </tr>
            )}
            {data && data.to < data.today && (
              <tr>
                <td colSpan={7} className="px-5 py-4 text-slate-500">
                  Período no passado: não há agendamentos futuros.
                </td>
              </tr>
            )}
            {data && data.to >= data.today && data.future.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-4 text-slate-500">
                  Nenhum agendamento até {brDate(data.to)}.
                </td>
              </tr>
            )}
            {data?.future.items.map((i) => renderRow(i, true))}
          </tbody>
        </table>
      </div>

      {searching && (
        <StatementSearchDialog
          direction={searching.direction}
          entry={{ id: searching.id, description: searching.description, openAmount: searching.amount, dueDate: searching.dueDate }}
          onClose={() => setSearching(null)}
          onMatched={load}
        />
      )}

      {drawer && (
        <EntryDrawer
          config={ENTRY_CONFIG[drawer.direction]}
          mode="edit"
          entryId={drawer.id}
          isOpen
          onClose={() => setDrawer(null)}
          onChanged={() => {
            load();
            refreshLedger();
          }}
        />
      )}
    </div>
  );
};
