import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { brDate, money } from '../../lib/entries';
import { MatchSuggestion, Transaction } from '../../types';
import { DifferenceChoice, DifferenceMode } from './DifferenceChoice';

/**
 * Concilia uma linha do extrato com uma ou mais contas a receber/pagar em aberto.
 * Abre com a sugestão (se houver) já marcada.
 */
export const ReconcileDialog: React.FC<{ tx: Transaction; onClose: () => void }> = ({ tx, onClose }) => {
  const { currentCompany, matchTransaction } = useCompany();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MatchSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, MatchSuggestion>>(() =>
    tx.matchSuggestion ? { [tx.matchSuggestion.id]: tx.matchSuggestion } : {},
  );
  const [mode, setMode] = useState<DifferenceMode>('ADJUST');
  const [diffCategory, setDiffCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const isCredit = tx.type === 'CREDIT';
  const noun = isCredit ? 'recebimento' : 'pagamento';

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    api
      .get<MatchSuggestion[]>(`/companies/${currentCompany.id}/transactions/${tx.id}/candidates${query ? `?search=${encodeURIComponent(query)}` : ''}`)
      .then((list) => !cancelled && setCandidates(list))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [currentCompany.id, tx.id, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const selected = Object.values(picked);
  const openTotal = selected.reduce((s, c) => s + c.openAmount, 0);
  const diff = Math.round((tx.amount - openTotal) * 100) / 100;

  // Sugestão marcada fica no topo mesmo se a busca não a trouxer
  const list = useMemo(() => {
    const base = candidates ?? [];
    const extra = selected.filter((s) => !base.some((c) => c.id === s.id));
    return [...extra, ...base];
  }, [candidates, selected]);

  const toggle = (c: MatchSuggestion) =>
    setPicked((p) => {
      const next = { ...p };
      if (next[c.id]) delete next[c.id];
      else next[c.id] = c;
      return next;
    });

  const confirm = async () => {
    setSaving(true);
    const ok = await matchTransaction(
      tx.id,
      selected.map((c) => ({ direction: c.direction, id: c.id })),
      diff < 0 ? mode : 'ADJUST',
      diffCategory || null,
    );
    setSaving(false);
    if (ok) onClose();
  };

  const Arrow = isCredit ? ArrowUp : ArrowDown;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="reconcile-title">
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => !saving && onClose()} />
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-md shadow-2xl flex flex-col text-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="reconcile-title" className="text-lg font-medium text-slate-700">
            Conciliar com {isCredit ? 'contas a receber' : 'contas a pagar'}
          </h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Linha do extrato */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Linha do extrato</p>
            <p className="text-sm text-slate-800 truncate">
              {brDate(tx.date)} · {tx.description}
            </p>
          </div>
          <p className={`text-xl font-medium whitespace-nowrap flex items-center gap-1 ${isCredit ? 'text-emerald-700' : 'text-rose-700'}`}>
            <Arrow className="w-4 h-4" /> R$ {money(tx.amount)}
          </p>
        </div>

        <div className="px-6 pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search.trim());
            }}
            className="relative"
          >
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${noun} por descrição, contato ou referência (Enter)`}
              aria-label="Buscar lançamento"
              className="w-full h-10 pl-9 pr-3 rounded border border-slate-300 text-sm focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight"
            />
          </form>
          <p className="text-xs text-slate-500 mt-1.5">
            {query ? `Resultados para "${query}"` : 'Em aberto com vencimento até 60 dias da data do extrato; valor exato primeiro.'} Marque um ou mais lançamentos.
          </p>
        </div>

        <div className="flex-1 min-h-[180px] overflow-y-auto px-6 py-3">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!candidates && !error && (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
            </p>
          )}
          {candidates && list.length === 0 && (
            <p className="text-sm text-slate-500 py-4">
              Nenhum {noun} em aberto encontrado. Agende o {noun} em {isCredit ? 'Recebimentos' : 'Pagamentos'} ou categorize a linha diretamente no extrato.
            </p>
          )}
          <ul className="divide-y divide-slate-100">
            {list.map((c) => {
              const checked = !!picked[c.id];
              return (
                <li key={c.id}>
                  <label className={`flex items-center gap-3 py-2.5 px-2 rounded cursor-pointer ${checked ? 'bg-nibo-blueLight' : 'hover:bg-slate-50'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggle(c)} className="w-4 h-4 accent-nibo-blue" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-800 truncate">
                        {c.description}
                        {c.contactName && <span className="text-slate-500"> · {c.contactName}</span>}
                      </span>
                      <span className="block text-xs text-slate-500">
                        Venc. {brDate(c.dueDate)}
                        {c.expectedDate && ` · previsto ${brDate(c.expectedDate)}`}
                        {c.categoryName && ` · ${c.categoryName}`}
                        {` · ${c.daysApart} dia(s) do extrato`}
                      </span>
                    </span>
                    {c.exactAmount && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">VALOR EXATO</span>}
                    <span className="text-sm font-medium whitespace-nowrap">R$ {money(c.openAmount)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 space-y-3">
          {selected.length > 0 && (
            <DifferenceChoice statementAmount={tx.amount} openTotal={openTotal} mode={mode} onChange={setMode} verb={noun} category={diffCategory} onCategoryChange={setDiffCategory} />
          )}
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              {selected.length} selecionado(s) · em aberto <strong className="text-slate-800">R$ {money(openTotal)}</strong> · extrato{' '}
              <strong className="text-slate-800">R$ {money(tx.amount)}</strong>
            </p>
            <div className="flex items-center gap-5">
              <button type="button" onClick={onClose} className="text-sm text-nibo-blue hover:underline">
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!selected.length || saving}
                className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Conciliar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
