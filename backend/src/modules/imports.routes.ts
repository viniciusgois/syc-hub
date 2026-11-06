import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, companyIdOf, idParam, notFound } from '../lib/http.js';
import { currentUser, userIdOf } from '../middleware/currentUser.js';
import { parseOFX, sha256 } from '../services/ofx.js';
import { importStatement, type StatementLine } from '../services/importStatement.js';
import { recalculateBalance } from '../services/balance.js';
import { linkedEntries, recomputeEntry } from '../services/entries.js';
import { undoTransfer } from '../services/transfers.js';
import { extractPdfStatement } from '../services/pdfStatement.js';

export const importsRouter = Router({ mergeParams: true });

const baseImportSchema = z.object({
  bankAccountId: z.uuid(),
  fileName: z.string().min(1),
  dryRun: z.boolean().optional(),
});

const ofxImportSchema = baseImportSchema.extend({ content: z.string().min(1) });

const rowsImportSchema = baseImportSchema.extend({
  fileType: z.enum(['XLSX', 'CSV', 'PDF']).default('XLSX'),
  /** Hash do arquivo original (PDF): impede importar o mesmo arquivo duas vezes */
  fileHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  rows: z
    .array(
      z.object({
        date: z.iso.date(),
        description: z.string().trim().min(1),
        amount: z.number().refine((v) => v !== 0, 'Valor não pode ser zero'), // positivo = entrada, negativo = saída
        fitid: z.string().optional(),
      }),
    )
    .min(1)
    .max(5000),
});

async function findAccount(companyId: string, bankAccountId: string) {
  const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, companyId } });
  if (!account) throw notFound('Conta bancária');
  return account;
}

importsRouter.get('/', async (req, res) => {
  const batches = await prisma.importBatch.findMany({
    where: { companyId: companyIdOf(req) },
    orderBy: { createdAt: 'desc' },
    include: {
      bankAccount: { select: { id: true, name: true } },
      importedByUser: { select: { id: true, name: true } },
    },
  });

  const statusCounts = await prisma.transaction.groupBy({
    by: ['importBatchId', 'reconciliationStatus'],
    where: { importBatchId: { in: batches.map((b) => b.id) } },
    _count: { _all: true },
  });
  const countsFor = (batchId: string, statuses: string[]) =>
    statusCounts
      .filter((s) => s.importBatchId === batchId && statuses.includes(s.reconciliationStatus))
      .reduce((n, s) => n + s._count._all, 0);

  res.json(
    batches.map((b) => ({
      ...b,
      reconciledCount: countsFor(b.id, ['RECONCILED']),
      pendingCount: countsFor(b.id, ['PENDING', 'SUGGESTED']),
    })),
  );
});

/** Importa um extrato OFX (conteúdo em texto). Com dryRun: true, retorna só a prévia. */
importsRouter.post('/ofx', currentUser, async (req, res) => {
  const { bankAccountId, fileName, content, dryRun } = ofxImportSchema.parse(req.body);
  const account = await findAccount(companyIdOf(req), bankAccountId);

  const parsed = parseOFX(content);
  if (!parsed.transactions.length) throw new HttpError(422, 'Nenhuma transação encontrada no arquivo OFX');

  const warnings: string[] = [];
  if (parsed.accountId && account.accountNumber && normalizeAcct(parsed.accountId) !== normalizeAcct(account.accountNumber)) {
    warnings.push(`Conta do arquivo (${parsed.accountId}) difere da conta selecionada (${account.accountNumber})`);
  }

  const result = await importStatement(
    account,
    userIdOf(res),
    { fileName, fileType: 'OFX', fileSize: Buffer.byteLength(content), fileHash: sha256(content), lines: parsed.transactions, warnings },
    { dryRun },
  );
  res.status(dryRun || !result.batch ? 200 : 201).json(result);
});

/** Importa linhas já lidas de uma planilha (XLSX/CSV) pelo frontend */
importsRouter.post('/rows', currentUser, async (req, res) => {
  const { bankAccountId, fileName, fileType, rows, dryRun, fileHash } = rowsImportSchema.parse(req.body);
  const account = await findAccount(companyIdOf(req), bankAccountId);

  const serialized = JSON.stringify(rows);
  // Sem FITID, gera um id determinístico (data|valor|descrição|ocorrência) para a reimportação deduplicar
  const occurrences = new Map<string, number>();
  const lines: StatementLine[] = rows.map((r) => {
    const key = `${r.date}|${r.amount.toFixed(2)}|${r.description.toUpperCase()}`;
    const n = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, n);
    return {
      type: r.amount > 0 ? 'CREDIT' : 'DEBIT',
      amount: Math.abs(r.amount).toFixed(2),
      date: new Date(`${r.date}T00:00:00.000Z`),
      description: r.description,
      fitid: r.fitid ?? `xls_${sha256(`${key}|${n}`).slice(0, 24)}`,
    };
  });

  const result = await importStatement(
    account,
    userIdOf(res),
    { fileName, fileType, fileSize: Buffer.byteLength(serialized), fileHash: fileHash ?? sha256(serialized), lines },
    { dryRun },
  );
  res.status(dryRun || !result.batch ? 200 : 201).json(result);
});

/** PDF em memória, até 20 MB (o arquivo não é guardado: só lido pela IA) */
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } }).single('file');
const receivePdf: RequestHandler = (req, res, next) =>
  pdfUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'O PDF passa de 20 MB.' : `Envio inválido: ${err.message}`));
    } else next(err);
  });

/**
 * Lê um extrato ou fatura em PDF com IA e devolve as transações para revisão (rascunho).
 * Não grava nada: depois de revisar, o frontend envia as linhas para POST /imports/rows com fileType PDF.
 */
importsRouter.post('/pdf/extract', receivePdf, async (req, res) => {
  const { documentType } = z.object({ documentType: z.enum(['BANK_STATEMENT', 'CREDIT_CARD'], { message: 'Escolha se é extrato de conta corrente ou fatura de cartão' }) }).parse(req.body);
  if (!req.file) throw new HttpError(400, 'Envie o arquivo PDF.');
  res.json(await extractPdfStatement(req.file.buffer, documentType));
});

/** Desfaz uma importação: remove as transações do lote e recalcula o saldo */
importsRouter.post('/:id/rollback', async (req, res) => {
  const batch = await prisma.importBatch.findFirst({ where: { id: idParam(req), companyId: companyIdOf(req) } });
  if (!batch) throw notFound('Lote de importação');
  if (batch.status === 'ROLLED_BACK') throw new HttpError(409, 'Lote já foi desfeito');

  const result = await prisma.$transaction(async (db) => {
    // Baixas casadas com o extrato voltam a ser só a baixa; as demais linhas do lote são removidas
    const matched = await db.transaction.findMany({
      where: { importBatchId: batch.id, OR: [{ origin: 'SETTLEMENT' }, { origin: 'MANUAL_CASH', isTransfer: true }] },
      select: { id: true, description: true, customDescription: true },
    });
    for (const t of matched) {
      await db.transaction.update({
        where: { id: t.id },
        data: { fitid: null, importBatchId: null, description: t.customDescription ?? t.description, customDescription: null },
      });
    }
    // Linhas do lote usadas como transferência: desfaz (o lado criado na outra conta some ou volta à conciliação)
    for (const t of await db.transaction.findMany({ where: { importBatchId: batch.id, isTransfer: true }, select: { id: true } })) {
      await undoTransfer(db, batch.companyId, t.id);
    }
    // Contas conciliadas com linhas deste lote voltam a ficar em aberto
    const batchTx = await db.transaction.findMany({ where: { importBatchId: batch.id }, select: { id: true } });
    const affected = await linkedEntries(db, batchTx.map((t) => t.id));
    const { count } = await db.transaction.deleteMany({ where: { importBatchId: batch.id } });
    for (const e of affected) await recomputeEntry(db, e.direction, e.id);
    const updated = await db.importBatch.update({ where: { id: batch.id }, data: { status: 'ROLLED_BACK' } });
    await recalculateBalance(db, batch.bankAccountId);
    return { batch: updated, removedTransactions: count };
  });
  res.json(result);
});

const normalizeAcct = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '');
