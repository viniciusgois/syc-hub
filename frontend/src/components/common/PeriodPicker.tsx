import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTH_NAMES, Period, monthsPeriod, periodLabel, shiftPeriod } from '../../lib/period';

/**
 * Seletor de período no padrão Nibo: setas para andar e, clicando no rótulo, um quadro com o ano,
 * a grade de meses (um clique = o mês inteiro) e o intervalo livre "de / a" com Aplicar.
 */
export const PeriodPicker: React.FC<{
  value: Period;
  onChange: (p: Period) => void;
  /** Quantos meses um clique na grade seleciona (Fluxo de caixa usa 1 também; o padrão de 3 meses vem da tela) */
  size?: 'md' | 'lg';
}> = ({ value, onChange, size = 'lg' }) => {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.from.slice(0, 4)));
  const [draft, setDraft] = useState<Period>(value);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      setYear(Number(value.from.slice(0, 4)));
      setDraft(value);
      setError(null);
    }
    setOpen((o) => !o);
  };

  const pickMonth = (m: number) => {
    onChange(monthsPeriod(year, m));
    setOpen(false);
  };

  const apply = () => {
    if (!draft.from || !draft.to) return setError('Informe as duas datas');
    if (draft.from > draft.to) return setError('A data inicial deve ser antes da final');
    onChange(draft);
    setOpen(false);
  };

  // Mês destacado na grade: os que estão dentro do período escolhido
  const inRange = (m: number) => {
    const first = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const last = `${year}-${String(m + 1).padStart(2, '0')}-${String(new Date(year, m + 1, 0).getDate()).padStart(2, '0')}`;
    return first <= value.to && last >= value.from;
  };

  const big = size === 'lg';
  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <button type="button" onClick={() => onChange(shiftPeriod(value, -1))} aria-label="Período anterior" className="p-1 rounded text-nibo-blue hover:bg-slate-100 print:hidden">
        <ChevronLeft className={big ? 'w-5 h-5' : 'w-4 h-4'} />
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Escolher período"
        className={`${big ? 'text-lg min-w-24' : 'text-sm min-w-20'} px-1 rounded text-slate-700 hover:bg-slate-100 text-center whitespace-nowrap`}
      >
        {periodLabel(value)}
      </button>
      <button type="button" onClick={() => onChange(shiftPeriod(value, 1))} aria-label="Próximo período" className="p-1 rounded text-nibo-blue hover:bg-slate-100 print:hidden">
        <ChevronRight className={big ? 'w-5 h-5' : 'w-4 h-4'} />
      </button>

      {open && (
        <div role="dialog" aria-label="Escolher período" className="print:hidden absolute right-0 top-full mt-2 z-40 w-[22rem] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-md shadow-xl text-slate-700">
          <div className="flex items-center justify-between px-4 pt-3">
            <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="Ano anterior" className="p-1 rounded text-nibo-blue hover:bg-slate-100">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-base font-medium">{year}</span>
            <button type="button" onClick={() => setYear((y) => y + 1)} aria-label="Próximo ano" className="p-1 rounded text-nibo-blue hover:bg-slate-100">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1 px-4 py-3">
            {MONTH_NAMES.map((name, m) => (
              <button
                key={name}
                type="button"
                onClick={() => pickMonth(m)}
                className={`h-10 rounded-full text-sm ${inRange(m) ? 'bg-nibo-blue text-white' : 'hover:bg-slate-100'}`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="border-t border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="date"
                aria-label="De"
                value={draft.from}
                onChange={(e) => (setDraft((d) => ({ ...d, from: e.target.value })), setError(null))}
                className="flex-1 min-w-0 h-9 px-2 rounded border border-slate-300 text-sm focus:outline-none focus:border-nibo-blue"
              />
              <span className="text-sm text-slate-500">a</span>
              <input
                type="date"
                aria-label="Até"
                value={draft.to}
                onChange={(e) => (setDraft((d) => ({ ...d, to: e.target.value })), setError(null))}
                className="flex-1 min-w-0 h-9 px-2 rounded border border-slate-300 text-sm focus:outline-none focus:border-nibo-blue"
              />
            </div>
            {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
            <div className="flex justify-end mt-2">
              <button type="button" onClick={apply} className="h-9 px-4 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium">
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
