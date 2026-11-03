import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { categoryChoices } from '../../lib/categories';
import { ENTRY_CONFIG, contactOptions, todayIso } from '../../lib/entries';
import { EntriesReportConfig, ReportRow, fileSafe } from '../../lib/reports';
import { fieldClass } from '../common/Modal';
import { SearchSelect } from '../common/SearchSelect';
import { useCostCenters } from '../common/useCostCenters';
import { EntryDrawer } from '../entries/EntryDrawer';
import { RowsTable } from './RowsTable';
import { Column, exportRows } from './reportTable';

type Regime = 'competence' | 'cash';

interface Filters {
  from: string;
  to: string;
  contactId: string;
  search: string;
  min: string;
  max: string;
  categoryId: string;
  costCenterId: string;
  bankAccountId: string;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Período inicial: em aberto = até o fim do mês que vem (inclui vencidos); realizados = mês atual até hoje */
function initialFilters(config: EntriesReportConfig): Filters {
  const now = new Date();
  const base = { contactId: '', search: '', min: '', max: '', categoryId: '', costCenterId: '', bankAccountId: '' };
  return config.state === 'open'
    ? { ...base, from: '', to: iso(new Date(now.getFullYear(), now.getMonth() + 2, 0)) }
    : { ...base, from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayIso() };
}

/** Relatórios Contas a receber / recebidas / a pagar / pagas (uma linha por categoria/centro de custo) */
export const EntriesReportView: React.FC<{ config: EntriesReportConfig }> = ({ config }) => {
  const { currentCompany, categories, contacts, accounts } = useCompany();
  const costCenters = useCostCenters();
  const [regime, setRegime] = useState<Regime>('cash');
  const [draft, setDraft] = useState<Filters>(() => initialFilters(config));
  const [filters, setFilters] = useState<Filters>(draft);
  const [moreFilters, setMoreFilters] = useState(false);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<ReportRow['entry']>(null);
  const requestRef = useRef(0);
  const settled = config.state === 'settled';
  const direction = config.type === 'receivable' ? 'RECEIVABLE' : 'PAYABLE';

  const load = useCallback(async () => {
    const params = new URLSearchParams({ type: config.type, state: config.state, dateBy: regime === 'competence' ? 'competence' : config.cashDateBy });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, k === 'min' || k === 'max' ? v.replace(',', '.') : v);
    // Só a resposta do pedido mais recente vale (um filtro rápido não pode ser sobrescrito pelo carregamento anterior)
    const ticket = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ rows: ReportRow[] }>(`/companies/${currentCompany.id}/reports/entries?${params}`);
      if (ticket === requestRef.current) setRows(data.rows);
    } catch (err) {
      if (ticket === requestRef.current) setError(errorMessage(err));
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
  }, [currentCompany.id, config, regime, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const catOptions = useMemo(() => categoryChoices(categories).map((o) => ({ value: o.value, label: `${o.type === 'INCOME' ? '↑' : '↓'} ${o.label}`, group: o.group })), [categories]);
  const contOptions = useMemo(() => contactOptions(contacts, direction), [contacts, direction]);

  const amountColumn = { key: 'groupTotal' as const, label: config.amountLabel };
  const ccColumn = costCenters.length > 0 ? [{ key: 'costCenterName' as const, label: 'Centro de custo' }] : [];
  const columns: Column[] = settled
    ? [
        { key: 'paidAt', label: config.type === 'receivable' ? 'Recebimento' : 'Pagamento' },
        { key: 'dueDate', label: 'Vencimento' },
        { key: 'issueDate', label: 'Competência' },
        { key: 'contactName', label: 'Nome' },
        { key: 'description', label: 'Descrição' },
        { key: 'categoryName', label: 'Categoria' },
        ...ccColumn,
        { key: 'bankAccountName', label: 'Conta' },
        { key: 'value', label: 'Valor da categoria/CC' },
        amountColumn,
      ]
    : [
        { key: 'dueDate', label: 'Vencimento' },
        { key: 'issueDate', label: 'Competência' },
        { key: 'contactName', label: 'Nome' },
        { key: 'description', label: 'Descrição' },
        { key: 'categoryName', label: 'Categoria' },
        ...ccColumn,
        { key: 'value', label: 'Valor da categoria/CC' },
        amountColumn,
      ];

  const periodLabel = regime === 'competence' ? 'Período de competência' : config.cashPeriodLabel;
  const apply = () => setFilters(draft);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const br = (v: string) => v.split('-').reverse().join('/');

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h1 className="text-xl font-medium text-slate-700">{config.title}</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!rows?.length}
            onClick={() =>
              exportRows(
                `${fileSafe(config.title)}_${fileSafe(currentCompany.tradeName)}.xlsx`,
                config.title,
                `${currentCompany.legalName} | ${periodLabel}: ${filters.from ? br(filters.from) : 'início'} a ${filters.to ? br(filters.to) : 'hoje'}`,
                columns,
                rows ?? [],
              )
            }
            title="Exportar (.xlsx)"
            className="h-9 px-3 rounded border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Exportar
          </button>
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="Regime">
            {(
              [
                ['competence', 'Competência'],
                ['cash', 'Caixa'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={regime === value}
                onClick={() => setRegime(value)}
                className={`px-4 h-8 rounded-full ${regime === value ? 'bg-white shadow text-slate-800 font-medium' : 'text-nibo-blue hover:text-nibo-blueHover'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="space-y-3 mb-5"
      >
        <div className="flex flex-wrap gap-x-4 gap-y-3 items-end">
          <div className="w-[300px]">
            <p className="text-sm font-medium text-slate-800 mb-1.5">{periodLabel}</p>
            <div className="flex gap-2">
              <input type="date" aria-label="De" value={draft.from} onChange={(e) => set('from', e.target.value)} className={fieldClass()} />
              <input type="date" aria-label="Até" value={draft.to} onChange={(e) => set('to', e.target.value)} className={fieldClass()} />
            </div>
          </div>
          <div className="w-60">
            <label htmlFor="rep-contact" className="block text-sm font-medium text-slate-800 mb-1.5">
              Nome
            </label>
            <SearchSelect id="rep-contact" value={draft.contactId} onChange={(v) => set('contactId', v)} options={contOptions} placeholder="Selecione um contato..." clearable />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="rep-search" className="block text-sm font-medium text-slate-800 mb-1.5">
              Descrição ou Referência
            </label>
            <input id="rep-search" value={draft.search} onChange={(e) => set('search', e.target.value)} className={fieldClass()} />
          </div>
          <div className="w-48">
            <p className="text-sm font-medium text-slate-800 mb-1.5">{config.amountLabel}</p>
            <div className="flex gap-2">
              <input inputMode="decimal" aria-label="Valor de" placeholder="De" value={draft.min} onChange={(e) => set('min', e.target.value)} className={fieldClass()} />
              <input inputMode="decimal" aria-label="Valor até" placeholder="Até" value={draft.max} onChange={(e) => set('max', e.target.value)} className={fieldClass()} />
            </div>
          </div>
          <div className="w-60">
            <label htmlFor="rep-category" className="block text-sm font-medium text-slate-800 mb-1.5">
              Categoria
            </label>
            <SearchSelect id="rep-category" value={draft.categoryId} onChange={(v) => set('categoryId', v)} options={catOptions} placeholder="Selecione uma categoria..." clearable />
          </div>
        </div>
        {moreFilters && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-x-4 gap-y-3">
            {costCenters.length > 0 && (
              <div className="md:col-span-3">
                <label htmlFor="rep-cc" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Centro de custo
                </label>
                <select id="rep-cc" value={draft.costCenterId} onChange={(e) => set('costCenterId', e.target.value)} className={fieldClass()}>
                  <option value="">Todos</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {settled && (
              <div className="md:col-span-3">
                <label htmlFor="rep-account" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Conta
                </label>
                <select id="rep-account" value={draft.bankAccountId} onChange={(e) => set('bankAccountId', e.target.value)} className={fieldClass()}>
                  <option value="">Todas</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setMoreFilters((v) => !v)} className="text-sm text-nibo-blue hover:underline flex items-center gap-1">
            {moreFilters ? 'Menos opções de filtro' : 'Mais opções de filtro'} {moreFilters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-3">
            {loading && <Loader2 className="w-4 h-4 text-nibo-blue animate-spin" />}
            <button type="submit" className="h-10 px-5 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight">
              Filtrar
            </button>
          </div>
        </div>
      </form>

      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}
      {rows && (
        <RowsTable
          columns={columns}
          rows={rows}
          onOpen={(r) => setOpened(r.entry)}
          defaultSort={settled ? 'paidAt' : 'dueDate'}
          emptyText={settled ? 'Nada realizado no período.' : 'Nenhuma conta em aberto no período.'}
        />
      )}

      {opened && (
        <EntryDrawer config={ENTRY_CONFIG[opened.direction]} mode="edit" entryId={opened.id} isOpen onClose={() => setOpened(null)} onChanged={load} />
      )}
    </div>
  );
};
