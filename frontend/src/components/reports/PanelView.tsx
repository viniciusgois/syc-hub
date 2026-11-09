import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MinusSquare, PlusSquare, ArrowUp, ArrowDown, Info } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { accounting, fileSafe } from '../../lib/reports';
import { DRESection } from '../../types';
import { useCostCenters } from '../common/useCostCenters';
import { PanelCell, PanelDetailsModal } from './PanelDetailsModal';
import { ExportMenu } from './ExportMenu';
import { PdfRow, exportTablePdf } from '../../lib/pdfExport';

type Basis = 'CASH' | 'ACCRUAL';

const HIDE_ZERO_KEY = 'syc.panel.hideZero';
const isZero = (values: number[]) => values.every((v) => Math.abs(v) < 0.005);

/** Sem as categorias zeradas no ano (e sem subgrupos que ficarem vazios); as seções e os resultados sempre aparecem */
function withoutZeroLines(items: PanelLine[]): PanelLine[] {
  return items.flatMap((it) => {
    if (it.kind !== 'GROUP') return isZero(it.values) ? [] : [it];
    const children = (it.children ?? []).filter((c) => !isZero(c.values));
    return children.length || !isZero(it.values) ? [{ ...it, children }] : [];
  });
}

interface PanelLine {
  id: string;
  name: string;
  kind: 'GROUP' | 'CATEGORY';
  direction: 'INCOME' | 'EXPENSE' | null;
  values: number[];
  children?: PanelLine[];
}

interface PanelReport {
  year: number;
  basis: Basis;
  sections: { section: DRESection; label: string; letter: string; totals: number[]; items: PanelLine[] }[];
  results: {
    grossProfit: number[];
    contributionMarginPct: (number | null)[];
    breakEven: (number | null)[];
    operatingResult: number[];
    netResult: number[];
  };
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const pad = (n: number) => String(n).padStart(2, '0');

const Arrow: React.FC<{ dir: PanelLine['direction'] }> = ({ dir }) =>
  dir === 'INCOME' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ArrowDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />;

/** Linhas de resultado inseridas depois de uma seção */
type ResultRow = { label: string; formula: string; values: (number | null)[]; kind: 'money' | 'pct'; strong?: boolean; hint?: string };

/**
 * Painel de acompanhamento: matriz anual (Jan–Dez + ano) pelas seções fixas da DRE gerencial.
 * Clicar num valor abre os lançamentos que o compõem.
 */
export const PanelView: React.FC = () => {
  const { currentCompany, transactions } = useCompany();
  const [now] = useState(() => new Date());
  const [year, setYear] = useState(now.getFullYear());
  const [basis, setBasis] = useState<Basis>(currentCompany.accrualBasis ? 'ACCRUAL' : 'CASH');
  const [costCenterId, setCostCenterId] = useState('');
  const [report, setReport] = useState<PanelReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cell, setCell] = useState<PanelCell | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hideZero, setHideZero] = useState(() => {
    try {
      return localStorage.getItem(HIDE_ZERO_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleHideZero = () =>
    setHideZero((v) => {
      try {
        localStorage.setItem(HIDE_ZERO_KEY, v ? '0' : '1');
      } catch {
        // sem armazenamento: vale só nesta visita
      }
      return !v;
    });
  // O que aparece na tela é o mesmo que vai para a exportação
  const sections = useMemo(() => (report ? (hideZero ? report.sections.map((s) => ({ ...s, items: withoutZeroLines(s.items) })) : report.sections) : []), [report, hideZero]);
  const costCenters = useCostCenters();

  // Recarrega ao trocar empresa/ano/regime/centro de custo ou quando o razão muda (conciliação, baixas)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<PanelReport>(`/companies/${currentCompany.id}/reports/panel?year=${year}&basis=${basis}${costCenterId ? `&costCenterId=${costCenterId}` : ''}`)
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [currentCompany.id, year, basis, costCenterId, transactions, reloadKey]);

  const currentMonth = year === now.getFullYear() ? now.getMonth() : -1;
  const cash = basis === 'CASH';
  const costCenterName = costCenters.find((c) => c.id === costCenterId)?.name;

  const openCell = (name: string, col: number, target: PanelCell['target'], value: number) => {
    if (!value) return;
    const lastDay = col === 12 ? 31 : new Date(year, col + 1, 0).getDate();
    setCell({
      label: `${name} · ${col === 12 ? year : `${MONTHS[col]}/${year}`}${costCenterName ? ` · ${costCenterName}` : ''}`,
      from: col === 12 ? `${year}-01-01` : `${year}-${pad(col + 1)}-01`,
      to: col === 12 ? `${year}-12-31` : `${year}-${pad(col + 1)}-${pad(lastDay)}`,
      basis,
      costCenterId,
      target,
    });
  };

  const resultsAfter = (section: DRESection): ResultRow[] => {
    if (!report) return [];
    const r = report.results;
    if (section === 'OPERATING_COSTS')
      return [
        { label: 'Lucro bruto', formula: 'A+B', values: r.grossProfit, kind: 'money', strong: true },
        { label: 'Margem de contribuição', formula: '(A+B)÷A', values: r.contributionMarginPct, kind: 'pct' },
        {
          label: 'Ponto de equilíbrio',
          formula: '|C|÷margem',
          values: r.breakEven,
          kind: 'money',
          hint: 'Receita necessária para cobrir as despesas operacionais (C) com a margem de contribuição do período. "—" quando a margem é negativa ou não há despesas.',
        },
      ];
    if (section === 'OPERATING_EXPENSES') return [{ label: 'Resultado operacional', formula: 'A+B+C=D', values: r.operatingResult, kind: 'money', strong: true }];
    if (section === 'FINANCING') return [{ label: cash ? 'Variação de caixa' : 'Resultado do período', formula: 'D+E+F', values: r.netResult, kind: 'money', strong: true }];
    return [];
  };

  const exportXlsx = () => {
    if (!report) return;
    const head = ['Resultado', ...MONTHS, String(year)];
    const rows: (string | number | null)[][] = [
      [`Painel de acompanhamento — ${currentCompany.legalName}`],
      [
        `${year} | ${cash ? 'Regime de caixa' : 'Regime de competência'}${costCenterName ? ` | Centro de custo: ${costCenterName}` : ''}${hideZero ? ' | Categorias zeradas ocultas' : ''} | Gerado em ${now.toLocaleDateString('pt-BR')}`,
      ],
      [],
      head,
    ];
    for (const s of sections) {
      rows.push([`${s.label.toUpperCase()} (${s.letter})`, ...s.totals]);
      for (const it of s.items) {
        rows.push([`  ${it.name}`, ...it.values]);
        for (const c of it.children ?? []) rows.push([`    ${c.name}`, ...c.values]);
      }
      for (const r of resultsAfter(s.section)) rows.push([`${r.label} (${r.formula})${r.kind === 'pct' ? ' %' : ''}`, ...r.values]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Painel');
    XLSX.writeFile(wb, `Painel_${fileSafe(currentCompany.tradeName)}_${year}_${cash ? 'caixa' : 'competencia'}.xlsx`);
  };

  /** Mesmo conteúdo da tela (respeita "Ocultar categorias zeradas"), em PDF para o dono da empresa */
  const exportPdf = () => {
    const body: PdfRow[] = [];
    const money = (values: number[]) => values.map((v) => accounting(v, 0));
    for (const s of sections) {
      body.push({ cells: [`${s.label.toUpperCase()} (${s.letter})`, ...money(s.totals)], style: 'section' });
      for (const it of s.items) {
        body.push({ cells: [it.name, ...money(it.values)], style: it.kind === 'GROUP' ? 'group' : 'normal', indent: 1 });
        for (const c of it.children ?? []) body.push({ cells: [c.name, ...money(c.values)], indent: 2 });
      }
      for (const r of resultsAfter(s.section)) {
        body.push({
          cells: [`${r.label} (${r.formula})`, ...r.values.map((v) => (v === null ? '—' : r.kind === 'pct' ? `${accounting(v, 1)} %` : accounting(v, 0)))],
          style: r.strong ? 'result' : 'normal',
        });
      }
    }
    return exportTablePdf({
      fileName: `Painel_${fileSafe(currentCompany.tradeName)}_${year}_${cash ? 'caixa' : 'competencia'}.pdf`,
      company: currentCompany,
      title: `Painel de acompanhamento ${year}`,
      subtitle: [cash ? 'Regime de caixa' : 'Regime de competência', costCenterName && `Centro de custo: ${costCenterName}`, hideZero && 'Categorias zeradas ocultas'].filter(Boolean).join(' · '),
      head: ['Resultado', ...MONTHS, String(year)],
      body,
      rightAligned: Array.from({ length: 13 }, (_, i) => i + 1),
      redNegatives: true,
      widths: { 0: 170 },
      fontSize: 7.5,
    });
  };

  const colClass = (i: number) => `px-2 text-right whitespace-nowrap ${i === currentMonth ? 'bg-blue-50/70' : ''} ${i === 12 ? 'bg-slate-100/80 font-medium' : ''}`;
  const valueClass = (v: number) => (v < -0.004 ? 'text-rose-600' : Math.abs(v) < 0.5 ? 'text-slate-400' : 'text-slate-700');

  const valueCells = (values: number[], target: PanelCell['target'] | null, name: string, bold = false) =>
    values.map((v, i) => (
      <td key={i} className={`${colClass(i)} py-2 ${bold ? 'font-semibold' : ''}`}>
        {target && v ? (
          <button type="button" onClick={() => openCell(name, i, target, v)} className={`hover:underline ${valueClass(v)}`} title="Ver lançamentos">
            {accounting(v, 0)}
          </button>
        ) : (
          <span className={valueClass(v)}>{accounting(v, 0)}</span>
        )}
      </td>
    ));

  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h1 className="text-xl font-medium text-slate-700">Painel de acompanhamento</h1>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="Ano anterior" className="p-1.5 rounded text-nibo-blue hover:bg-slate-100">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-lg font-medium w-14 text-center">{year}</span>
          <button type="button" onClick={() => setYear((y) => y + 1)} aria-label="Próximo ano" className="p-1.5 rounded text-nibo-blue hover:bg-slate-100">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        <ExportMenu disabled={!report} onExcel={exportXlsx} onPdf={exportPdf} />
      </div>

      <div className="flex flex-wrap items-end gap-x-10 gap-y-4 mb-5">
        <fieldset>
          <legend className="text-sm font-medium text-slate-800 mb-1.5">Regime</legend>
          <div className="flex items-center gap-5 h-10">
            {(
              [
                ['CASH', 'Caixa'],
                ['ACCRUAL', 'Competência'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="panel-basis" checked={basis === value} onChange={() => setBasis(value)} className="accent-nibo-blue w-4 h-4" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {costCenters.length > 0 && (
          <div>
            <label htmlFor="panel-cc" className="block text-sm font-medium text-slate-800 mb-1.5">
              Centro de custo
            </label>
            <select
              id="panel-cc"
              value={costCenterId}
              onChange={(e) => setCostCenterId(e.target.value)}
              className={`w-64 h-10 px-3 rounded border border-slate-300 bg-white text-sm focus:outline-none focus:border-nibo-blue ${costCenterId ? 'text-slate-800' : 'text-slate-400'}`}
            >
              <option value="">Todos os centros de custo</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer h-10">
          <button
            type="button"
            role="switch"
            aria-checked={hideZero}
            onClick={toggleHideZero}
            className={`w-9 h-5 rounded-full relative transition-colors ${hideZero ? 'bg-nibo-blue' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${hideZero ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
          Ocultar categorias zeradas
        </label>
        <p className="text-xs text-slate-500 max-w-xl pb-2.5">
          {cash
            ? 'Caixa: só o que foi efetivamente pago e recebido (extrato conciliado e baixas), pela data do pagamento.'
            : 'Competência: o realizado e o agendado (inclusive vencidos em aberto), pela data de competência. Perdas não entram.'}
        </p>
        {loading && <Loader2 className="w-5 h-5 text-nibo-blue animate-spin mb-2.5" />}
      </div>

      {error && <p className="text-sm text-rose-600 mb-3">Não foi possível carregar o painel: {error}</p>}

      {report && (
        <div className="overflow-x-auto border border-slate-200 rounded">
          <table className="w-full text-[12.5px] min-w-[1080px]">
            <thead className="bg-slate-100 text-slate-700 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold sticky left-0 bg-slate-100 w-[230px] min-w-[230px]">RESULTADO</th>
                {MONTHS.map((m, i) => (
                  <th key={m} className={`${colClass(i)} py-2.5 font-semibold ${i === currentMonth ? '!bg-blue-100' : ''}`}>
                    {m}
                  </th>
                ))}
                <th className={`${colClass(12)} py-2.5 font-semibold`}>{year}</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => {
                const open = !collapsed[s.section];
                return (
                  <React.Fragment key={s.section}>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-3 py-2 sticky left-0 bg-slate-50">
                        <button type="button" onClick={() => toggle(s.section)} className="flex items-center gap-1.5 font-semibold text-slate-800 uppercase text-xs tracking-wide" aria-expanded={open}>
                          {open ? <MinusSquare className="w-3.5 h-3.5 text-slate-500" /> : <PlusSquare className="w-3.5 h-3.5 text-slate-500" />}
                          {s.label} <span className="text-slate-400 font-normal normal-case">({s.letter})</span>
                        </button>
                      </td>
                      {valueCells(s.totals, { section: s.section }, s.label, true)}
                    </tr>
                    {open &&
                      s.items.map((it) =>
                        it.kind === 'GROUP' ? (
                          <React.Fragment key={it.id}>
                            <tr className="border-t border-slate-100 hover:bg-slate-50/70">
                              <td className="px-3 py-2 pl-6 sticky left-0 bg-white">
                                <button type="button" onClick={() => toggle(it.id)} className="flex items-center gap-1.5 font-medium text-slate-800" aria-expanded={!collapsed[it.id]}>
                                  {collapsed[it.id] ? <PlusSquare className="w-3.5 h-3.5 text-slate-500" /> : <MinusSquare className="w-3.5 h-3.5 text-slate-500" />}
                                  {it.name}
                                </button>
                              </td>
                              {valueCells(it.values, { groupId: it.id }, it.name, true)}
                            </tr>
                            {!collapsed[it.id] &&
                              (it.children ?? []).map((c) => (
                                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                                  <td className="px-3 py-2 pl-12 sticky left-0 bg-white">
                                    <span className="flex items-center gap-1.5 max-w-[200px]" title={c.name}>
                                      <Arrow dir={c.direction} /> <span className="truncate">{c.name}</span>
                                    </span>
                                  </td>
                                  {valueCells(c.values, { categoryId: c.id }, c.name)}
                                </tr>
                              ))}
                          </React.Fragment>
                        ) : (
                          <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                            <td className="px-3 py-2 pl-6 sticky left-0 bg-white">
                              <span className="flex items-center gap-1.5 max-w-[210px]" title={it.name}>
                                <Arrow dir={it.direction} /> <span className="truncate">{it.name}</span>
                              </span>
                            </td>
                            {valueCells(it.values, { categoryId: it.id }, it.name)}
                          </tr>
                        ),
                      )}
                    {resultsAfter(s.section).map((r) => (
                      <tr key={r.label} className={`border-t border-slate-200 ${r.strong ? 'bg-blue-50 font-semibold' : 'bg-slate-50/60'}`}>
                        <td className={`px-3 py-2.5 sticky left-0 ${r.strong ? 'bg-blue-50' : 'bg-slate-50'}`}>
                          <span className="flex items-center gap-1.5">
                            <span className={r.strong ? 'uppercase text-xs tracking-wide' : ''}>{r.label}</span>
                            <span className="text-slate-400 font-normal text-xs">({r.formula})</span>
                            {r.hint && (
                              <span title={r.hint} className="text-slate-400 cursor-help">
                                <Info className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </span>
                        </td>
                        {r.values.map((v, i) => (
                          <td key={i} className={`${colClass(i)} py-2.5 ${v !== null ? valueClass(v) : 'text-slate-400'}`}>
                            {v === null ? '—' : r.kind === 'pct' ? `${accounting(v, 1)} %` : accounting(v, 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cell && <PanelDetailsModal cell={cell} onClose={() => setCell(null)} onChanged={() => setReloadKey((k) => k + 1)} />}
    </div>
  );
};
