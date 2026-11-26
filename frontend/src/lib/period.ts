/** Períodos (de/até, aaaa-mm-dd) usados nos seletores de Contas & Extratos, Fluxo de caixa e Resumo */

export interface Period {
  from: string;
  to: string;
}

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** Meses inteiros de `fromMonth` até `toMonth` (inclusive) */
export function monthsPeriod(year: number, fromMonth: number, monthsCount = 1): Period {
  const start = new Date(year, fromMonth, 1);
  const end = new Date(year, fromMonth + monthsCount, 0);
  return { from: isoDate(start), to: isoDate(end) };
}

/** Mês atual (padrão de Contas & Extratos) */
export const currentMonth = (): Period => {
  const now = new Date();
  return monthsPeriod(now.getFullYear(), now.getMonth());
};

/** Quantos meses inteiros o período cobre (0 = não começa no dia 1 ou não termina no último dia) */
export function wholeMonths(p: Period) {
  const a = parse(p.from);
  const b = parse(p.to);
  if (a.getDate() !== 1 || b.getDate() !== lastDay(b.getFullYear(), b.getMonth())) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

/** "Nov/2026", "Set/2026 - Nov/2026" ou "01/11/26 - 15/11/26" */
export function periodLabel(p: Period) {
  const a = parse(p.from);
  const b = parse(p.to);
  const n = wholeMonths(p);
  if (n === 1) return `${MONTHS[a.getMonth()]}/${a.getFullYear()}`;
  if (n > 1) return `${MONTHS[a.getMonth()]}/${a.getFullYear()} - ${MONTHS[b.getMonth()]}/${b.getFullYear()}`;
  const short = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
  return `${short(a)} - ${short(b)}`;
}

/** Período "longo" para títulos de relatório: 01/11/2026 a 30/11/2026 */
export const periodText = (p: Period) => `${p.from.split('-').reverse().join('/')} a ${p.to.split('-').reverse().join('/')}`;

/** Setas: anda o mesmo tamanho (em meses, se forem meses inteiros; senão em dias) */
export function shiftPeriod(p: Period, direction: 1 | -1): Period {
  const n = wholeMonths(p);
  const a = parse(p.from);
  if (n > 0) return monthsPeriod(a.getFullYear(), a.getMonth() + direction * n, n);
  const b = parse(p.to);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const move = (d: Date) => isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + direction * days));
  return { from: move(a), to: move(b) };
}

/** Dia anterior ao início (linha "Saldo anterior") */
export const dayBefore = (iso: string) => {
  const d = parse(iso);
  return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
};

export const MONTH_NAMES = MONTHS;
