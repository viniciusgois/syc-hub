import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ReportRow, accounting } from '../../lib/reports';
import { Column, ColumnKey, cellText, groupTotalOf, isDate, isMoney, sortValue } from './reportTable';

/** Largura máxima das colunas de texto (o resto aparece no tooltip) */
const TEXT_WIDTH: Partial<Record<ColumnKey, string>> = {
  description: 'max-w-[180px]',
  contactName: 'max-w-[150px]',
  categoryName: 'max-w-[135px]',
  costCenterName: 'max-w-[120px]',
  bankAccountName: 'max-w-[115px]',
};

/**
 * Tabela dos relatórios: colunas ordenáveis, valores no padrão contábil e linha de total.
 * `onOpen` torna a descrição um link (abre o lançamento).
 */
export const RowsTable: React.FC<{
  columns: Column[];
  rows: ReportRow[];
  onOpen?: (row: ReportRow) => void;
  emptyText?: string;
  defaultSort?: ColumnKey;
}> = ({ columns, rows, onOpen, emptyText = 'Nenhum lançamento encontrado.', defaultSort }) => {
  const [sort, setSort] = useState<{ key: ColumnKey; dir: 1 | -1 } | null>(defaultSort ? { key: defaultSort, dir: 1 } : null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR');
      return c * sort.dir || a.group.localeCompare(b.group);
    });
  }, [rows, sort]);

  const toggleSort = (key: ColumnKey) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <div className="overflow-x-auto border border-slate-200 rounded">
      <table className="w-full text-[13px] text-slate-700">
        <thead className="bg-slate-100 text-slate-700">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-2 py-2 font-medium leading-tight align-bottom ${isMoney(c.key) ? 'text-right' : 'text-left'}`} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                <button type="button" onClick={() => toggleSort(c.key)} className={`inline-flex items-center gap-1 hover:text-slate-900 ${isMoney(c.key) ? 'text-right max-w-[110px]' : 'text-left'} ${sort?.key === c.key ? 'text-nibo-blue' : ''}`}>
                  {c.label}
                  {sort?.key === c.key && (sort.dir === 1 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-slate-500">
                {emptyText}
              </td>
            </tr>
          ) : (
            sorted.map((r, i) => (
              <tr key={`${r.group}-${i}`} className="hover:bg-slate-50">
                {columns.map((c) => {
                  const text = cellText(r, c.key);
                  if (c.key === 'description' && onOpen && r.entry) {
                    return (
                      <td key={c.key} className="px-2 py-2.5">
                        <button type="button" onClick={() => onOpen(r)} className={`block text-nibo-blue hover:underline text-left truncate ${TEXT_WIDTH.description}`} title={text}>
                          {text}
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c.key}
                      title={text}
                      className={`px-2 py-2.5 ${isMoney(c.key) ? `text-right whitespace-nowrap ${(r[c.key] as number) < 0 ? 'text-rose-600' : ''}` : ''} ${
                        isDate(c.key) ? `whitespace-nowrap ${c.key === 'dueDate' && r.isOverdue ? 'text-rose-600 font-medium' : ''}` : ''
                      } ${c.key === 'status' ? (r.realized ? 'text-emerald-700' : 'text-amber-700') : ''}`}
                    >
                      {/* Em tabela automática o max-width da célula não vale; o limite fica no conteúdo */}
                      {TEXT_WIDTH[c.key] ? <span className={`block truncate ${TEXT_WIDTH[c.key]}`}>{text}</span> : text}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
        {sorted.length > 0 && (
          <tfoot className="bg-slate-100 font-medium text-slate-800">
            <tr>
              {columns.map((c, i) => {
                const v = c.key === 'value' ? rows.reduce((s, r) => s + r.value, 0) : c.key === 'groupTotal' ? groupTotalOf(rows) : null;
                return (
                  <td key={c.key} className={`px-3 py-3 ${v !== null ? `text-right whitespace-nowrap ${v < 0 ? 'text-rose-600' : ''}` : ''}`}>
                    {v !== null ? accounting(v) : i === 0 ? 'Total' : ''}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
};
