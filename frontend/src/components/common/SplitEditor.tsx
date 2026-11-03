import React, { useMemo } from 'react';
import { Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { categoryChoices } from '../../lib/categories';
import { Nature, SplitDraft, SplitDraftLine, newSplitLine, resolveSplit, signOf, splitSummary } from '../../lib/splits';
import { CostCenterOption } from './useCostCenters';
import { MoneyInput } from './MoneyInput';
import { SearchSelect } from './SearchSelect';

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Rateio por categoria e centro de custo, por valor ou por percentual.
 * Categorias de natureza oposta entram subtraindo (ex.: recebimento líquido = venda − taxa da maquininha).
 */
export const SplitEditor: React.FC<{
  draft: SplitDraft;
  onChange: (draft: SplitDraft) => void;
  total: number;
  nature: Nature;
  costCenters: CostCenterOption[];
  onRemove?: () => void;
  error?: string | null;
}> = ({ draft, onChange, total, nature, costCenters, onRemove, error }) => {
  const { categories } = useCompany();
  const options = useMemo(
    // Coluna estreita: só o nome da categoria; o subgrupo vai para o título do grupo na lista
    () =>
      categoryChoices(categories).map((o) => {
        const [parent, name] = o.label.includes(' › ') ? o.label.split(' › ') : [null, o.label];
        return { value: o.value, label: `${o.type === 'INCOME' ? '↑' : '↓'} ${name}`, group: parent ? `${o.group} › ${parent}` : o.group };
      }),
    [categories],
  );
  const sign = (id: string) => signOf(categories, id, nature);
  const lines = resolveSplit(draft, total, sign);
  const { distributed, remaining } = splitSummary(lines, total, sign);

  const update = (key: string, patch: Partial<SplitDraftLine>) => onChange({ ...draft, lines: draft.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const setMode = (mode: SplitDraft['mode']) => {
    if (mode === draft.mode) return;
    // Mantém o que está na tela: troca de modo levando os valores/percentuais calculados
    onChange({ mode, lines: lines.map((l) => ({ ...l })) });
  };

  /** Joga o que falta na última linha (ou cria uma) */
  const fillRemaining = () => {
    const last = draft.lines[draft.lines.length - 1];
    const s = last ? sign(last.categoryId) : 1;
    if (draft.mode === 'value') {
      const amount = round2((last?.amount ?? 0) + s * remaining);
      if (last && amount > 0) update(last.key, { amount });
      else onChange({ ...draft, lines: [...draft.lines, newSplitLine({ amount: remaining })] });
    } else {
      const pct = total ? round2((remaining / total) * 100) : 0;
      const percent = round2((last?.percent ?? 0) + s * pct);
      if (last && percent > 0) update(last.key, { percent });
      else onChange({ ...draft, lines: [...draft.lines, newSplitLine({ percent: pct })] });
    }
  };

  const showCostCenter = costCenters.length > 0;
  const cols = showCostCenter ? 'md:grid-cols-[minmax(0,1fr)_200px_150px_100px_32px]' : 'md:grid-cols-[minmax(0,1fr)_150px_100px_32px]';
  const numClass =
    'w-full h-10 px-3 rounded border border-slate-300 bg-white text-sm text-right text-slate-800 focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight';

  return (
    <div className="rounded-md border border-slate-200 p-4 space-y-3" data-testid="split-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-800">Rateio por categoria{showCostCenter ? ' e centro de custo' : ''}</h3>
        <div className="flex items-center gap-4">
          <div className="inline-flex rounded border border-slate-300 overflow-hidden text-sm" role="radiogroup" aria-label="Ratear por">
            {(
              [
                ['value', 'Por valor'],
                ['percent', 'Por %'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={draft.mode === mode}
                onClick={() => setMode(mode)}
                className={`px-3 h-8 ${draft.mode === mode ? 'bg-nibo-blue text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {onRemove && (
            <button type="button" onClick={onRemove} className="text-sm text-nibo-blue hover:underline">
              Remover rateio
            </button>
          )}
        </div>
      </div>

      <div className={`hidden md:grid ${cols} gap-3 text-xs font-medium text-slate-500`}>
        <span>Categoria</span>
        {showCostCenter && <span>Centro de custo</span>}
        <span className="text-right">Valor (R$)</span>
        <span className="text-right">%</span>
        <span />
      </div>

      {lines.map((l, i) => {
        const negative = sign(l.categoryId) < 0;
        return (
          <div key={l.key} className={`grid grid-cols-1 ${cols} gap-3 items-center`}>
            <SearchSelect
              id={`split-cat-${i}`}
              value={l.categoryId}
              onChange={(v) => update(l.key, { categoryId: v })}
              options={options}
              placeholder="Selecione a categoria..."
            />
            {showCostCenter && (
              <select
                aria-label={`Centro de custo da linha ${i + 1}`}
                value={l.costCenterId}
                onChange={(e) => update(l.key, { costCenterId: e.target.value })}
                className={`h-10 px-3 rounded border border-slate-300 bg-white text-sm focus:outline-none focus:border-nibo-blue ${l.costCenterId ? 'text-slate-800' : 'text-slate-400'}`}
              >
                <option value="">Nenhum</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {draft.mode === 'value' ? (
              <MoneyInput
                aria-label={`Valor da linha ${i + 1}`}
                value={l.amount}
                onChange={(v) => update(l.key, { amount: v })}
                allowNegative={false}
                prefix={negative ? <span className="text-rose-600 font-medium" title="Categoria de natureza oposta: entra subtraindo">−</span> : undefined}
              />
            ) : (
              <p className={`text-sm text-right pr-3 ${negative ? 'text-rose-600' : 'text-slate-700'}`}>
                {negative ? '− ' : ''}
                {money(l.amount)}
              </p>
            )}
            {draft.mode === 'percent' ? (
              <input
                type="number"
                min={0}
                max={1000}
                step="0.01"
                aria-label={`Percentual da linha ${i + 1}`}
                value={l.percent || ''}
                onChange={(e) => update(l.key, { percent: Number(e.target.value) || 0 })}
                className={numClass}
              />
            ) : (
              <p className="text-sm text-right pr-3 text-slate-500">{money(l.percent)}%</p>
            )}
            <button
              type="button"
              onClick={() => onChange({ ...draft, lines: draft.lines.filter((x) => x.key !== l.key) })}
              disabled={draft.lines.length <= 2}
              aria-label={`Remover linha ${i + 1}`}
              title={draft.lines.length <= 2 ? 'O rateio precisa de ao menos 2 linhas' : 'Remover linha'}
              className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent justify-self-center"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <button type="button" onClick={() => onChange({ ...draft, lines: [...draft.lines, newSplitLine()] })} className="text-sm text-nibo-blue hover:underline flex items-center gap-1">
          <Plus className="w-4 h-4" /> Adicionar linha
        </button>
        <div className="flex items-center gap-3 text-sm">
          {remaining === 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> Rateado R$ {money(distributed)} de R$ {money(total)}
            </span>
          ) : (
            <>
              <span className={`flex items-center gap-1.5 ${error ? 'text-rose-700' : 'text-amber-700'}`}>
                <AlertCircle className="w-4 h-4" />
                {remaining > 0 ? `Falta ratear R$ ${money(remaining)}` : `Passou R$ ${money(-remaining)} do valor`}
              </span>
              {remaining > 0 && (
                <button type="button" onClick={fillRemaining} className="text-nibo-blue hover:underline">
                  Completar na última linha
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {error && remaining === 0 && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-xs text-slate-500">
        Uma categoria de {nature === 'INCOME' ? 'saída' : 'entrada'} entra subtraindo
        {nature === 'INCOME' ? ' — ex.: recebimento líquido da maquininha = venda − taxa do cartão.' : ' — ex.: pagamento líquido = despesa − desconto obtido.'}
      </p>
    </div>
  );
};
