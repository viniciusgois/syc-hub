import { Prisma, type BankAccount, type TransactionType } from '@prisma/client';

/** Janela para casar uma linha do extrato com uma baixa registrada no sistema */
const MATCH_WINDOW_MS = 3 * 86_400_000;
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { activeRules } from './applyRules.js';
import { findMatchingRule, ruleClassification } from './rules.js';
import { recalculateBalance } from './balance.js';
import { suggestEntryMatches } from './matching.js';

export interface StatementLine {
  type: TransactionType;
  amount: string; // valor absoluto
  date: Date;
  description: string;
  fitid: string;
  checknum?: string;
}

export interface StatementFile {
  fileName: string;
  fileType: 'OFX' | 'XLSX' | 'CSV';
  fileSize: number;
  fileHash: string;
  lines: StatementLine[];
  warnings?: string[];
}

/**
 * Importa linhas de extrato em uma conta:
 * - recusa o mesmo arquivo duas vezes (hash)
 * - ignora FITIDs já existentes na conta (e repetidos no próprio arquivo)
 * - aplica as regras de conciliação ativas
 * Com dryRun, apenas retorna a prévia sem gravar nada.
 */
export async function importStatement(
  account: Pick<BankAccount, 'id' | 'companyId'>,
  userId: string,
  file: StatementFile,
  { dryRun = false } = {},
) {
  const { companyId, id: bankAccountId } = account;
  const warnings = [...(file.warnings ?? [])];

  const duplicateFile = await prisma.importBatch.findFirst({
    where: { companyId, bankAccountId, fileHash: file.fileHash, status: 'PROCESSED' },
    select: { id: true, createdAt: true, fileName: true },
  });
  if (duplicateFile && !dryRun) throw new HttpError(409, 'Este arquivo já foi importado nesta conta', duplicateFile);
  if (duplicateFile) warnings.push(`Este arquivo já foi importado em ${duplicateFile.createdAt.toLocaleDateString('pt-BR')}`);

  const existing = await prisma.transaction.findMany({
    where: { bankAccountId, fitid: { in: file.lines.map((l) => l.fitid) } },
    select: { fitid: true },
  });
  const seen = new Set(existing.map((t) => t.fitid));
  const rules = await activeRules(companyId);
  const now = new Date();

  // Baixas registradas no sistema (recebimentos/pagamentos) ainda sem linha do extrato
  const dates = file.lines.map((l) => l.date.getTime());
  const settlements = dates.length
    ? await prisma.transaction.findMany({
        where: {
          bankAccountId,
          // Baixas e lados de transferência criados no sistema ainda sem a linha do banco
          OR: [{ origin: 'SETTLEMENT' }, { origin: 'MANUAL_CASH', isTransfer: true }],
          fitid: null,
          date: { gte: new Date(Math.min(...dates) - MATCH_WINDOW_MS), lte: new Date(Math.max(...dates) + MATCH_WINDOW_MS) },
        },
        select: { id: true, type: true, amount: true, date: true, description: true },
      })
    : [];
  const usedSettlements = new Set<string>();

  /** Baixa de mesmo tipo e valor com data mais próxima (até 3 dias) */
  const matchSettlement = (line: StatementLine) => {
    const candidates = settlements
      .filter((t) => !usedSettlements.has(t.id) && t.type === line.type && new Prisma.Decimal(t.amount).eq(line.amount))
      .map((t) => ({ t, diff: Math.abs(t.date.getTime() - line.date.getTime()) }))
      .filter((c) => c.diff <= MATCH_WINDOW_MS)
      .sort((a, b) => a.diff - b.diff);
    const best = candidates[0]?.t;
    if (best) usedSettlements.add(best.id);
    return best;
  };

  const analyzed = file.lines.map((line) => {
    const duplicate = seen.has(line.fitid);
    seen.add(line.fitid);
    const settlement = duplicate ? undefined : matchSettlement(line);
    const rule = duplicate || settlement ? undefined : findMatchingRule(rules, line.description);
    return { line, duplicate, rule, settlement };
  });
  const fresh = analyzed.filter((a) => !a.duplicate);
  const toCreate = fresh.filter((a) => !a.settlement);
  const matched = fresh.filter((a) => a.settlement);

  const sum = (type: TransactionType) =>
    fresh.filter((a) => a.line.type === type).reduce((acc, a) => acc.plus(a.line.amount), new Prisma.Decimal(0));
  const summary = {
    imported: fresh.length,
    skippedDuplicates: analyzed.length - fresh.length,
    matchedSettlements: matched.length,
    suggested: toCreate.filter((a) => a.rule && !a.rule.autoReconcile).length,
    autoReconciled: toCreate.filter((a) => a.rule?.autoReconcile).length + matched.length,
    totalIncome: sum('CREDIT'),
    totalExpense: sum('DEBIT'),
    warnings,
  };

  if (dryRun) {
    // Prováveis contas a pagar/receber (só sugestão; a conciliação é confirmada no extrato)
    const entryMatches = await suggestEntryMatches(
      companyId,
      fresh.filter((a) => !a.settlement).map((a) => ({ key: a.line.fitid, type: a.line.type, amount: a.line.amount, date: a.line.date })),
    );
    return {
      ...summary,
      batch: null,
      preview: analyzed.map(({ line, duplicate, rule, settlement }) => ({
        ...line,
        duplicate,
        ruleName: rule?.name ?? null,
        matchedSettlement: settlement?.description ?? null,
        entryMatch: duplicate || settlement ? null : (entryMatches.get(line.fitid)?.description ?? null),
        reconciliationStatus: duplicate ? null : settlement ? 'RECONCILED' : rule ? ruleClassification(rule).reconciliationStatus : 'PENDING',
      })),
    };
  }

  if (!fresh.length) return { ...summary, batch: null };

  const timesApplied = new Map<string, number>();
  for (const { rule } of toCreate) if (rule) timesApplied.set(rule.id, (timesApplied.get(rule.id) ?? 0) + 1);

  const batch = await prisma.$transaction(async (db) => {
    const created = await db.importBatch.create({
      data: {
        companyId,
        bankAccountId,
        importedByUserId: userId,
        fileName: file.fileName,
        fileType: file.fileType,
        fileSize: file.fileSize,
        fileHash: file.fileHash,
        totalTransactions: fresh.length,
        reconciledCount: summary.autoReconciled,
      },
    });
    // Linhas casadas com baixas: a baixa passa a ser a própria linha do extrato (sem duplicar o lançamento)
    for (const { line, settlement } of matched) {
      await db.transaction.update({
        where: { id: settlement!.id },
        data: {
          fitid: line.fitid,
          importBatchId: created.id,
          date: line.date,
          description: line.description,
          customDescription: settlement!.description,
        },
      });
    }
    await db.transaction.createMany({
      data: toCreate.map(({ line, rule }) => ({
        ...line,
        companyId,
        bankAccountId,
        importBatchId: created.id,
        origin: file.fileType === 'OFX' ? ('OFX_IMPORT' as const) : ('SPREADSHEET_IMPORT' as const),
        ...(rule && ruleClassification(rule, now)),
      })),
    });
    for (const [id, n] of timesApplied) {
      await db.reconciliationRule.update({ where: { id }, data: { timesApplied: { increment: n } } });
    }
    await recalculateBalance(db, bankAccountId);
    return created;
  });

  return { ...summary, batch };
}
