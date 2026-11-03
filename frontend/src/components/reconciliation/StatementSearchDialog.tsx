import React, { useEffect, useState } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { ENTRY_CONFIG, EntryDirection, brDate, money } from '../../lib/entries';
import { DifferenceChoice, DifferenceMode } from './DifferenceChoice';

interface StatementCandidate {
  id: string;
  date: string;
  description: string;
  amount: number;
  bankAccountName: string;
  reconciliationStatus: string;
  exactAmount: boolean;
  daysApart: number;
}

/** "Buscar no extrato": a partir de uma conta em aberto, escolhe a linha do extrato que a quitou */
export const StatementSearchDialog: React.FC<{
  direction: EntryDirection;
  entry: { id: string; description: string; openAmount: number; dueDate: string };
  onClose: () => void;
  onMatched: () => void;
}> = ({ direction, entry, onClose, onMatched }) => {
  const { currentCompany, matchTransaction } = useCompany();
  const config = ENTRY_CONFIG[direction];
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<StatementCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<StatementCandidate | null>(null);
  const [mode, setMode] = useState<DifferenceMode>('ADJUST');
  const [diffCategory, setDiffCategory] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    api
      .get<StatementCandidate[]>(
        `/companies/${currentCompany.id}/${config.endpoint}/${entry.id}/statement-candidates${query ? `?search=${encodeURIComponent(query)}` : ''}`,
      )
      .then((list) => !cancelled && setRows(list))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [currentCompany.id, config.endpoint, entry.id, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const confirm = async () => {
    if (!picked) return;
    setSaving(true);
    const ok = await matchTransaction(picked.id, [{ direction, id: entry.id }], picked.amount < entry.openAmount ? mode : 'ADJUST', diffCategory || null);
    setSaving(false);
    if (ok) {
      onMatched();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="stmt-search-title">
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => !saving && onClose()} />
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-md shadow-2xl flex flex-col text-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="stmt-search-title" className="text-lg font-medium text-slate-700">
            Buscar no extrato
          </h2>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 rounded text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{config.noun === 'recebimento' ? 'Conta a receber' : 'Conta a pagar'}</p>
            <p className="text-sm text-slate-800 truncate">
              {entry.description} · venc. {brDate(entry.dueDate)}
            </p>
          </div>
          <p className="text-xl font-medium whitespace-nowrap">R$ {money(entry.openAmount)}</p>
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
              placeholder="Buscar pela descrição do extrato (Enter)"
              aria-label="Buscar no extrato"
              className="w-full h-10 pl-9 pr-3 rounded border border-slate-300 text-sm focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight"
            />
          </form>
          <p className="text-xs text-slate-500 mt-1.5">
            {query ? `Resultados para "${query}".` : `${config.noun === 'recebimento' ? 'Entradas' : 'Saídas'} ainda não conciliadas com contas, até 60 dias do vencimento.`}
          </p>
        </div>

        <div className="flex-1 min-h-[180px] overflow-y-auto px-6 py-3">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!rows && !error && (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Buscando...
            </p>
          )}
          {rows?.length === 0 && (
            <p className="text-sm text-slate-500 py-4">
              Nenhuma linha encontrada. Se o {config.noun} ainda não aconteceu, reprograme a data; se foi fora do banco, registre a baixa.
            </p>
          )}
          <ul className="divide-y divide-slate-100" role="radiogroup">
            {rows?.map((r) => (
              <li key={r.id}>
                <label className={`flex items-center gap-3 py-2.5 px-2 rounded cursor-pointer ${picked?.id === r.id ? 'bg-nibo-blueLight' : 'hover:bg-slate-50'}`}>
                  <input type="radio" name="stmt-line" checked={picked?.id === r.id} onChange={() => setPicked(r)} className="accent-nibo-blue" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-800 truncate">{r.description}</span>
                    <span className="block text-xs text-slate-500">
                      {brDate(r.date)} · {r.bankAccountName} · {r.daysApart} dia(s) do vencimento
                      {r.reconciliationStatus === 'RECONCILED' && ' · já categorizada'}
                    </span>
                  </span>
                  {r.exactAmount && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">VALOR EXATO</span>}
                  <span className="text-sm font-medium whitespace-nowrap">R$ {money(r.amount)}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 space-y-3">
          {picked && <DifferenceChoice statementAmount={picked.amount} openTotal={entry.openAmount} mode={mode} onChange={setMode} verb={config.noun as 'recebimento' | 'pagamento'} category={diffCategory} onCategoryChange={setDiffCategory} />}
          <div className="flex items-center justify-end gap-5">
            <button type="button" onClick={onClose} className="text-sm text-nibo-blue hover:underline">
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={!picked || saving}
              className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Conciliar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
