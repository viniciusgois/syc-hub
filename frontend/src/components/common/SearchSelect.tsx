import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface SearchOption {
  value: string;
  label: string;
  sublabel?: string;
  group?: string;
}

const normalize = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Select pesquisável com grupos (contatos, categorias...) */
export const SearchSelect: React.FC<{
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  error?: string;
  clearable?: boolean;
  emptyText?: string;
  size?: 'md' | 'sm';
  /** Mostra "-- Criar novo --" no topo da lista (e "+ Criar "texto"" ao pesquisar); recebe o texto pesquisado */
  onCreate?: (query: string) => void;
}> = ({ id, value, onChange, options, placeholder = 'Selecione...', error, clearable, emptyText = 'Nenhum resultado', size = 'md', onCreate }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    searchRef.current?.focus();
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const term = normalize(query.trim());
    return term ? options.filter((o) => normalize(`${o.label} ${o.sublabel ?? ''}`).includes(term)) : options;
  }, [options, query]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchOption[]>();
    for (const o of filtered) map.set(o.group ?? '', [...(map.get(o.group ?? '') ?? []), o]);
    return [...map.entries()];
  }, [filtered]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };

  const create = () => {
    onCreate?.(query.trim());
    setOpen(false);
    setQuery('');
  };

  // Com onCreate, o índice -1 é a opção "Criar novo"
  const minIndex = onCreate ? -1 : 0;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, minIndex));
    } else if (e.key === 'Enter' && onCreate && (highlight === -1 || !filtered.length)) {
      e.preventDefault();
      create();
    } else if (e.key === 'Enter' && filtered[highlight]) {
      e.preventDefault();
      choose(filtered[highlight].value);
    } else if (e.key === 'Escape') {
      e.preventDefault(); // fecha só a lista
      setOpen(false);
    }
  };

  const h = size === 'sm' ? 'h-9' : 'h-10';
  let index = -1;
  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-full ${h} pl-3 pr-14 rounded border text-sm text-left bg-white truncate focus:outline-none focus:ring-2 ${
          error ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
        } ${open ? 'border-nibo-blue ring-2 ring-nibo-blueLight' : ''} ${selected ? 'text-slate-800' : 'text-slate-400'}`}
      >
        {selected ? selected.label : placeholder}
      </button>
      {clearable && selected && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpar"
          className="absolute right-8 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <span
        className={`pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 border-x-[5px] border-x-transparent ${
          open ? 'border-b-[6px] border-b-slate-500' : 'border-t-[6px] border-t-slate-500'
        }`}
      />

      {open && (
        <div className="absolute z-30 left-0 right-0 min-w-[260px] mt-1 bg-white border border-slate-200 rounded shadow-lg">
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
              placeholder="Buscar..."
              aria-label="Buscar"
              className="w-full h-9 pl-8 pr-3 rounded border border-slate-200 text-sm focus:outline-none focus:border-nibo-blue"
            />
          </div>
          <div className="max-h-72 overflow-y-auto" role="listbox">
            {onCreate && (
              <button
                type="button"
                onMouseEnter={() => setHighlight(-1)}
                onClick={create}
                className={`w-full px-4 py-2 text-left text-sm text-nibo-blue truncate ${highlight === -1 ? 'bg-nibo-blueLight' : ''}`}
              >
                {query.trim() ? `+ Criar "${query.trim()}"` : '-- Criar novo --'}
              </button>
            )}
            {!filtered.length && <p className="px-4 py-3 text-sm text-slate-500">{emptyText}</p>}
            {groups.map(([group, items]) => (
              <div key={group || '_'}>
                {group && <p className="px-4 py-1.5 bg-slate-100 text-[11px] font-bold tracking-wide text-slate-600 uppercase sticky top-0">{group}</p>}
                {items.map((o) => {
                  index++;
                  const i = index;
                  const active = i === highlight;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      aria-selected={o.value === value}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => choose(o.value)}
                      className={`w-full px-4 py-2 text-left text-sm ${active ? 'bg-nibo-blueLight' : ''} ${
                        o.value === value || active ? 'text-nibo-blue' : 'text-slate-700'
                      }`}
                    >
                      <span className="block truncate">{o.label}</span>
                      {o.sublabel && <span className="block text-xs text-slate-400 truncate">{o.sublabel}</span>}
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
