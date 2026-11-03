import * as XLSX from 'xlsx';

/** Uma linha do relatório "Unificado por lançamento" do Nibo, já normalizada para a API */
export interface NiboRow {
  line: number;
  /** Coluna "Agendamento": id do lançamento no Nibo (repete nas linhas de um rateio) */
  scheduleId: string | null;
  kind: 'RECEIVED' | 'PAID' | 'TO_RECEIVE' | 'TO_PAY';
  starred: boolean;
  scheduledAtBank: boolean;
  recurring: boolean;
  paidAt: string | null;
  dueDate: string | null;
  issueDate: string | null;
  expectedDate: string | null;
  contact: string | null;
  description: string | null;
  reference: string | null;
  identifier: string | null;
  category: string | null;
  costCenter: string | null;
  account: string | null;
  categoryValue: number;
  settledValue: number;
  openValue: number;
}

export interface NiboTotals {
  received: number;
  paid: number;
  toReceive: number;
  toPay: number;
}

export interface NiboFile {
  rows: NiboRow[];
  /** Totais do cabeçalho do relatório (quando a planilha traz) */
  reportTotals: Partial<NiboTotals>;
  /** Linhas ignoradas (tipo desconhecido, sem valor...) */
  skipped: { line: number; reason: string }[];
  companyName: string | null;
}

const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Cabeçalhos do Nibo -> campo */
const COLUMNS = {
  agendamento: 'scheduleId',
  favorito: 'starred',
  'programado no banco': 'scheduledAtBank',
  'pagamento ou recebimento': 'paidAt',
  vencimento: 'dueDate',
  competencia: 'issueDate',
  'previsto para': 'expectedDate',
  contato: 'contact',
  descricao: 'description',
  referencia: 'reference',
  identificador: 'identifier',
  categoria: 'category',
  'centro de custo': 'costCenter',
  conta: 'account',
  tipo: 'kind',
  recorrencia: 'recurring',
  'valor da categoria': 'categoryValue',
  'valor a receber': 'toReceive',
  'valor a pagar': 'toPay',
  'valor pago': 'paid',
  'valor recebido': 'received',
} as const;
type Field = (typeof COLUMNS)[keyof typeof COLUMNS];
const REQUIRED: Field[] = ['dueDate', 'category', 'kind', 'categoryValue'];

const KINDS: Record<string, NiboRow['kind']> = { recebido: 'RECEIVED', pago: 'PAID', 'a receber': 'TO_RECEIVE', 'a pagar': 'TO_PAY' };

const pad = (n: number) => String(n).padStart(2, '0');

/** Date, serial do Excel, dd/mm/aaaa ou aaaa-mm-dd -> aaaa-mm-dd */
function toIso(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw);
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null;
  }
  const text = String(raw ?? '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 1234.56 | "1.234,56" | "-169.00" | "R$ 1.234,56" -> número */
function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  let v = String(raw ?? '').replace(/[R$\s]/g, '');
  if (!v) return 0;
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const text = (raw: unknown) => {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return v || null;
};
const yes = (raw: unknown) => norm(raw) === 'sim';
const round = (v: number) => Math.round(v * 100) / 100;

/** Lê a planilha exportada pelo Nibo (Relatórios › Unificado por lançamento › Excel) */
export async function readNiboFile(file: File): Promise<NiboFile> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  // Cabeçalho: a primeira linha que tem as colunas do relatório
  const headerIndex = grid.findIndex((row) => {
    const names = new Set((row ?? []).map(norm));
    return names.has('vencimento') && names.has('categoria') && names.has('tipo');
  });
  if (headerIndex < 0) {
    throw new Error('Não encontrei o cabeçalho do relatório. Exporte do Nibo o relatório "Unificado por lançamento" em Excel, sem alterar as colunas.');
  }
  const col = new Map<Field, number>();
  grid[headerIndex].forEach((h, i) => {
    const field = COLUMNS[norm(h) as keyof typeof COLUMNS];
    if (field && !col.has(field)) col.set(field, i);
  });
  const missing = REQUIRED.filter((f) => !col.has(f));
  if (missing.length) throw new Error('A planilha não tem todas as colunas do relatório "Unificado por lançamento" (Vencimento, Categoria, Tipo, Valor da categoria).');

  // Totais do topo (Recebido / A Receber / Pago / A Pagar com o valor logo abaixo)
  const reportTotals: Partial<NiboTotals> = {};
  const labels: Record<string, keyof NiboTotals> = { recebido: 'received', 'a receber': 'toReceive', pago: 'paid', 'a pagar': 'toPay' };
  for (let r = 0; r < headerIndex; r++) {
    (grid[r] ?? []).forEach((cell, c) => {
      const key = labels[norm(cell)];
      const below = grid[r + 1]?.[c];
      if (key && reportTotals[key] === undefined && below !== null && below !== undefined && String(below).trim() !== '') {
        reportTotals[key] = round(Math.abs(toNumber(below)));
      }
    });
  }
  const companyName = headerIndex > 0 ? text(grid[0]?.find((c) => text(c))) : null;

  const get = (row: unknown[], f: Field) => (col.has(f) ? row[col.get(f)!] : null);
  const rows: NiboRow[] = [];
  const skipped: NiboFile['skipped'] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    if (row.every((c) => c === null || String(c).trim() === '')) continue;
    const line = i + 1; // número da linha no Excel
    const kindText = norm(get(row, 'kind'));
    if (!kindText && norm(row[0]) === 'total') continue; // linha de total do relatório
    const kind = KINDS[kindText];
    if (!kind) {
      skipped.push({ line, reason: kindText ? `Tipo "${text(get(row, 'kind'))}" não reconhecido` : 'Sem tipo' });
      continue;
    }
    const categoryValue = toNumber(get(row, 'categoryValue'));
    const settledValue = Math.abs(toNumber(get(row, kind === 'RECEIVED' ? 'received' : 'paid'))) || (kind === 'RECEIVED' || kind === 'PAID' ? Math.abs(categoryValue) : 0);
    const openValue = Math.abs(toNumber(get(row, kind === 'TO_RECEIVE' ? 'toReceive' : 'toPay'))) || (kind === 'TO_RECEIVE' || kind === 'TO_PAY' ? Math.abs(categoryValue) : 0);
    if (!categoryValue && !settledValue && !openValue) {
      skipped.push({ line, reason: 'Sem valor' });
      continue;
    }
    rows.push({
      line,
      scheduleId: text(get(row, 'scheduleId')),
      kind,
      starred: yes(get(row, 'starred')),
      scheduledAtBank: yes(get(row, 'scheduledAtBank')),
      recurring: yes(get(row, 'recurring')),
      paidAt: toIso(get(row, 'paidAt')),
      dueDate: toIso(get(row, 'dueDate')),
      issueDate: toIso(get(row, 'issueDate')),
      expectedDate: toIso(get(row, 'expectedDate')),
      contact: text(get(row, 'contact')),
      description: text(get(row, 'description')),
      reference: text(get(row, 'reference')),
      identifier: text(get(row, 'identifier')),
      category: text(get(row, 'category')),
      costCenter: text(get(row, 'costCenter')),
      // Nas contas em aberto o Nibo repete o tipo na coluna Conta ("A Pagar")
      account: KINDS[norm(get(row, 'account'))] ? null : text(get(row, 'account')),
      categoryValue: round(categoryValue),
      settledValue: round(settledValue),
      openValue: round(openValue),
    });
  }
  return { rows, reportTotals, skipped, companyName };
}
