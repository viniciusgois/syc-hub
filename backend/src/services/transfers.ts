import { Prisma } from '@prisma/client';
import { HttpError, notFound } from '../lib/http.js';
import { recalculateBalances } from './balance.js';

type Db = Prisma.TransactionClient;

/** Janela para reconhecer a contrapartida de uma transferência no extrato da outra conta */
export const TRANSFER_WINDOW_MS = 3 * 86_400_000;

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount?: number;
  date?: Date;
  description?: string | null;
  /** Linha do extrato (de qualquer uma das contas) que esta transferência concilia */
  transactionId?: string | null;
  /** Linha da outra conta a usar como contrapartida (sem ela, procura uma ou cria) */
  counterpartId?: string | null;
}

/** Linha ainda não conciliada, sem baixa vinculada (pode virar um lado da transferência) */
async function openLine(db: Db, companyId: string, id: string) {
  const line = await db.transaction.findFirst({ where: { id, companyId }, include: { _count: { select: { settlements: true } } } });
  if (!line) throw notFound('Movimentação');
  if (line.reconciliationStatus === 'RECONCILED' || line.reconciliationStatus === 'IGNORED' || line._count.settlements) {
    throw new HttpError(409, 'Esta movimentação já foi conciliada ou descartada');
  }
  return line;
}

/**
 * Registra uma transferência entre duas contas da empresa: uma saída na origem e uma entrada no destino,
 * ambas conciliadas e fora do resultado (DRE/Painel). Linhas do extrato informadas (ou encontradas com
 * mesmo valor e até 3 dias de diferença) viram os lados da transferência em vez de criar outra.
 */
export async function createTransfer(db: Db, companyId: string, userId: string, input: TransferInput) {
  if (input.fromAccountId === input.toAccountId) throw new HttpError(400, 'Escolha contas diferentes', { fields: ['toAccountId'] });
  const accounts = await db.bankAccount.findMany({ where: { companyId, id: { in: [input.fromAccountId, input.toAccountId] } } });
  const from = accounts.find((a) => a.id === input.fromAccountId);
  const to = accounts.find((a) => a.id === input.toAccountId);
  if (!from || !to) throw notFound('Conta bancária');

  const line = input.transactionId ? await openLine(db, companyId, input.transactionId) : null;
  if (line) {
    const expected = line.bankAccountId === from.id ? 'DEBIT' : line.bankAccountId === to.id ? 'CREDIT' : null;
    if (!expected) throw new HttpError(400, 'A movimentação não pertence a nenhuma das contas da transferência');
    if (line.type !== expected) throw new HttpError(400, expected === 'DEBIT' ? 'Uma entrada não pode sair desta conta' : 'Uma saída não pode entrar nesta conta');
  }
  const amount = line ? new Prisma.Decimal(line.amount) : new Prisma.Decimal(input.amount ?? 0);
  const date = line?.date ?? input.date;
  if (!amount.gt(0)) throw new HttpError(400, 'Informe o valor', { fields: ['amount'] });
  if (!date) throw new HttpError(400, 'Informe a data', { fields: ['date'] });

  // Contrapartida: a indicada, ou uma linha em aberto de mesmo valor no extrato da outra conta
  const otherAccountId = line ? (line.bankAccountId === from.id ? to.id : from.id) : null;
  let counterpart: Prisma.TransactionGetPayload<object> | null = input.counterpartId ? await openLine(db, companyId, input.counterpartId) : null;
  if (counterpart && (counterpart.bankAccountId !== otherAccountId || counterpart.type === line?.type || !amount.eq(counterpart.amount))) {
    throw new HttpError(400, 'A contrapartida precisa ser da outra conta, em sentido oposto e com o mesmo valor');
  }
  if (!counterpart && line && otherAccountId) {
    const near = await db.transaction.findMany({
      where: {
        companyId,
        bankAccountId: otherAccountId,
        type: line.type === 'DEBIT' ? 'CREDIT' : 'DEBIT',
        amount,
        reconciliationStatus: { in: ['PENDING', 'SUGGESTED'] },
        settlements: { none: {} },
        date: { gte: new Date(date.getTime() - TRANSFER_WINDOW_MS), lte: new Date(date.getTime() + TRANSFER_WINDOW_MS) },
      },
    });
    counterpart = near.sort((a, b) => Math.abs(a.date.getTime() - date.getTime()) - Math.abs(b.date.getTime() - date.getTime()))[0] ?? null;
  }

  const outLine = line?.type === 'DEBIT' ? line : counterpart?.type === 'DEBIT' ? counterpart : null;
  const inLine = line?.type === 'CREDIT' ? line : counterpart?.type === 'CREDIT' ? counterpart : null;
  const text = input.description?.trim();
  const reconciled = { reconciliationStatus: 'RECONCILED' as const, reconciledAt: new Date(), reconciledByUserId: userId };

  /** Usa a linha do extrato (classificação limpa) ou cria o lado que falta */
  const side = async (existing: Prisma.TransactionGetPayload<object> | null, accountId: string, type: 'DEBIT' | 'CREDIT', label: string) => {
    if (existing) {
      await db.entrySplit.deleteMany({ where: { transactionId: existing.id } });
      return db.transaction.update({
        where: { id: existing.id },
        data: { isTransfer: true, categoryId: null, costCenterId: null, contactId: null, reconciliationRuleId: null, customDescription: text || label, ...reconciled },
      });
    }
    return db.transaction.create({
      data: { companyId, bankAccountId: accountId, type, amount, date, description: text || label, origin: 'MANUAL_CASH', isTransfer: true, ...reconciled },
    });
  };
  const out = await side(outLine, from.id, 'DEBIT', `Transferência para ${to.name}`);
  const inc = await side(inLine, to.id, 'CREDIT', `Transferência de ${from.name}`);
  await db.transaction.update({ where: { id: out.id }, data: { transferCounterpartId: inc.id } });
  await db.transaction.update({ where: { id: inc.id }, data: { transferCounterpartId: out.id } });
  await recalculateBalances(db, [from.id, to.id]);
  return { outId: out.id, inId: inc.id, matchedCounterpart: !!counterpart };
}

/**
 * Desfaz a transferência: o lado criado no sistema é apagado; linhas vindas do extrato do banco
 * voltam para a Conciliação.
 */
export async function undoTransfer(db: Db, companyId: string, transactionId: string) {
  const tx = await db.transaction.findFirst({ where: { id: transactionId, companyId, isTransfer: true } });
  if (!tx) throw notFound('Transferência');
  const pair = tx.transferCounterpartId ? await db.transaction.findFirst({ where: { id: tx.transferCounterpartId, companyId } }) : null;
  const sides = [tx, ...(pair ? [pair] : [])];
  for (const s of sides) {
    if (s.origin === 'MANUAL_CASH' && !s.fitid) {
      await db.transaction.delete({ where: { id: s.id } });
    } else {
      await db.transaction.update({
        where: { id: s.id },
        data: { isTransfer: false, transferCounterpartId: null, customDescription: null, reconciliationStatus: 'PENDING', reconciledAt: null, reconciledByUserId: null },
      });
    }
  }
  await recalculateBalances(db, sides.map((s) => s.bankAccountId));
  return { removed: sides.length };
}
