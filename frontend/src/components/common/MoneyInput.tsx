import React from 'react';

/**
 * Campo de valor em reais no padrão Nibo: digita-se os centavos ("12345" -> 123,45).
 * Com allowNegative, a tecla "-" alterna o sinal.
 */
export const MoneyInput: React.FC<{
  id?: string;
  value: number;
  onChange: (v: number) => void;
  allowNegative?: boolean;
  error?: string;
  disabled?: boolean;
  prefix?: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}> = ({ id, value, onChange, allowNegative = true, error, disabled, prefix, className = '', ...rest }) => {
  const display = value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="relative">
      {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">{prefix}</span>}
      <input
        id={id}
        inputMode="decimal"
        value={display}
        disabled={disabled}
        aria-label={rest['aria-label']}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === '-') {
            e.preventDefault();
            if (allowNegative) onChange(-value);
          }
        }}
        onChange={(e) => {
          const negative = allowNegative && e.target.value.includes('-');
          const cents = Number(e.target.value.replace(/\D/g, '').slice(0, 13) || '0');
          onChange((negative ? -cents : cents) / 100);
        }}
        className={`w-full h-10 px-3 ${prefix ? 'pl-9' : ''} rounded border text-sm text-right font-mono focus:outline-none focus:ring-2 transition-colors ${
          error ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
        } ${disabled ? 'bg-slate-100 text-slate-400' : 'bg-white'} ${value < 0 ? 'text-rose-600' : 'text-slate-800'} ${className}`}
      />
    </div>
  );
};
