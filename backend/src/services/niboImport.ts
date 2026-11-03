import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type AccountType, type CategoryType, type DRESection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { recalculateBalances } from './balance.js';
import { sha256 } from './ofx.js';
import { correctCategoryName } from './ptCorrections.js';

/**
 * Migração a partir do relatório "Unificado por lançamento" do Nibo (Excel).
 * O frontend lê a planilha e envia uma linha normalizada por linha do relatório; aqui a prévia agrupa contas,
 * categorias, centros de custo e contatos, confere os totais e lista o que precisa de revisão.
 * Linhas com o mesmo "Agendamento" são um lançamento só com rateio (o Nibo exporta uma linha por parte).
 * A gravação cria tudo numa transação e registra os ids para poder desfazer a importação inteira.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const isoDate = z.iso.date();

export const niboRowSchema = z.object({
  line: z.number().int(),
  /** Coluna "Agendamento": id do lançamento no Nibo (repete nas linhas de um rateio) */
  scheduleId: z.string().trim().max(50).nullish(),
  kind: z.enum(['RECEIVED', 'PAID', 'TO_RECEIVE', 'TO_PAY']),
  starred: z.boolean().default(false),
  scheduledAtBank: z.boolean().default(false),
  recurring: z.boolean().default(false),
  paidAt: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  issueDate: isoDate.nullish(),
  expectedDate: isoDate.nullish(),
  contact: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(500).nullish(),
  reference: z.string().trim().max(100).nullish(),
  identifier: z.string().trim().max(200).nullish(),
  category: z.string().trim().max(200).nullish(),
  costCenter: z.string().trim().max(200).nullish(),
  account: z.string().trim().max(200).nullish(),
  categoryValue: z.number(), // valor da parte (categoria/centro de custo)
  settledValue: z.number().default(0), // valor pago/recebido do lançamento inteiro (absoluto)
  openValue: z.number().default(0), // valor a pagar/receber do lançamento inteiro (absoluto)
});
export type NiboRow = z.infer<typeof niboRowSchema>;

export const niboRowsSchema = z.array(niboRowSchema).min(1, 'Nenhum lançamento no arquivo').max(20000);

const accountTypes = ['CHECKING', 'SAVINGS', 'INVESTMENT', 'CASH', 'CREDIT_CARD', 'PAYMENT_GATEWAY', 'OTHER'] as const;
const sections = ['OPERATING_REVENUE', 'OPERATING_COSTS', 'OPERATING_EXPENSES', 'INVESTING', 'FINANCING'] as const;

export const niboMappingSchema = z.object({
  accounts: z.record(
    z.string(),
    z.union([
      z.object({ bankAccountId: z.uuid() }),
      z.object({ create: z.object({ type: z.enum(accountTypes), initialBalance: z.number(), initialBalanceDate: isoDate }) }),
    ]),
  ),
  categories: z.record(
    z.string(),
    z.union([
      z.object({ categoryId: z.uuid() }),
      // name: nome corrigido aprovado na prévia (sem ele, fica o nome do Nibo)
      z.object({ create: z.object({ section: z.enum(sections), name: z.string().trim().min(1).max(120).optional() }) }),
    ]),
  ),
});
export type NiboMapping = z.infer<typeof niboMappingSchema>;

/** Nome normalizado para comparar (sem acento, caixa e espaços duplicados) */
export const norm = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const income = (r: Pick<NiboRow, 'kind'>) => r.kind === 'RECEIVED' || r.kind === 'TO_RECEIVE';
const settled = (r: Pick<NiboRow, 'kind'>) => r.kind === 'RECEIVED' || r.kind === 'PAID';
/** Chave da categoria: nome + natureza (a mesma palavra pode existir como receita e despesa) */
const categoryKey = (r: Pick<NiboRow, 'category' | 'kind'>) => `${income(r) ? 'IN' : 'OUT'}|${r.category?.trim() || ''}`;
const UNCLASSIFIED = { IN: 'Receitas a classificar (importação)', OUT: 'Despesas a classificar (importação)' } as const;
const NO_ACCOUNT = 'Conta não informada (importação)';
const blankDescription = (v?: string | null) => !v || /^sem descri[cç][aã]o$/i.test(v.trim());
/** Texto com acentuação quebrada (UTF-8 lido como Latin-1), ex.: "SAÃDA" */
const brokenText = (v?: string | null) => !!v && /Ã[\u0080-¿ A-Z]|Â|�/.test(v);
const money2 = (v: number) => Math.round(v * 100) / 100;

/** Tipo de conta sugerido pelo nome que veio do Nibo */
function guessAccountType(name: string): AccountType {
  const n = norm(name);
  if (/cart[aã]o|credito|credit/.test(n)) return 'CREDIT_CARD';
  if (/hotmart|rede|cielo|stone|getnet|pagseguro|mercado ?pago|maquin|sumup|pagar\.?me|eduzz|kiwify|asaas/.test(n)) return 'PAYMENT_GATEWAY';
  if (/caixa(inha)?$|dinheiro|especie/.test(n)) return 'CASH';
  if (/aplica|invest|cdb|reserva/.test(n)) return 'INVESTMENT';
  return 'CHECKING';
}

/** Uma baixa (pagamento/recebimento) de um lançamento do Nibo */
interface NiboPayment {
  date: string | null;
  account: string;
  value: number;
}

/**
 * Lançamento do Nibo: uma linha, ou várias com o mesmo "Agendamento". Nas várias linhas há dois casos:
 * - rateio: as linhas repetem o mesmo pagamento (data, conta e valor pago) e cada uma traz uma parte (categoria/centro de custo);
 * - pago em várias vezes: cada linha é uma baixa, com a sua data, conta e valor.
 */
interface NiboEntry {
  head: NiboRow;
  rows: NiboRow[];
  /** Partes por categoria/centro de custo, com valor relativo ao lançamento (natureza oposta fica negativa) */
  parts: { row: NiboRow; value: number }[];
  /** Soma das partes = valor do lançamento */
  total: number;
  payments: NiboPayment[];
  settledValue: number;
  openValue: number;
}

const partValue = (r: NiboRow, many: boolean) => (many ? money2(income(r) ? r.categoryValue : -r.categoryValue) : Math.abs(r.categoryValue));

export function groupEntries(rows: NiboRow[]): NiboEntry[] {
  const groups = new Map<string, NiboRow[]>();
  for (const r of rows) {
    const key = r.scheduleId ? `${r.scheduleId}|${r.kind}` : `line:${r.line}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((list) => {
    const head = list[0];
    const many = list.length > 1;
    // Partes iguais (mesma categoria e centro de custo) somam: não é rateio, só baixas separadas
    const byPart = new Map<string, { row: NiboRow; value: number }>();
    for (const r of list) {
      const key = `${r.category?.trim() ?? ''}|${r.costCenter?.trim() ?? ''}`;
      const part = byPart.get(key) ?? { row: r, value: 0 };
      part.value = money2(part.value + partValue(r, many));
      byPart.set(key, part);
    }
    const parts = [...byPart.values()];
    const total = money2(list.reduce((s, r) => s + partValue(r, many), 0));

    // Baixas: linhas com a mesma data, conta e valor pago cujas partes somam o valor pago são um pagamento só (rateio)
    const payments: NiboPayment[] = [];
    if (settled(head)) {
      const clusters = new Map<string, NiboRow[]>();
      for (const r of list) {
        const key = `${r.paidAt ?? r.dueDate}|${r.account?.trim() ?? ''}|${r.settledValue}`;
        clusters.set(key, [...(clusters.get(key) ?? []), r]);
      }
      for (const c of clusters.values()) {
        const parts = money2(c.reduce((s, r) => s + partValue(r, true), 0));
        const single = c.length === 1 || Math.abs(Math.abs(parts) - c[0].settledValue) < 0.01;
        for (const r of single ? [c[0]] : c) payments.push({ date: r.paidAt ?? r.dueDate ?? null, account: r.account?.trim() || NO_ACCOUNT, value: r.settledValue });
      }
      payments.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    }
    const openValues = list.map((r) => r.openValue);
    return {
      head,
      rows: list,
      parts,
      total,
      payments,
      settledValue: money2(payments.reduce((s, p) => s + p.value, 0)),
      // O Nibo repete o valor em aberto em cada linha do rateio: conta uma vez só
      openValue: openValues.every((v) => Math.abs(v - openValues[0]) < 0.005) ? openValues[0] : money2(openValues.reduce((s, v) => s + v, 0)),
    };
  });
}

export interface ReviewItem {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  lines: number[];
}

/** Prévia: nada é gravado */
export async function analyzeNibo(companyId: string, rows: NiboRow[]) {
  const entries = groupEntries(rows);
  const [accounts, categories, costCenters, contacts, entriesCount, active] = await Promise.all([
    prisma.bankAccount.findMany({ where: { companyId }, select: { id: true, name: true, type: true, isActive: true } }),
    prisma.category.findMany({ where: { companyId, isGroup: false, isActive: true, section: { not: null } }, select: { id: true, name: true, type: true, section: true } }),
    prisma.costCenter.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.contact.findMany({ where: { companyId }, select: { id: true, name: true } }),
    Promise.all([prisma.receivable.count({ where: { companyId } }), prisma.payable.count({ where: { companyId } }), prisma.transaction.count({ where: { companyId } })]),
    prisma.dataImport.findFirst({ where: { companyId, source: 'NIBO', status: 'PROCESSED' }, orderBy: { createdAt: 'desc' } }),
  ]);

  // Contas (só os lançamentos baixados têm conta; em aberto ficam sem)
  const accountMap = new Map<string, { name: string; rows: number; firstDate: string | null; received: number; paid: number }>();
  for (const e of entries) {
    for (const p of e.payments) {
      const a = accountMap.get(p.account) ?? { name: p.account, rows: 0, firstDate: null, received: 0, paid: 0 };
      a.rows++;
      if (p.date && (!a.firstDate || p.date < a.firstDate)) a.firstDate = p.date;
      if (income(e.head)) a.received += p.value;
      else a.paid += p.value;
      accountMap.set(p.account, a);
    }
  }
  const accountByName = new Map(accounts.map((a) => [norm(a.name), a]));

  // Categorias (por parte do rateio)
  const categoryMap = new Map<string, { key: string; name: string; type: 'INCOME' | 'EXPENSE'; rows: number; total: number; unclassified: boolean }>();
  for (const r of rows) {
    const unclassified = !r.category?.trim();
    const type = income(r) ? 'INCOME' : 'EXPENSE';
    const name = unclassified ? UNCLASSIFIED[type === 'INCOME' ? 'IN' : 'OUT'] : r.category!.trim();
    const key = categoryKey({ ...r, category: name });
    const c = categoryMap.get(key) ?? { key, name, type, rows: 0, total: 0, unclassified };
    c.rows++;
    c.total += Math.abs(r.categoryValue);
    categoryMap.set(key, c);
  }
  const categoryMatch = (name: string, type: CategoryType) => categories.find((c) => c.type === type && norm(c.name) === norm(name));

  // Nomes que só mudam acento/caixa ("Itau" e "Itaú") viram um só, como na gravação
  const distinct = (values: (string | null | undefined)[]) => [...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v).map(norm))];
  const ccNames = distinct(rows.map((r) => r.costCenter));
  const existingCc = new Set(costCenters.map((c) => norm(c.name)));
  const contactNames = distinct(rows.map((r) => r.contact));
  const existingContacts = new Set(contacts.map((c) => norm(c.name)));

  // Totais (para conferir com o relatório), contando cada lançamento uma vez
  const sum = (kind: NiboRow['kind'], pick: (e: NiboEntry) => number) => money2(entries.filter((e) => e.head.kind === kind).reduce((s, e) => s + pick(e), 0));
  const totals = {
    received: sum('RECEIVED', (e) => e.settledValue),
    paid: sum('PAID', (e) => e.settledValue),
    toReceive: sum('TO_RECEIVE', (e) => e.openValue),
    toPay: sum('TO_PAY', (e) => e.openValue),
  };

  // Revisão
  const review: ReviewItem[] = [];
  const add = (level: ReviewItem['level'], code: string, message: string, lines: number[]) => lines.length && review.push({ level, code, message, lines });
  const linesWhere = (pred: (r: NiboRow) => boolean) => rows.filter(pred).map((r) => r.line);
  const entryLines = (pred: (e: NiboEntry) => boolean) => entries.filter(pred).flatMap((e) => e.rows.map((r) => r.line));
  if (entriesCount.some((n) => n > 0)) {
    add(
      'warning',
      'COMPANY_HAS_DATA',
      `Esta empresa já tem ${entriesCount[0] + entriesCount[1]} lançamento(s) e ${entriesCount[2]} movimentação(ões). O combinado é importar numa empresa nova; se continuar, nada é apagado e tudo é somado.`,
      [0],
    );
  }
  if (active) {
    add(
      'error',
      'ACTIVE_IMPORT',
      `Já existe uma importação do Nibo nesta empresa ("${active.fileName}", ${active.createdAt.toLocaleDateString('pt-BR')}). Se este arquivo cobre o mesmo período, desfaça a anterior antes, senão os lançamentos ficam duplicados.`,
      [0],
    );
  }
  // O relatório do Nibo é filtrado por vencimento: o que foi pago no período mas vence depois fica de fora
  const dues = rows
    .map((r) => r.dueDate)
    .filter((d): d is string => !!d)
    .sort();
  if (dues.length) {
    const br = (d: string) => d.split('-').reverse().join('/');
    add(
      'info',
      'DUE_RANGE',
      `Os vencimentos deste arquivo vão de ${br(dues[0])} a ${br(dues[dues.length - 1])}. O Nibo filtra este relatório pelo vencimento: o que foi pago/recebido no período mas vence depois (ex.: parcelas antecipadas da maquininha) não vem no arquivo. Exporte com o período de vencimento cobrindo também os meses seguintes.`,
      [0],
    );
  }
  add('info', 'SPLIT', 'Lançamentos com rateio (várias linhas com o mesmo "Agendamento"): cada um virou um lançamento só, com o rateio por categoria/centro de custo.', entryLines((e) => e.parts.length > 1));
  add('info', 'PARTIAL', 'Lançamentos pagos/recebidos em mais de uma vez (mesmo "Agendamento"): um lançamento só, com uma baixa para cada pagamento, na data e conta de cada um.', entryLines((e) => e.payments.length > 1));
  add('warning', 'NO_ACCOUNT', `Pagamento/recebimento sem conta: vai para "${NO_ACCOUNT}". Revise e mova para a conta certa.`, linesWhere((r) => settled(r) && !r.account?.trim()));
  add('warning', 'NO_CATEGORY', 'Lançamento sem categoria: vai para "a classificar". Revise a categoria.', linesWhere((r) => !r.category?.trim()));
  add('warning', 'NO_PAID_DATE', 'Pago/recebido sem data de pagamento: usei o vencimento.', entryLines((e) => settled(e.head) && !e.head.paidAt));
  add('warning', 'NO_DUE_DATE', 'Em aberto sem vencimento: usei a competência (ou a data de hoje).', entryLines((e) => !settled(e.head) && !e.head.dueDate));
  add(
    'warning',
    'VALUE_DIFF',
    'Valor pago/recebido diferente do valor do lançamento: a diferença entrou como juros (a mais) ou desconto (a menos).',
    entryLines((e) => settled(e.head) && Math.abs(e.total - e.settledValue) >= 0.01),
  );
  add('warning', 'BROKEN_TEXT', 'Texto com acentuação quebrada (ex.: "SAÃDA"): veio assim do Nibo; corrija a descrição se quiser.', linesWhere((r) => brokenText(r.description) || brokenText(r.contact)));
  add('info', 'NO_DESCRIPTION', '"Sem descrição": o lançamento ficou com o nome do contato (ou da categoria) como descrição.', entryLines((e) => blankDescription(e.head.description)));
  add('info', 'RECURRING', 'Recorrências entram como lançamentos avulsos. Cadastre as recorrências futuras no SYC Hub quando precisar.', entryLines((e) => e.head.recurring));
  add(
    'info',
    'OLD_COMPETENCE',
    'Competência mais de 60 dias antes do vencimento: confira se está certa (ela define o mês no Painel por competência).',
    entryLines((e) => !!e.head.issueDate && !!e.head.dueDate && Date.parse(e.head.dueDate) - Date.parse(e.head.issueDate) > 60 * 86_400_000),
  );
  add(
    'info',
    'NOT_RECONCILED',
    'Pagos/recebidos que não estavam conciliados no Nibo: entram no saldo; ao importar o OFX, a linha do banco é reconhecida e não duplica.',
    entryLines((e) => settled(e.head) && !!e.head.account?.trim()),
  );

  return {
    rows: entries.length,
    lines: rows.length,
    counts: {
      receivables: entries.filter((e) => income(e.head)).length,
      payables: entries.filter((e) => !income(e.head)).length,
      settled: entries.filter((e) => settled(e.head)).length,
      open: entries.filter((e) => !settled(e.head)).length,
      split: entries.filter((e) => e.parts.length > 1).length,
      partial: entries.filter((e) => e.payments.length > 1).length,
    },
    totals,
    accounts: [...accountMap.values()].map((a) => {
      const existing = accountByName.get(norm(a.name));
      return { ...a, received: money2(a.received), paid: money2(a.paid), suggestedType: guessAccountType(a.name), existingId: existing?.id ?? null };
    }),
    categories: [...categoryMap.values()]
      .map((c) => {
        const suggestedName = c.unclassified ? null : correctCategoryName(c.name);
        return {
          ...c,
          total: money2(c.total),
          // Já existe com o nome do Nibo ou com o nome corrigido
          existingId: (categoryMatch(c.name, c.type) ?? (suggestedName ? categoryMatch(suggestedName, c.type) : undefined))?.id ?? null,
          suggestedName,
          suggestedSection: (c.type === 'INCOME' ? 'OPERATING_REVENUE' : 'OPERATING_EXPENSES') as DRESection,
        };
      })
      .sort((a, b) => a.type.localeCompare(b.type) || b.rows - a.rows),
    costCenters: { total: ccNames.length, new: ccNames.filter((n) => !existingCc.has(n)).length },
    contacts: { total: contactNames.length, new: contactNames.filter((n) => !existingContacts.has(n)).length },
    review,
  };
}

const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const todayIso = () => new Date().toISOString().slice(0, 10);

/** Grava a importação (tudo ou nada) */
export async function commitNibo(companyId: string, userId: string, fileName: string, rows: NiboRow[], mapping: NiboMapping) {
  const fileHash = sha256(JSON.stringify(rows));
  const duplicate = await prisma.dataImport.findFirst({ where: { companyId, fileHash, status: 'PROCESSED' } });
  if (duplicate) throw new HttpError(409, `Este arquivo já foi importado em ${duplicate.createdAt.toLocaleDateString('pt-BR')}. Desfaça a importação anterior para importar de novo.`);

  const preview = await analyzeNibo(companyId, rows);
  for (const a of preview.accounts) if (!mapping.accounts[a.name]) throw new HttpError(400, `Defina a conta "${a.name}"`);
  for (const c of preview.categories) if (!mapping.categories[c.key]) throw new HttpError(400, `Defina a categoria "${c.name}"`);
  const entries = groupEntries(rows);

  return prisma.$transaction(
    async (db) => {
      const created = { accounts: [] as string[], categories: [] as string[], costCenters: [] as string[], contacts: [] as string[], receivables: [] as string[], payables: [] as string[], transactions: [] as string[] };

      // Contas
      const accountId = new Map<string, string>();
      for (const a of preview.accounts) {
        const m = mapping.accounts[a.name];
        if ('bankAccountId' in m) {
          if (!(await db.bankAccount.findFirst({ where: { id: m.bankAccountId, companyId } }))) throw new HttpError(400, `Conta escolhida para "${a.name}" não existe`);
          accountId.set(a.name, m.bankAccountId);
        } else {
          const acc = await db.bankAccount.create({
            data: { companyId, name: a.name, type: m.create.type, initialBalance: m.create.initialBalance, initialBalanceDate: day(m.create.initialBalanceDate), currentBalance: m.create.initialBalance, color: '#64748b' },
          });
          accountId.set(a.name, acc.id);
          created.accounts.push(acc.id);
        }
      }

      // Categorias
      const categoryId = new Map<string, string>();
      const maxOrder = await db.category.aggregate({ where: { companyId }, _max: { orderIndex: true } });
      let order = (maxOrder._max.orderIndex ?? 0) + 1;
      for (const c of preview.categories) {
        const m = mapping.categories[c.key];
        if ('categoryId' in m) {
          const cat = await db.category.findFirst({ where: { id: m.categoryId, companyId, isGroup: false } });
          if (!cat) throw new HttpError(400, `Categoria escolhida para "${c.name}" não existe`);
          categoryId.set(c.key, cat.id);
        } else {
          const cat = await db.category.create({ data: { companyId, name: m.create.name ?? c.name, type: c.type, section: m.create.section, orderIndex: order++ } });
          categoryId.set(c.key, cat.id);
          created.categories.push(cat.id);
        }
      }
      const categoryOf = (r: NiboRow) => categoryId.get(categoryKey({ ...r, category: r.category?.trim() || UNCLASSIFIED[income(r) ? 'IN' : 'OUT'] }))!;

      // Centros de custo e contatos (reaproveita os de mesmo nome)
      const ccId = new Map<string, string>();
      for (const c of await db.costCenter.findMany({ where: { companyId }, select: { id: true, name: true } })) ccId.set(norm(c.name), c.id);
      for (const name of new Set(rows.map((r) => r.costCenter?.trim()).filter((v): v is string => !!v))) {
        if (ccId.has(norm(name))) continue;
        const cc = await db.costCenter.create({ data: { companyId, name } });
        ccId.set(norm(name), cc.id);
        created.costCenters.push(cc.id);
      }
      const costCenterOf = (r: NiboRow) => (r.costCenter?.trim() ? (ccId.get(norm(r.costCenter)) ?? null) : null);
      const contactId = new Map<string, string>();
      for (const c of await db.contact.findMany({ where: { companyId }, select: { id: true, name: true } })) contactId.set(norm(c.name), c.id);
      const newContacts = new Map<string, { name: string; customer: boolean }>();
      for (const r of rows) {
        const name = r.contact?.trim();
        if (!name || contactId.has(norm(name))) continue;
        const c = newContacts.get(norm(name)) ?? { name, customer: false };
        if (income(r)) c.customer = true;
        newContacts.set(norm(name), c);
      }
      const contactRows = [...newContacts.entries()].map(([key, c]) => ({ id: randomUUID(), key, name: c.name, customer: c.customer }));
      if (contactRows.length) {
        await db.contact.createMany({ data: contactRows.map((c) => ({ id: c.id, companyId, name: c.name, type: c.customer ? ('CUSTOMER' as const) : ('SUPPLIER' as const) })) });
        for (const c of contactRows) {
          contactId.set(c.key, c.id);
          created.contacts.push(c.id);
        }
      }

      // Lançamentos, rateios, baixas e vínculos
      const receivables: Prisma.ReceivableCreateManyInput[] = [];
      const payables: Prisma.PayableCreateManyInput[] = [];
      const splits: Prisma.EntrySplitCreateManyInput[] = [];
      const transactions: Prisma.TransactionCreateManyInput[] = [];
      const links: Prisma.EntrySettlementCreateManyInput[] = [];
      const now = new Date();
      for (const e of entries) {
        const r = e.head;
        const isIncome = income(r);
        const isSettled = settled(r);
        // Capa do lançamento: a maior parte do rateio
        const main = e.parts.reduce((best, p) => (Math.abs(p.value) > Math.abs(best.value) ? p : best)).row;
        const lastPayment = e.payments[e.payments.length - 1];
        const contact = r.contact?.trim() ? (contactId.get(norm(r.contact)) ?? null) : null;
        const categoryName = preview.categories.find((c) => c.key === categoryKey({ ...main, category: main.category?.trim() || UNCLASSIFIED[isIncome ? 'IN' : 'OUT'] }))?.name ?? '';
        const description = blankDescription(r.description) ? r.contact?.trim() || categoryName : r.description!.trim();
        const due = r.dueDate ?? (isSettled ? r.paidAt : r.issueDate) ?? todayIso();
        const amount = D(e.total > 0 ? e.total : Math.abs(e.total));
        const paidValue = D(e.settledValue);
        const diff = isSettled ? paidValue.minus(amount) : D(0);
        const id = randomUUID();
        const lines = e.rows.map((x) => `${x.line}`).join(', ');
        const entry = {
          id,
          companyId,
          categoryId: categoryOf(main),
          costCenterId: costCenterOf(main),
          contactId: contact,
          description: description.slice(0, 250),
          documentNumber: r.reference?.trim() || null,
          dueDate: day(due),
          issueDate: day(r.issueDate ?? due),
          expectedDate: r.expectedDate && r.expectedDate !== due ? day(r.expectedDate) : null,
          amount,
          interestFine: diff.gt(0) ? diff : D(0),
          discount: diff.lt(0) ? diff.negated() : D(0),
          isStarred: r.starred,
          notes: ['Importado do Nibo', r.scheduleId ? `Agendamento ${r.scheduleId}` : null, r.identifier?.trim() ? `Identificador: ${r.identifier.trim()}` : null, `Linha(s) ${lines} da planilha`]
            .filter(Boolean)
            .join(' · '),
          ...(isSettled && lastPayment
            ? { bankAccountId: accountId.get(lastPayment.account)!, settledAmount: paidValue, settledAt: day(lastPayment.date ?? due), status: 'PAID' as const }
            : { status: 'PENDING' as const }),
        };
        if (isIncome) receivables.push(entry);
        else payables.push({ ...entry, scheduledAtBank: r.scheduledAtBank });
        (isIncome ? created.receivables : created.payables).push(id);
        if (e.parts.length > 1) {
          e.parts.forEach((p, orderIndex) =>
            splits.push({ companyId, ...(isIncome ? { receivableId: id } : { payableId: id }), categoryId: categoryOf(p.row), costCenterId: costCenterOf(p.row), amount: D(p.value), orderIndex }),
          );
        }

        // Uma movimentação no extrato para cada baixa, na data e conta de cada pagamento
        for (const p of e.payments) {
          const txId = randomUUID();
          transactions.push({
            id: txId,
            companyId,
            bankAccountId: accountId.get(p.account)!,
            type: isIncome ? 'CREDIT' : 'DEBIT',
            amount: D(p.value),
            date: day(p.date ?? due),
            description: entry.description,
            checknum: entry.documentNumber,
            categoryId: entry.categoryId,
            contactId: contact,
            costCenterId: entry.costCenterId,
            reconciliationStatus: 'RECONCILED',
            reconciledAt: now,
            reconciledByUserId: userId,
            origin: 'SETTLEMENT',
          });
          links.push({ companyId, transactionId: txId, ...(isIncome ? { receivableId: id } : { payableId: id }), amount: D(p.value) });
          created.transactions.push(txId);
        }
      }
      const chunk = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / 1000) }, (_, i) => list.slice(i * 1000, i * 1000 + 1000));
      for (const part of chunk(receivables)) await db.receivable.createMany({ data: part });
      for (const part of chunk(payables)) await db.payable.createMany({ data: part });
      for (const part of chunk(splits)) await db.entrySplit.createMany({ data: part });
      for (const part of chunk(transactions)) await db.transaction.createMany({ data: part });
      for (const part of chunk(links)) await db.entrySettlement.createMany({ data: part });

      // Liga as opções usadas pelo relatório (rateio, centros de custo, programado no banco)
      const flags: Prisma.CompanyUpdateInput = {};
      if (rows.some((r) => r.costCenter?.trim())) flags.costCentersEnabled = true;
      if (rows.some((r) => r.scheduledAtBank && !income(r))) flags.bankScheduleEnabled = true;
      if (splits.length) flags.splitsEnabled = true;
      if (Object.keys(flags).length) await db.company.update({ where: { id: companyId }, data: flags });

      await recalculateBalances(db, new Set(accountId.values()));
      const summary = { rows: entries.length, lines: rows.length, counts: preview.counts, totals: preview.totals, review: preview.review, accounts: preview.accounts.length, categoriesCreated: created.categories.length };
      const record = await db.dataImport.create({
        data: { companyId, source: 'NIBO', fileName, fileHash, importedByUserId: userId, summary: summary as unknown as Prisma.InputJsonValue, created: created as Prisma.InputJsonValue },
      });
      return { id: record.id, summary, created: { ...Object.fromEntries(Object.entries(created).map(([k, v]) => [k, v.length])), splits: splits.length } };
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
}

type CreatedIds = Record<'accounts' | 'categories' | 'costCenters' | 'contacts' | 'receivables' | 'payables' | 'transactions', string[]>;

/** Desfaz a importação: apaga os lançamentos e o que foi criado e não está sendo usado por mais nada */
export async function rollbackNibo(companyId: string, id: string) {
  const record = await prisma.dataImport.findFirst({ where: { id, companyId } });
  if (!record) throw new HttpError(404, 'Importação não encontrada');
  if (record.status !== 'PROCESSED') throw new HttpError(409, 'Esta importação já foi desfeita');
  const c = record.created as unknown as CreatedIds;

  return prisma.$transaction(
    async (db) => {
      const touched = await db.transaction.findMany({ where: { id: { in: c.transactions } }, select: { bankAccountId: true } });
      // Linhas do extrato importadas depois e casadas com estas baixas voltam a ser só linhas do banco
      const merged = await db.transaction.findMany({ where: { id: { in: c.transactions }, fitid: { not: null } }, select: { id: true } });
      for (const t of merged) {
        await db.entrySettlement.deleteMany({ where: { transactionId: t.id } });
        await db.transaction.update({
          where: { id: t.id },
          data: { origin: 'OFX_IMPORT', reconciliationStatus: 'PENDING', reconciledAt: null, reconciledByUserId: null, customDescription: null, categoryId: null, contactId: null, costCenterId: null },
        });
      }
      const mergedIds = new Set(merged.map((t) => t.id));
      await db.transaction.deleteMany({ where: { id: { in: c.transactions.filter((t) => !mergedIds.has(t)) } } });
      // Rateios saem junto com os lançamentos (cascade)
      await db.receivable.deleteMany({ where: { id: { in: c.receivables } } });
      await db.payable.deleteMany({ where: { id: { in: c.payables } } });

      const kept: string[] = [];
      for (const contactId of c.contacts) {
        const used = (await db.receivable.count({ where: { contactId } })) + (await db.payable.count({ where: { contactId } })) + (await db.transaction.count({ where: { contactId } }));
        if (used) kept.push('contato');
        else await db.contact.delete({ where: { id: contactId } });
      }
      for (const categoryId of c.categories) {
        const used =
          (await db.receivable.count({ where: { categoryId } })) +
          (await db.payable.count({ where: { categoryId } })) +
          (await db.transaction.count({ where: { categoryId } })) +
          (await db.entrySplit.count({ where: { categoryId } }));
        if (used) kept.push('categoria');
        else await db.category.delete({ where: { id: categoryId } });
      }
      for (const costCenterId of c.costCenters) {
        const used =
          (await db.receivable.count({ where: { costCenterId } })) + (await db.payable.count({ where: { costCenterId } })) + (await db.transaction.count({ where: { costCenterId } })) + (await db.entrySplit.count({ where: { costCenterId } }));
        if (used) kept.push('centro de custo');
        else await db.costCenter.delete({ where: { id: costCenterId } });
      }
      const accounts = new Set(touched.map((t) => t.bankAccountId));
      for (const accountId of c.accounts) {
        if (await db.transaction.count({ where: { bankAccountId: accountId } })) kept.push('conta');
        else {
          await db.bankAccount.delete({ where: { id: accountId } });
          accounts.delete(accountId);
        }
      }
      await recalculateBalances(db, accounts);
      await db.dataImport.update({ where: { id: record.id }, data: { status: 'ROLLED_BACK' } });
      return { removed: c.receivables.length + c.payables.length, kept: kept.length };
    },
    { timeout: 180_000, maxWait: 20_000 },
  );
}
