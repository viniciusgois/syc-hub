import React, { useState, useMemo } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { accountDetails } from '../../lib/accounts';
import { api, errorMessage } from '../../lib/api';
import { PdfRow, exportTablePdf } from '../../lib/pdfExport';
import { PeriodPicker } from '../common/PeriodPicker';
import { Period, monthsPeriod, periodText } from '../../lib/period';
import { EntryRow, brDate } from '../../lib/entries';
import {
  Printer,
  FileDown,
  Loader2,
  ArrowUp,
  ArrowDown,
  Star,
  Eye,
  LineChart,
  CircleDollarSign,
  Check,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
} from 'recharts';
/** Linha dos cards "Próximos a receber/pagar" */
interface DashboardBill {
  id: string;
  dueDate: string;
  isOverdue: boolean;
  name: string;
  subtitle?: string;
  amount: number;
}

const BILLS_SHOWN = 6;

/** Próximas contas em aberto (a API já devolve ordenado por vencimento) */
function useOpenBills(companyId: string, endpoint: 'receivables' | 'payables', refreshKey: unknown) {
  const [state, setState] = React.useState<{ bills: DashboardBill[]; open: number; overdue: number }>({ bills: [], open: 0, overdue: 0 });
  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ data: EntryRow[]; totals: { open: number; overdue: number } }>(`/companies/${companyId}/${endpoint}?status=open`)
      .then(({ data, totals }) => {
        if (cancelled) return;
        setState({
          open: totals.open,
          overdue: totals.overdue,
          bills: data.slice(0, BILLS_SHOWN).map((e) => ({
            id: e.id,
            dueDate: brDate(e.dueDate),
            isOverdue: e.isOverdue,
            name: e.contact?.name ?? e.displayDescription,
            subtitle: e.contact ? e.displayDescription : (e.category?.name ?? 'Sem descrição'),
            amount: e.openAmount,
          })),
        });
      })
      .catch(() => !cancelled && setState({ bills: [], open: 0, overdue: 0 }));
    return () => {
      cancelled = true;
    };
  }, [companyId, endpoint, refreshKey]);
  return state;
}



interface ResumoViewProps {
  onNavigate?: (module: string) => void;
  onOpenUpload?: (accountId?: string) => void;
}

export const ResumoView: React.FC<ResumoViewProps> = ({ onNavigate }) => {
  const { currentCompany, accounts, transactions, setActiveModule, notify } = useCompany();

  // Contas ativas selecionadas nos checkboxes (para somatório dinâmico do Saldo)
  const [selectedAccountIds, setSelectedAccountIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    accounts.forEach((acc) => {
      initial[acc.id] = true;
    });
    return initial;
  });

  // Atualizar quando mudar de empresa
  React.useEffect(() => {
    const updated: Record<string, boolean> = {};
    accounts.forEach((acc) => {
      updated[acc.id] = true;
    });
    setSelectedAccountIds(updated);
  }, [accounts]);

  const toggleAccount = (id: string) => {
    setSelectedAccountIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Cálculo dinâmico do Saldo total baseado nas contas ticadas
  const dynamicTotalBalance = useMemo(() => {
    return accounts
      .filter((acc) => selectedAccountIds[acc.id])
      .reduce((sum, acc) => sum + acc.currentBalance, 0);
  }, [accounts, selectedAccountIds]);

  // Formatação de Moeda no padrão Nibo (Ex: 139.249,11)
  const formatNiboNumber = (val: number) => {
    return val.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Fluxo de caixa do card: saldo real (linha cheia) e projeção pelos agendamentos (tracejada), como no Nibo
  const [cashPeriod, setCashPeriod] = useState<Period>(() => {
    const now = new Date();
    return monthsPeriod(now.getFullYear(), now.getMonth() - 1, 3);
  });
  const [cashSeries, setCashSeries] = useState<{ date: string; actual: number | null; projected: number | null }[]>([]);
  const selectedIds = accounts.filter((a) => selectedAccountIds[a.id]).map((a) => a.id);
  const accountsParam = selectedIds.length === accounts.length ? '' : `&accounts=${selectedIds.join(',')}`;
  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ series: { date: string; actual: number | null; projected: number | null }[] }>(
        `/companies/${currentCompany.id}/reports/cashflow?from=${cashPeriod.from}&to=${cashPeriod.to}${accountsParam}`,
      )
      .then((d) => !cancelled && setCashSeries(d.series))
      .catch(() => !cancelled && setCashSeries([]));
    return () => {
      cancelled = true;
    };
  }, [currentCompany.id, cashPeriod.from, cashPeriod.to, accountsParam, transactions]);
  const cashFlowData = useMemo(() => cashSeries.map((p) => ({ ...p, date: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}` })), [cashSeries]);

  // PDF do Resumo: saldos por conta, gráfico do fluxo e as contas em aberto até o fim do período do card
  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    setExporting(true);
    try {
      const base = `/companies/${currentCompany.id}`;
      const [rec, pay, flow] = await Promise.all([
        api.get<{ data: EntryRow[] }>(`${base}/receivables?status=open`),
        api.get<{ data: EntryRow[] }>(`${base}/payables?status=open`),
        api.get<{ series: { date: string; actual: number | null; projected: number | null }[] }>(
          `${base}/reports/cashflow?from=${cashPeriod.from}&to=${cashPeriod.to}${accountsParam}`,
        ),
      ]);
      const series = flow.series;
      const acc = (v: number) => (v < 0 ? `(${formatNiboNumber(-v)})` : formatNiboNumber(v));
      const untilText = periodText(cashPeriod).split(' a ')[1];
      const until = (rows: EntryRow[]) => rows.filter((e) => e.dueDate.slice(0, 10) <= cashPeriod.to);
      const recList = until(rec.data);
      const payList = until(pay.data);
      const sum = (rows: EntryRow[], overdueOnly = false) => rows.filter((e) => !overdueOnly || e.isOverdue).reduce((t, e) => t + e.openAmount, 0);
      const billRows = (rows: EntryRow[]): PdfRow[] =>
        rows.map((e) => ({
          cells: [brDate(e.dueDate), e.contact?.name ?? '', e.displayDescription, e.category?.name ?? '', e.isOverdue ? 'Vencido' : 'Em aberto', formatNiboNumber(e.openAmount)],
        }));
      const chosen = accounts.filter((a) => selectedAccountIds[a.id]);
      await exportTablePdf({
        fileName: `Resumo_${currentCompany.tradeName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, '_')}_${cashPeriod.from}_${cashPeriod.to}.pdf`,
        company: currentCompany,
        title: 'Resumo',
        subtitle: `Fluxo de caixa: ${periodText(cashPeriod)} · contas em aberto (inclusive vencidas) até ${untilText} · contas selecionadas`,
        summary: [
          { label: 'Saldo das contas', value: `R$ ${acc(dynamicTotalBalance)}`, tone: dynamicTotalBalance < 0 ? 'negative' : 'neutral' },
          { label: `A receber até ${untilText}`, value: `R$ ${formatNiboNumber(sum(recList))}`, tone: 'positive' },
          { label: `A pagar até ${untilText}`, value: `R$ ${formatNiboNumber(sum(payList))}`, tone: 'negative' },
          { label: 'Vencidos: a receber / a pagar', value: `${formatNiboNumber(sum(recList, true))} / ${formatNiboNumber(sum(payList, true))}`, tone: 'neutral' },
        ],
        chart: series.length > 1
          ? {
              labels: series.map((p) => `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`),
              series: [
                { name: 'Saldo realizado', values: series.map((p) => p.actual), fill: true },
                { name: 'Saldo projetado', values: series.map((p) => p.projected), dashed: true },
              ],
            }
          : undefined,
        tableTitle: 'Saldo das contas',
        head: ['Conta', 'Instituição / agência e conta', 'Saldo'],
        body: chosen.map((a) => ({ cells: [a.name, [a.bankName, a.agency ? accountDetails(a) : ''].filter(Boolean).join(' · '), acc(a.currentBalance)] })),
        foot: ['Total', '', acc(dynamicTotalBalance)],
        rightAligned: [2],
        redNegatives: true,
        widths: { 2: 110 },
        sections: [
          {
            title: 'Recebimentos em aberto',
            head: ['Vencimento', 'Nome', 'Descrição', 'Categoria', 'Situação', 'Valor'],
            body: billRows(recList),
            foot: ['Total', '', '', '', '', formatNiboNumber(sum(recList))],
            rightAligned: [5],
            widths: { 0: 66, 4: 66, 5: 86 },
            emptyText: 'Nenhum recebimento em aberto no período.',
          },
          {
            title: 'Pagamentos em aberto',
            head: ['Vencimento', 'Nome', 'Descrição', 'Categoria', 'Situação', 'Valor'],
            body: billRows(payList),
            foot: ['Total', '', '', '', '', formatNiboNumber(sum(payList))],
            rightAligned: [5],
            widths: { 0: 66, 4: 66, 5: 86 },
            emptyText: 'Nenhum pagamento em aberto no período.',
          },
        ],
      });
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setExporting(false);
    }
  };

  const receivables = useOpenBills(currentCompany.id, 'receivables', transactions);
  const payables = useOpenBills(currentCompany.id, 'payables', transactions);
  const RECEIVABLES = receivables.bills;
  const PAYABLES = payables.bills;
  const receivableTotals = receivables;
  const payableTotals = payables;

  return (
    <div className="flex-1 overflow-y-auto bg-[#f4f6f9] p-6 text-slate-800 print:overflow-visible print:bg-white">
      {/* ========================================================= */}
      {/* TÍTULO DA PÁGINA + BOTÃO IMPRIMIR                         */}
      {/* ========================================================= */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl text-slate-800">Resumo</h1>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-white rounded transition-colors"
            title="Imprimir relatório resumido"
            aria-label="Imprimir"
          >
            <Printer className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={exportPdf}
            disabled={exporting}
            className="h-9 px-3 rounded border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} Exportar PDF
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* LINHA SUPERIOR: CARD SALDO & CARD FLUXO DE CAIXA          */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-4 mb-4">
        {/* CARD 1: SALDO */}
        <div className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs flex flex-col justify-between">
          <div>
            {/* Cabeçalho do Card */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-2">
                <CircleDollarSign className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <h3 className="text-xl text-slate-800 leading-tight">
                    Saldo
                  </h3>
                  <button
                    onClick={() => setActiveModule('contas-extratos')}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
                  >
                    <span>Gerenciar contas e extratos</span>
                    <span>→</span>
                  </button>
                </div>
              </div>

              {/* Total do Saldo */}
              <div className="text-right">
                <span className="text-2xl text-slate-900">
                  {formatNiboNumber(dynamicTotalBalance)}
                </span>
              </div>
            </div>

            {/* Lista de Contas com Checkbox com barra de rolagem idêntica ao Nibo */}
            <div className="space-y-2.5 pt-1 max-h-[220px] overflow-y-auto pr-2 print:max-h-none print:overflow-visible">
              {accounts.map((acc) => {
                const isChecked = !!selectedAccountIds[acc.id];
                const isItau = acc.name.toLowerCase().includes('itaú');

                return (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between py-1 border-b border-slate-100 last:border-none text-xs"
                  >
                    <label className="flex items-center space-x-3 cursor-pointer group select-none">
                      <div
                        onClick={() => toggleAccount(acc.id)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          isChecked
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-white border-slate-300 group-hover:border-blue-400'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>

                      <div className="flex flex-col">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-slate-800 group-hover:text-blue-600 transition-colors">
                            {acc.name}
                          </span>
                          {isItau && (
                            <span className="text-slate-400" title="Visualizar extrato">
                              <Eye className="w-3.5 h-3.5 text-blue-500 cursor-pointer inline" />
                            </span>
                          )}
                        </div>
                        {(acc.agency || acc.accountNumber) && (
                          <span className="text-[10px] text-slate-400 font-mono">{accountDetails(acc)}</span>
                        )}
                      </div>
                    </label>

                    <span className="text-slate-800 text-xs">
                      {formatNiboNumber(acc.currentBalance)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* CARD 2: FLUXO DE CAIXA */}
        <div className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs flex flex-col justify-between">
          <div>
            {/* Cabeçalho do Card */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center space-x-2">
                <LineChart className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <h3 className="text-xl text-slate-800 leading-tight">
                    Fluxo de caixa
                  </h3>
                  <button
                    onClick={() => setActiveModule('fluxo-caixa')}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
                  >
                    <span>Gerenciar fluxo de caixa</span>
                    <span>→</span>
                  </button>
                </div>
              </div>

              {/* Seletor de período (padrão Nibo) */}
              <PeriodPicker value={cashPeriod} onChange={setCashPeriod} size="md" />
            </div>

            {/* Gráfico de Área / Linha com Projeção Tracejada */}
            <div className="h-[210px] w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={cashFlowData}
                  margin={{ top: 10, right: 15, left: 10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="niboAreaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0284c7" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    minTickGap={24}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    domain={['auto', 'auto']}
                    width={70}
                    tickFormatter={(val: number) => val.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#e2e8f0',
                      borderRadius: '8px',
                      fontSize: '11px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    }}
                    formatter={(value: any) => [`R$ ${formatNiboNumber(Number(value))}`, 'Saldo']}
                  />

                  {/* Área e Linha Real (Passado/Presente) */}
                  <Area
                    type="monotone"
                    dataKey="actual"
                    stroke="#0284c7"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#niboAreaGradient)"
                  />

                  {/* Linha Tracejada de Projeção Futura */}
                  <Line
                    type="monotone"
                    dataKey="projected"
                    stroke="#0284c7"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* LINHA INFERIOR: RECEBIMENTOS & PAGAMENTOS                 */}
      {/* ========================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2 gap-4">
        {/* CARD 3: RECEBIMENTOS */}
        <div className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs">
          {/* Título com Seta Verde */}
          <div className="flex items-center space-x-1.5 mb-3">
            <ArrowUp className="w-4 h-4 text-emerald-600 stroke-[2.5]" />
            <h3 className="text-lg text-slate-800">Recebimentos</h3>
          </div>

          {/* Faixa / Cabeçalho de Status: Próximos a receber | Em aberto | Vencido */}
          <div className="bg-slate-100/90 rounded px-3 py-2 flex items-center justify-between text-xs text-slate-700 mb-3">
            <span className="text-slate-600">Próximos a receber</span>
            <div className="flex items-center space-x-6">
              <div>
                <span className="text-slate-500 mr-2">Em aberto</span>
                <span className="text-slate-800">{formatNiboNumber(receivableTotals.open)}</span>
              </div>
              <div>
                <span className="text-slate-500 mr-2">Vencido</span>
                <span className="text-rose-600">{formatNiboNumber(receivableTotals.overdue)}</span>
              </div>
            </div>
          </div>

          {/* Tabela de Contas a Receber */}
          <div className="space-y-2">
            {RECEIVABLES.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">Nenhuma conta a receber cadastrada.</p>
            )}
            {RECEIVABLES.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 border-b border-slate-100 last:border-none text-xs hover:bg-slate-50/70 px-1 rounded transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <Star className="w-3.5 h-3.5 text-slate-300 hover:text-amber-400 cursor-pointer" />
                  <span
                    className={`${
                      item.isOverdue ? 'text-rose-600' : 'text-slate-700'
                    }`}
                  >
                    {item.dueDate}
                  </span>
                  <div>
                    <p className="text-slate-800">{item.name}</p>
                    {item.subtitle && (
                      <p className="text-[11px] text-blue-600">{item.subtitle}</p>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-slate-900">
                    {formatNiboNumber(item.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CARD 4: PAGAMENTOS */}
        <div className="bg-white border border-slate-200/90 rounded-lg p-5 shadow-xs">
          {/* Título com Seta Vermelha */}
          <div className="flex items-center space-x-1.5 mb-3">
            <ArrowDown className="w-4 h-4 text-rose-600 stroke-[2.5]" />
            <h3 className="text-lg text-slate-800">Pagamentos</h3>
          </div>

          {/* Faixa / Cabeçalho de Status: Próximos a pagar | Em aberto | Vencido */}
          <div className="bg-slate-100/90 rounded px-3 py-2 flex items-center justify-between text-xs text-slate-700 mb-3">
            <span className="text-slate-600">Próximos a pagar</span>
            <div className="flex items-center space-x-6">
              <div>
                <span className="text-slate-500 mr-2">Em aberto</span>
                <span className="text-slate-800">{formatNiboNumber(payableTotals.open)}</span>
              </div>
              <div>
                <span className="text-slate-500 mr-2">Vencido</span>
                <span className="text-rose-600">{formatNiboNumber(payableTotals.overdue)}</span>
              </div>
            </div>
          </div>

          {/* Tabela de Contas a Pagar */}
          <div className="space-y-2">
            {PAYABLES.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">Nenhuma conta a pagar cadastrada.</p>
            )}
            {PAYABLES.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-none text-xs hover:bg-slate-50/70 px-1 rounded transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <Star className="w-3.5 h-3.5 text-slate-300 hover:text-amber-400 cursor-pointer" />
                  <span
                    className={`${
                      item.isOverdue ? 'text-rose-600' : 'text-slate-700'
                    }`}
                  >
                    {item.dueDate}
                  </span>
                  <div>
                    <p className="text-slate-800">{item.name}</p>
                    {item.subtitle && (
                      <p
                        className={`text-[11px] ${
                          item.subtitle === 'Sem descrição'
                            ? 'text-slate-400'
                            : 'text-blue-600'
                        }`}
                      >
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-slate-900">
                    {formatNiboNumber(item.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
