import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Recalcula o saldo atual: saldo inicial + créditos - débitos a partir da data do saldo inicial.
 * Como no Nibo, só contam as linhas conciliadas (o importado ainda não conciliado fica na tela de Conciliação).
 */
export async function recalculateBalance(db: Tx, bankAccountId: string) {
  const account = await db.bankAccount.findUniqueOrThrow({
    where: { id: bankAccountId },
    select: { initialBalance: true, initialBalanceDate: true },
  });

  const sums = await db.transaction.groupBy({
    by: ['type'],
    where: {
      bankAccountId,
      date: { gte: account.initialBalanceDate },
      reconciliationStatus: 'RECONCILED',
    },
    _sum: { amount: true },
  });

  let balance = new Prisma.Decimal(account.initialBalance);
  for (const s of sums) {
    const value = s._sum.amount ?? new Prisma.Decimal(0);
    balance = s.type === 'CREDIT' ? balance.plus(value) : balance.minus(value);
  }

  return db.bankAccount.update({ where: { id: bankAccountId }, data: { currentBalance: balance } });
}

/** Recalcula várias contas (sem repetir) */
export async function recalculateBalances(db: Tx, bankAccountIds: Iterable<string>) {
  for (const id of new Set(bankAccountIds)) await recalculateBalance(db, id);
}
