import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { accountColor } from '../../lib/accounts';
import type { Bank } from './useBanks';


// Ordem do grupo "Mais usados"
const POPULAR_ORDER = ['1', '237', '104', '341', '33', '260', '77', '756', '748', '336', '208', '290', '323', '197'];

/** Minúsculas e sem acentos, para a busca: "Itaú" -> "itau" */
const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const inputClass = (error?: string, width = 'w-full') =>
  `${width} h-10 px-3 rounded border text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 transition-colors ${
    error ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
  }`;

const BankLogo: React.FC<{ bank: Bank }> = ({ bank }) => {
  const [failed, setFailed] = useState(false);
  if (bank.logoUrl && !failed) {
    return <img src={bank.logoUrl} alt="" onError={() => setFailed(true)} className="w-7 h-7 rounded-md object-contain bg-white shrink-0" />;
  }
  return (
    <span
      className="w-7 h-7 rounded-md text-white text-[10px] font-bold flex items-center justify-center shrink-0"
      style={{ backgroundColor: accountColor('CHECKING', bank.code) }}
    >
      {bank.name.slice(0, 2).toUpperCase()}
    </span>
  );
};

export const BankSelect: React.FC<{
  id?: string;
  banks: Bank[] | null;
  loadError: string | null;
  value: Bank | null;
  onChange: (bank: Bank) => void;
  error?: string;
  placeholder?: string;
}> = ({ id, banks, loadError, value, onChange, error, placeholder = 'Selecione um banco' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    searchRef.current?.focus();
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const groups = useMemo(() => {
    const term = normalize(query.trim());
    const matches = (banks ?? []).filter(
      (b) => !term || normalize(b.name).includes(term) || b.code === term.replace(/^0+/, ''),
    );
    // Na busca, bancos mais usados e nomes que começam com o termo aparecem primeiro
    const rank = (b: Bank) => (b.code === term.replace(/^0+/, '') ? 0 : b.popular ? 1 : normalize(b.name).startsWith(term) ? 2 : 3);
    const all = term ? [...matches].sort((x, y) => rank(x) - rank(y)) : matches;
    const popular = term
      ? []
      : POPULAR_ORDER.map((code) => all.find((b) => b.code === code)).filter((b): b is Bank => !!b);
    return [
      { label: 'Mais usados', items: popular },
      { label: 'Todos', items: all },
    ].filter((g) => g.items.length);
  }, [banks, query]);

  const flat = groups.flatMap((g) => g.items);

  const choose = (bank: Bank) => {
    onChange(bank);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && flat[highlight]) {
      e.preventDefault();
      choose(flat[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault(); // fecha só a lista, não a gaveta
      setOpen(false);
    }
  };

  let index = -1;
  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass(error)} flex items-center gap-2.5 text-left pr-9 ${open ? 'border-nibo-blue ring-2 ring-nibo-blueLight' : ''}`}
      >
        {value ? (
          <>
            <BankLogo bank={value} />
            <span className="truncate">
              {value.name} ({value.code})
            </span>
          </>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
        <span
          className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 border-x-[5px] border-x-transparent ${
            open ? 'border-b-[6px] border-b-slate-500' : 'border-t-[6px] border-t-slate-500'
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded shadow-lg">
          <div className="p-2 border-b border-slate-100 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Buscar por nome ou código"
              aria-label="Buscar banco"
              className="w-full h-9 pl-8 pr-3 rounded border border-slate-200 text-sm focus:outline-none focus:border-nibo-blue"
            />
          </div>
          <div className="max-h-72 overflow-y-auto" role="listbox">
            {!banks && !loadError && (
              <p className="px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando bancos...
              </p>
            )}
            {loadError && <p className="px-4 py-3 text-sm text-rose-600">{loadError}</p>}
            {banks && !flat.length && <p className="px-4 py-3 text-sm text-slate-500">Nenhum banco encontrado.</p>}
            {groups.map((g) => (
              <div key={g.label}>
                <p className="px-4 py-2 bg-slate-100 text-xs font-bold tracking-wide text-slate-600 uppercase sticky top-0">{g.label}</p>
                {g.items.map((bank) => {
                  index++;
                  const i = index;
                  const active = i === highlight;
                  const selected = value?.code === bank.code;
                  return (
                    <button
                      key={`${g.label}-${bank.code}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => choose(bank)}
                      className={`w-full px-4 py-2 flex items-center gap-3 text-left text-sm ${
                        active ? 'bg-nibo-blueLight' : ''
                      } ${selected || active ? 'text-nibo-blue' : 'text-slate-700'}`}
                    >
                      <BankLogo bank={bank} />
                      <span className="truncate">
                        {bank.name} ({bank.code})
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
