import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, CircleStop } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { EntryConfig, FREQUENCIES, brDate, contactOptions, frequencyLabel, money } from '../../lib/entries';
import { SearchSelect } from '../common/SearchSelect';

interface RecurrenceRow {
  id: string;
  type: 'RECURRING' | 'INSTALLMENT';
  frequency: string;
  description: string;
  documentNumber: string | null;
  amount: number;
  startDate: string;
  occurrences: number | null;
  status: 'ACTIVE' | 'ENDED';
  nextDueDate: string | null;
  contact: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  progress: { paid: number; generated: number; total: number | null };
}

interface Filters {
  contactId: string;
  search: string;
  min: string;
  max: string;
  frequency: string;
  status: string;
}

const EMPTY: Filters = { contactId: '', search: '', min: '', max: '', frequency: '', status: '' };
const inputClass = 'w-full h-10 px-3 rounded border border-slate-300 text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight';

export const RecurrencesView: React.FC<{ config: EntryConfig }> = ({ config }) => {
  const { currentCompany, contacts, notify } = useCompany();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<RecurrenceRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ direction: config.direction });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, k === 'min' || k === 'max' ? v.replace(',', '.') : v);
    try {
      setError(null);
      const res = await api.get<{ data: RecurrenceRow[]; total: number }>(`/companies/${currentCompany.id}/recurrences?${params}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [currentCompany.id, config.direction, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const end = async (r: RecurrenceRow) => {
    if (!window.confirm(`Encerrar "${r.description}"? As ocorrências futuras ainda não baixadas serão removidas.`)) return;
    try {
      const res = await api.post<{ removedOccurrences: number }>(`/companies/${currentCompany.id}/recurrences/${r.id}/end`);
      notify(`Encerrada · ${res.removedOccurrences} ocorrência(s) futura(s) removida(s)`);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white text-slate-800 px-6 py-5">
      <h1 className="text-xl font-medium text-slate-700 mb-4">{config.recurrencesTitle}</h1>

      <form
        className="grid grid-cols-2 lg:grid-cols-12 gap-3 items-end mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters(draft);
        }}
      >
        <div className="col-span-2 lg:col-span-3">
          <label className="block text-sm font-medium text-slate-800 mb-1.5">Nome</label>
          <SearchSelect value={draft.contactId} onChange={(v) => setDraft({ ...draft, contactId: v })} options={contactOptions(contacts, config.direction)} placeholder="Selecione um contato..." clearable />
        </div>
        <div className="col-span-2 lg:col-span-2">
          <label htmlFor="rc-search" className="block text-sm font-medium text-slate-800 mb-1.5">
            Descrição ou Referência
          </label>
          <input id="rc-search" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} className={inputClass} />
        </div>
        <div className="col-span-2 lg:col-span-2">
          <label className="block text-sm font-medium text-slate-800 mb-1.5">Valor</label>
          <div className="flex gap-2">
            <input inputMode="decimal" placeholder="De" aria-label="Valor de" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} className={inputClass} />
            <input inputMode="decimal" placeholder="Até" aria-label="Valor até" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} className={inputClass} />
          </div>
        </div>
        <div className="col-span-1 lg:col-span-2">
          <label htmlFor="rc-freq" className="block text-sm font-medium text-slate-800 mb-1.5">
            Frequência
          </label>
          <select id="rc-freq" value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })} className={inputClass}>
            <option value="">Todas</option>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-1 lg:col-span-2">
          <label htmlFor="rc-status" className="block text-sm font-medium text-slate-800 mb-1.5">
            Status
          </label>
          <select id="rc-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={inputClass}>
            <option value="">Todos</option>
            <option value="ACTIVE">Ativas</option>
            <option value="ENDED">Encerradas</option>
          </select>
        </div>
        <div className="col-span-2 lg:col-span-1">
          <button type="submit" className="w-full h-10 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight">
            Filtrar
          </button>
        </div>
      </form>

      <div className="border border-slate-200 rounded overflow-x-auto">
        <p className="px-5 py-3 text-sm text-slate-600">Exibindo {rows?.length ?? 0} itens</p>
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-100">
            <tr className="text-left text-slate-700">
              <th className="px-5 py-3 font-medium">Nome</th>
              <th className="px-3 py-3 font-medium">Descrição</th>
              <th className="px-3 py-3 font-medium">Tipo</th>
              <th className="px-3 py-3 font-medium whitespace-nowrap" title="Próximo vencimento em aberto">
                Próx. Venc.
              </th>
              <th className="px-3 py-3 font-medium whitespace-nowrap">1º Venc.</th>
              <th className="px-3 py-3 font-medium" title="Ocorrências quitadas / total">
                Progresso
              </th>
              <th className="px-3 py-3 font-medium text-right">Valor</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {!rows && !error && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando...
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-rose-600">
                  {error}
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-4 font-medium text-slate-700 bg-slate-50">
                  Nenhum {config.noun} recorrente encontrado
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id} className={`border-b border-slate-100 ${r.status === 'ENDED' ? 'text-slate-400' : ''}`}>
                <td className="px-5 py-2.5">{r.contact?.name ?? '-'}</td>
                <td className="px-3 py-2.5">
                  {r.description}
                  {r.status === 'ENDED' && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">ENCERRADA</span>}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.type === 'INSTALLMENT' ? 'Parcelamento' : 'Recorrência'} · {frequencyLabel(r.frequency)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{brDate(r.nextDueDate) || '-'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{brDate(r.startDate)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.progress.paid}/{r.progress.total ?? '∞'}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">{money(r.amount)}</td>
                <td className="px-2 py-2.5 text-center">
                  {r.status === 'ACTIVE' && (
                    <button onClick={() => end(r)} title="Encerrar" aria-label={`Encerrar ${r.description}`} className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                      <CircleStop className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-medium">
              <td className="px-5 py-3" colSpan={6}>
                Total:
              </td>
              <td className="px-3 py-3 text-right">{money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
