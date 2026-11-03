import React, { useMemo } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { categoryChoices } from '../../lib/categories';
import { money } from '../../lib/entries';
import { SearchSelect } from '../common/SearchSelect';

export type DifferenceMode = 'ADJUST' | 'PARTIAL';

/**
 * Explica/decide o que fazer quando o valor da linha do extrato difere do total em aberto:
 * - linha maior: a diferença vira juros/multa (sem escolha)
 * - linha menor: quitar com desconto (ADJUST) ou baixa parcial, restante em aberto (PARTIAL)
 */
export const DifferenceChoice: React.FC<{
  statementAmount: number;
  openTotal: number;
  mode: DifferenceMode;
  onChange: (mode: DifferenceMode) => void;
  verb: 'recebimento' | 'pagamento';
  /** Categoria da diferença (vazio = padrão) */
  category: string;
  onCategoryChange: (id: string) => void;
}> = ({ statementAmount, openTotal, mode, onChange, verb, category, onCategoryChange }) => {
  const { currentCompany, categories } = useCompany();
  const options = useMemo(
    () => categoryChoices(categories).map((o) => ({ value: o.value, label: `${o.type === 'INCOME' ? '↑' : '↓'} ${o.label}`, group: o.group })),
    [categories],
  );
  const diff = Math.round((statementAmount - openTotal) * 100) / 100;
  if (Math.abs(diff) < 0.005 || openTotal === 0) return null;

  const receiving = verb === 'recebimento';
  // Sem escolha: com rateio ativo vai para a categoria do sistema; senão, para a do próprio lançamento
  const fallback = !currentCompany.splitsEnabled
    ? 'a categoria do lançamento'
    : diff > 0
      ? receiving
        ? 'Multas recebidas'
        : 'Multas pagas'
      : receiving
        ? 'Descontos concedidos'
        : 'Descontos obtidos';
  const categoryPicker = (
    <div className="pt-1">
      <label htmlFor="diff-category" className="block text-xs font-medium text-amber-900 mb-1">
        Classificar a diferença em <span className="font-normal">(ex.: Taxas de cartão para a maquininha)</span>
      </label>
      <div className="bg-white rounded">
        <SearchSelect id="diff-category" size="sm" value={category} onChange={onCategoryChange} options={options} placeholder={`Padrão: ${fallback}`} clearable />
      </div>
    </div>
  );

  if (diff > 0) {
    return (
      <div className="px-4 py-3 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900 space-y-2">
        <p>
          O extrato tem <strong>R$ {money(diff)}</strong> a mais que o total em aberto. A diferença será registrada como <strong>juros/multa</strong>.
        </p>
        {categoryPicker}
      </div>
    );
  }

  return (
    <fieldset className="px-4 py-3 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900 space-y-2">
      <legend className="sr-only">Como tratar a diferença</legend>
      <p>
        O extrato tem <strong>R$ {money(-diff)}</strong> a menos que o total em aberto. O que aconteceu?
      </p>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="radio" name="diff-mode" checked={mode === 'ADJUST'} onChange={() => onChange('ADJUST')} className="mt-1 accent-nibo-blue" />
        <span>
          <strong>Quitar com desconto</strong> — o {verb} está completo; a diferença é desconto, abatimento ou taxa.
        </span>
      </label>
      {mode === 'ADJUST' && <div className="pl-6">{categoryPicker}</div>}
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="radio" name="diff-mode" checked={mode === 'PARTIAL'} onChange={() => onChange('PARTIAL')} className="mt-1 accent-nibo-blue" />
        <span>
          <strong>Baixa parcial</strong> — R$ {money(-diff)} continuam em aberto para {verb === 'recebimento' ? 'receber' : 'pagar'} depois.
        </span>
      </label>
    </fieldset>
  );
};
