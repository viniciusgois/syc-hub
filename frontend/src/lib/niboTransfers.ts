import * as XLSX from 'xlsx';

/** Uma transferência do relatório "Transferências" do Nibo (as duas linhas, saída e entrada, juntas) */
export interface NiboTransfer {
  lines: number[];
  date: string;
  from: string;
  to: string;
  amount: number;
  description: string | null;
}

export interface NiboTransfersFile {
  transfers: NiboTransfer[];
  /** Transferências em que o arquivo só trouxe um dos lados */
  unpaired: number[];
  skipped: { line: number; reason: string }[];
}

const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const text = (raw: unknown) => String(raw ?? '').replace(/\s+/g, ' ').trim() || null;
const pad = (n: number) => String(n).padStart(2, '0');

function toIso(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(raw ?? '').trim());
  return m ? `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}` : null;
}

/** -4958 | "(4.958,00)" | "4958.00" -> valor absoluto */
function toAmount(raw: unknown): number {
  if (typeof raw === 'number') return Math.abs(raw);
  let v = String(raw ?? '').replace(/[R$\s()]/g, '');
  if (!v) return 0;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = Math.abs(Number(v));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const COLUMNS: Record<string, 'date' | 'account' | 'description' | 'from' | 'to' | 'in' | 'out'> = {
  data: 'date',
  conta: 'account',
  'conta da movimentacao': 'account',
  descricao: 'description',
  'conta origem': 'from',
  'conta destino': 'to',
  entrada: 'in',
  saida: 'out',
};

/** Lê o Excel do relatório "Transferências" do Nibo */
export async function readNiboTransfersFile(file: File): Promise<NiboTransfersFile> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: null });
  const headerIndex = grid.findIndex((row) => {
    const names = new Set((row ?? []).map(norm));
    return names.has('conta origem') && names.has('conta destino');
  });
  if (headerIndex < 0) throw new Error('Não encontrei as colunas do relatório "Transferências" do Nibo (Conta origem, Conta destino, Entrada, Saida).');
  const col = new Map<string, number>();
  grid[headerIndex].forEach((h, i) => {
    const field = COLUMNS[norm(h)];
    if (field && !col.has(field)) col.set(field, i);
  });
  const get = (row: unknown[], f: string) => (col.has(f) ? row[col.get(f)!] : null);

  // Cada transferência vem em duas linhas (saída na origem e entrada no destino): junta pela data, contas e valor
  const groups = new Map<string, { date: string; from: string; to: string; amount: number; description: string | null; out: number[]; in: number[] }>();
  const skipped: NiboTransfersFile['skipped'] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    if (row.every((c) => c === null || String(c).trim() === '')) continue;
    const line = i + 1;
    if (norm(row[0]) === 'total') continue;
    const date = toIso(get(row, 'date'));
    const from = text(get(row, 'from'));
    const to = text(get(row, 'to'));
    const inValue = toAmount(get(row, 'in'));
    const outValue = toAmount(get(row, 'out'));
    const amount = outValue || inValue;
    if (!date || !from || !to || !amount) {
      skipped.push({ line, reason: !date ? 'Sem data' : !from || !to ? 'Sem conta de origem/destino' : 'Sem valor' });
      continue;
    }
    // Lado da linha: "Saida" preenchida, ou a conta da movimentação é a origem
    const isOut = outValue > 0 || (!inValue && norm(get(row, 'account')) === norm(from));
    const key = `${date}|${norm(from)}|${norm(to)}|${amount.toFixed(2)}`;
    const g = groups.get(key) ?? { date, from, to, amount, description: text(get(row, 'description')), out: [], in: [] };
    (isOut ? g.out : g.in).push(line);
    groups.set(key, g);
  }

  const transfers: NiboTransfer[] = [];
  const unpaired: number[] = [];
  for (const g of groups.values()) {
    const n = Math.max(g.out.length, g.in.length);
    if (g.out.length !== g.in.length) unpaired.push(...g.out, ...g.in);
    for (let k = 0; k < n; k++) {
      transfers.push({ lines: [g.out[k], g.in[k]].filter((v): v is number => v !== undefined), date: g.date, from: g.from, to: g.to, amount: g.amount, description: g.description });
    }
  }
  transfers.sort((a, b) => a.date.localeCompare(b.date) || a.lines[0] - b.lines[0]);
  return { transfers, unpaired, skipped };
}
