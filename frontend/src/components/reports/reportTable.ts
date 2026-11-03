import * as XLSX from 'xlsx';
import { brDate } from '../../lib/entries';
import { ReportRow, accounting } from '../../lib/reports';

export type ColumnKey =
  | 'paidAt'
  | 'dueDate'
  | 'issueDate'
  | 'contactName'
  | 'description'
  | 'categoryName'
  | 'costCenterName'
  | 'bankAccountName'
  | 'status'
  | 'value'
  | 'groupTotal';

export interface Column {
  key: ColumnKey;
  label: string;
}

export const isMoney = (k: ColumnKey) => k === 'value' || k === 'groupTotal';
export const isDate = (k: ColumnKey) => k === 'paidAt' || k === 'dueDate' || k === 'issueDate';

export const sortValue = (r: ReportRow, k: ColumnKey): string | number => {
  if (k === 'status') return r.realized ? 1 : 0;
  const v = r[k];
  return typeof v === 'number' ? v : (v ?? '');
};

/** Texto da célula (também usado na exportação) */
export const cellText = (r: ReportRow, k: ColumnKey) => {
  if (k === 'status') return r.realized ? 'Realizado' : 'Agendado';
  if (isDate(k)) return brDate(r[k] as string | null);
  if (isMoney(k)) return accounting(r[k] as number);
  return (r[k] as string | null) ?? '';
};

/** Total do movimento: cada baixa/lançamento conta uma vez (as linhas do rateio repetem o valor) */
export const groupTotalOf = (rows: ReportRow[]) => [...new Map(rows.map((r) => [r.group, r.groupTotal])).values()].reduce((s, v) => s + v, 0);

export function exportRows(fileName: string, title: string, subtitle: string, columns: Column[], rows: ReportRow[]) {
  const aoa: (string | number)[][] = [
    [title],
    [subtitle],
    [],
    columns.map((c) => c.label),
    ...rows.map((r) => columns.map((c) => (isMoney(c.key) ? (r[c.key] as number) : cellText(r, c.key)))),
    columns.map((c, i) => (c.key === 'value' ? rows.reduce((s, r) => s + r.value, 0) : c.key === 'groupTotal' ? groupTotalOf(rows) : i === 0 ? 'Total' : '')),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), title.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}

