import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { recalculateBalances } from './balance.js';
import { norm } from './niboImport.js';
import { sha256 } from './ofx.js';
import { undoTransfer } from './transfers.js';

/**
 * Passo 3 da migração: relatório "Transferências" do Nibo (Excel). O frontend junta as duas linhas de cada
 * transferência (saída na origem + entrada no destino); aqui as contas são casadas pelo nome e cada transferência
 * vira os dois lados conciliados (fora do resultado), como uma "Nova transferência".
 */

const isoDate = z.iso.date();
const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const money2 = (v: number) => Math.round(v * 100) / 100;

export const niboTransferSchema = z.object({
  lines: z.array(z.number().int()).min(1),
  date: isoDate,
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().min(1).max(200),
  amount: z.number().positive(),
  description: z.string().trim().max(250).nullish(),
});
export type NiboTransfer = z.infer<typeof niboTransferSchema>;
export const niboTransfersSchema = z.array(niboTransferSchema).min(1, 'Nenhuma transferência no arquivo').max(20000);
/** Nome da conta no Nibo -> conta no SYC Hub */
export const transferAccountMapSchema = z.record(z.string(), z.uuid());

const key = (date: string, fromId: string, toId: string, amount: number) => `${date}|${fromId}|${toId}|${amount.toFixed(2)}`;

/** Prévia: contas casadas pelo nome, transferências que já existem e o efeito em cada conta */
export async function analyzeNiboTransfers(companyId: string, transfers: NiboTransfer[], accountMap: Record<string, string> = {}) {
  const accounts = await prisma.bankAccount.findMany({ where: { companyId }, select: { id: true, name: true, isActive: true } });
  const names = [...new Set(transfers.flatMap((t) => [t.from, t.to]))];
  const byName = new Map(accounts.map((a) => [norm(a.name), a.id]));
  const resolved = new Map(names.map((n) => [n, accountMap[n] && accounts.some((a) => a.id === accountMap[n]) ? accountMap[n] : (byName.get(norm(n)) ?? null)]));

  // Transferências já registradas (ex.: importação anterior ou lançadas à mão): mesma data, contas e valor
  const dates = transfers.map((t) => t.date).sort();
  const existing = await prisma.transaction.findMany({
    where: { companyId, isTransfer: true, type: 'DEBIT', reconciliationStatus: 'RECONCILED', date: { gte: day(dates[0]), lte: day(dates[dates.length - 1]) } },
    select: { date: true, amount: true, bankAccountId: true, transferCounterpartId: true },
  });
  const counterparts = await prisma.transaction.findMany({
    where: { id: { in: existing.map((e) => e.transferCounterpartId).filter((v): v is string => !!v) } },
    select: { id: true, bankAccountId: true },
  });
  const toOf = new Map(counterparts.map((c) => [c.id, c.bankAccountId]));
  const already = new Map<string, number>();
  for (const e of existing) {
    const k = key(e.date.toISOString().slice(0, 10), e.bankAccountId, toOf.get(e.transferCounterpartId ?? '') ?? '', Number(e.amount));
    already.set(k, (already.get(k) ?? 0) + 1);
  }

  const plan = transfers.map((t) => {
    const fromId = resolved.get(t.from) ?? null;
    const toId = resolved.get(t.to) ?? null;
    let skip = false;
    if (fromId && toId) {
      const k = key(t.date, fromId, toId, t.amount);
      const n = already.get(k) ?? 0;
      if (n > 0) {
        skip = true;
        already.set(k, n - 1);
      }
    }
    return { ...t, fromId, toId, skip };
  });

  const effect = new Map<string, { name: string; in: number; out: number }>();
  for (const t of plan.filter((p) => !p.skip)) {
    const out = effect.get(t.from) ?? { name: t.from, in: 0, out: 0 };
    out.out += t.amount;
    effect.set(t.from, out);
    const inc = effect.get(t.to) ?? { name: t.to, in: 0, out: 0 };
    inc.in += t.amount;
    effect.set(t.to, inc);
  }

  return {
    transfers: plan,
    count: plan.length,
    toCreate: plan.filter((p) => !p.skip && p.fromId && p.toId).length,
    skipped: plan.filter((p) => p.skip).length,
    total: money2(plan.reduce((s, p) => s + p.amount, 0)),
    accounts: names.map((n) => ({ name: n, accountId: resolved.get(n) ?? null })),
    effect: [...effect.values()].map((e) => ({ ...e, in: money2(e.in), out: money2(e.out), net: money2(e.in - e.out) })),
    availableAccounts: accounts.map((a) => ({ id: a.id, name: a.name })),
  };
}

export async function commitNiboTransfers(companyId: string, userId: string, fileName: string, transfers: NiboTransfer[], accountMap: Record<string, string>) {
  const fileHash = sha256(JSON.stringify(transfers));
  const duplicate = await prisma.dataImport.findFirst({ where: { companyId, fileHash, status: 'PROCESSED' } });
  if (duplicate) throw new HttpError(409, `Este arquivo já foi importado em ${duplicate.createdAt.toLocaleDateString('pt-BR')}. Desfaça a importação anterior para importar de novo.`);
  const preview = await analyzeNiboTransfers(companyId, transfers, accountMap);
  const missing = preview.accounts.filter((a) => !a.accountId).map((a) => a.name);
  if (missing.length) throw new HttpError(400, `Escolha a conta do SYC Hub para: ${missing.join(', ')}`);

  return prisma.$transaction(
    async (db) => {
      const rows: Prisma.TransactionCreateManyInput[] = [];
      const pairs: string[][] = [];
      const now = new Date();
      for (const t of preview.transfers.filter((p) => !p.skip)) {
        const outId = randomUUID();
        const inId = randomUUID();
        const base = { companyId, amount: new Prisma.Decimal(t.amount), date: day(t.date), origin: 'MANUAL_CASH' as const, isTransfer: true, reconciliationStatus: 'RECONCILED' as const, reconciledAt: now, reconciledByUserId: userId };
        const text = t.description?.trim();
        rows.push({ ...base, id: outId, bankAccountId: t.fromId!, type: 'DEBIT', description: text || `Transferência para ${t.to}`, transferCounterpartId: inId, notes: `Importado do Nibo · linha(s) ${t.lines.join(', ')}` });
        rows.push({ ...base, id: inId, bankAccountId: t.toId!, type: 'CREDIT', description: text || `Transferência de ${t.from}`, transferCounterpartId: outId, notes: `Importado do Nibo · linha(s) ${t.lines.join(', ')}` });
        pairs.push([outId, inId]);
      }
      for (let i = 0; i < rows.length; i += 1000) await db.transaction.createMany({ data: rows.slice(i, i + 1000) });
      await recalculateBalances(db, new Set(rows.map((r) => r.bankAccountId)));
      const summary = { rows: pairs.length, count: preview.count, skipped: preview.skipped, total: preview.total, effect: preview.effect };
      const record = await db.dataImport.create({
        data: {
          companyId,
          source: 'NIBO_TRANSFERS',
          fileName,
          fileHash,
          importedByUserId: userId,
          summary: summary as unknown as Prisma.InputJsonValue,
          created: { transfers: pairs.map((p) => p[0]) } as Prisma.InputJsonValue,
        },
      });
      return { id: record.id, summary, created: { transfers: pairs.length } };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

/** Desfaz: cada transferência sai dos dois lados (linhas do extrato do banco casadas depois voltam para a Conciliação) */
export async function rollbackNiboTransfers(companyId: string, record: { id: string; created: Prisma.JsonValue }) {
  const ids = (record.created as { transfers: string[] }).transfers;
  return prisma.$transaction(
    async (db) => {
      let removed = 0;
      for (const id of ids) {
        if (!(await db.transaction.findFirst({ where: { id, companyId, isTransfer: true } }))) continue; // já desfeita à mão
        await undoTransfer(db, companyId, id);
        removed++;
      }
      await db.dataImport.update({ where: { id: record.id }, data: { status: 'ROLLED_BACK' } });
      return { removed, kept: 0 };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}
