import React, { useMemo } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { categoryChoices } from '../../lib/categories';
import { money } from '../../lib/entries';
import { SearchSelect } from '../common/SearchSelect';
import { DifferenceChoiceValue, defaultCategory, differenceNeedsCategory, differenceOptions, resolveDifference } from '../../lib/difference';

const LABEL: Record<Exclude<DifferenceChoiceValue, ''>, string> = {
  CARD_FEE: 'Tarifa de cartão',
  DISCOUNT: 'Desconto',
  OTHER_FEES: 'Demais tarifas',
  INTEREST: 'Juros/multa',
  PARTIAL: 'Pagamento parcial',
};

/**
 * Pergunta o motivo da diferença entre o valor agendado e o que passou no banco, e a categoria do ajuste.
 */
export const DifferenceChoice: React.FC<{
  statementAmount: number;
  openTotal: number;
  choice: DifferenceChoiceValue;
  onChange: (choice: DifferenceChoiceValue) => void;
  verb: 'recebimento' | 'pagamento';
  /** Categoria da diferença (vazio = padrão) */
  category: string;
  onCategoryChange: (id: string) => void;
}> = ({ statementAmount, openTotal, choice, onChange, verb, category, onCategoryChange }) => {
  const { currentCompany, categories } = useCompany();
  const options = useMemo(
    () => categoryChoices(categories).map((o) => ({ value: o.value, label: `${o.type === 'INCOME' ? '↑' : '↓'} ${o.label}`, group: o.group })),
    [categories],
  );
  const diff = Math.round((statementAmount - openTotal) * 100) / 100;
  if (Math.abs(diff) < 0.005 || openTotal === 0) return null;

  const receiving = verb === 'recebimento';
  const excess = diff > 0;
  const reasons = differenceOptions(receiving, excess);
  const { reason } = resolveDifference(choice, receiving, statementAmount, openTotal);
  const selected = reason ?? 'PARTIAL';
  const fallback = reason ? defaultCategory(categories, reason, receiving, currentCompany.splitsEnabled) : null;
  const missing = differenceNeedsCategory(categories, reason, category);

  const hint: Record<Exclude<DifferenceChoiceValue, ''>, string> = {
    CARD_FEE: 'taxa da maquininha/operadora (vai para despesa)',
    DISCOUNT: receiving ? 'abatimento dado ao cliente' : 'abatimento recebido do fornecedor',
    OTHER_FEES: 'tarifa de boleto, TED, banco... (vai para despesa)',
    INTEREST: receiving ? 'acréscimo pago pelo cliente' : 'acréscimo por atraso',
    PARTIAL: `R$ ${money(Math.abs(diff))} continuam em aberto para ${receiving ? 'receber' : 'pagar'} depois`,
  };

  return (
    <fieldset className="px-4 py-3 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900 space-y-2">
      <legend className="sr-only">Motivo da diferença</legend>
      <p>
        O banco tem <strong>R$ {money(Math.abs(diff))}</strong> {excess ? 'a mais' : 'a menos'} que o agendado.{' '}
        <strong>Qual o motivo da diferença entre o valor agendado e o valor {receiving ? 'recebido' : 'pago'}?</strong>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {reasons.map((r) => (
          <label key={r} className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="diff-reason" checked={selected === r} onChange={() => onChange(r)} className="mt-1 accent-nibo-blue" />
            <span>
              <strong>{LABEL[r]}</strong> <span className="text-amber-800/80">— {hint[r]}</span>
            </span>
          </label>
        ))}
      </div>
      {reason && (
        <div className="pt-1">
          <label htmlFor="diff-category" className="block text-xs font-medium text-amber-900 mb-1">
            Categoria {reason === 'CARD_FEE' ? 'da tarifa de cartão' : reason === 'OTHER_FEES' ? 'das tarifas' : reason === 'INTEREST' ? 'dos juros/multa' : 'do desconto'}
          </label>
          <div className="bg-white rounded">
            <SearchSelect
              id="diff-category"
              size="sm"
              value={category}
              onChange={onCategoryChange}
              options={options}
              placeholder={`Padrão: ${fallback ? fallback.name : 'a categoria do lançamento'}`}
              clearable
              error={missing ? 'Escolha a categoria' : undefined}
            />
          </div>
          {missing && <p className="mt-1 text-xs text-rose-700">Esta empresa não tem uma categoria padrão para essa tarifa: escolha onde ela deve ficar.</p>}
        </div>
      )}
    </fieldset>
  );
};
