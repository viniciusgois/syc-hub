import { z } from 'zod';
import { Prisma, type CategoryType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';

/**
 * Rateio: divide o valor de um lançamento / linha do extrato / recorrência entre categorias
 * e centros de custo. Cada linha é gravada com sinal relativo ao dono: positiva quando a
 * categoria tem a mesma natureza (receita num recebimento), negativa quando é oposta
 * (ex.: recebimento líquido de R$ 970 = Vendas 1.000 − Taxa da maquininha 30).
 */

type Db = Prisma.TransactionClient | typeof prisma;
const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);

export const splitLineSchema = z.object({
  categoryId: z.uuid({ message: 'Selecione a categoria' }),
  costCenterId: z.uuid().nullish(),
  amount: z.number().positive('Informe o valor').max(9_999_999_999), // sempre positivo; o sinal vem da categoria
});
export const splitsSchema = z.array(splitLineSchema).min(2, 'O rateio precisa de ao menos 2 linhas').max(50);
export type SplitInput = z.infer<typeof splitLineSchema>;

/** Dono do rateio (exatamente um) */
export type SplitOwner = { receivableId: string } | { payableId: string } | { transactionId: string } | { recurrenceId: string };

export interface SplitLine {
  categoryId: string;
  costCenterId: string | null;
  amount: Prisma.Decimal; // com sinal
}

export const splitInclude = {
  orderBy: { orderIndex: 'asc' },
  select: { id: true, categoryId: true, costCenterId: true, amount: true, category: { select: { name: true, type: true } }, costCenter: { select: { name: true } } },
} as const;

/**
 * Valida as linhas e devolve-as com sinal. A soma com sinal precisa fechar com o valor do dono.
 * `nature`: INCOME para recebimentos/entradas, EXPENSE para pagamentos/saídas.
 */
export async function resolveSplits(db: Db, companyId: string, nature: Exclude<CategoryType, 'TRANSFER'>, total: Prisma.Decimal.Value, input: SplitInput[]) {
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { splitsEnabled: true } });
  if (!company.splitsEnabled) throw new HttpError(400, 'Ative o rateio em Configurações > Avançado');

  const categoryIds = [...new Set(input.map((l) => l.categoryId))];
  const costCenterIds = [...new Set(input.map((l) => l.costCenterId).filter((v): v is string => !!v))];
  const [categories, costCenters] = await Promise.all([
    db.category.findMany({ where: { id: { in: categoryIds }, companyId }, select: { id: true, name: true, type: true, isGroup: true, section: true, isActive: true } }),
    db.costCenter.findMany({ where: { id: { in: costCenterIds }, companyId }, select: { id: true } }),
  ]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  if (costCenters.length !== costCenterIds.length) throw new HttpError(400, 'Centro de custo inválido no rateio');

  const lines: SplitLine[] = input.map((l) => {
    const c = byId.get(l.categoryId);
    if (!c) throw new HttpError(400, 'Categoria inválida no rateio');
    if (c.isGroup) throw new HttpError(400, `"${c.name}" é um subgrupo; escolha uma categoria`);
    if (!c.section || c.type === 'TRANSFER') throw new HttpError(400, `"${c.name}" não pode ser usada no rateio`);
    const amount = D(l.amount).toDecimalPlaces(2);
    return { categoryId: c.id, costCenterId: l.costCenterId ?? null, amount: c.type === nature ? amount : amount.negated() };
  });

  const sum = lines.reduce((s, l) => s.plus(l.amount), D());
  if (!sum.equals(D(total).toDecimalPlaces(2))) {
    throw new HttpError(400, `O rateio soma R$ ${sum.toFixed(2).replace('.', ',')}, mas o valor é R$ ${D(total).toFixed(2).replace('.', ',')}`, { fields: ['splits'] });
  }
  return lines;
}

/** Linha principal: a de maior valor da mesma natureza (vira a categoria/centro de custo "de capa" do dono) */
export function mainLine(lines: SplitLine[]) {
  return [...lines].sort((a, b) => b.amount.comparedTo(a.amount))[0];
}

/** Substitui o rateio do dono (lista vazia = remove) */
export async function replaceSplits(db: Prisma.TransactionClient, companyId: string, owner: SplitOwner, lines: SplitLine[]) {
  await db.entrySplit.deleteMany({ where: owner });
  if (!lines.length) return;
  await db.entrySplit.createMany({
    data: lines.map((l, orderIndex) => ({ companyId, ...owner, categoryId: l.categoryId, costCenterId: l.costCenterId, amount: l.amount, orderIndex })),
  });
}

/**
 * Reescala um rateio para outro valor mantendo as proporções (parcelas, recorrências, valor editado).
 * A diferença de arredondamento fica na maior linha.
 */
export function scaleSplits(lines: SplitLine[], target: Prisma.Decimal.Value): SplitLine[] {
  const base = lines.reduce((s, l) => s.plus(l.amount), D());
  const to = D(target);
  if (base.isZero() || base.equals(to)) return lines.map((l) => ({ ...l, amount: D(l.amount) }));
  const scaled = lines.map((l) => ({ ...l, amount: D(l.amount).times(to).div(base).toDecimalPlaces(2) }));
  const diff = to.minus(scaled.reduce((s, l) => s.plus(l.amount), D()));
  if (!diff.isZero()) {
    const main = scaled.reduce((m, l) => (l.amount.gt(m.amount) ? l : m), scaled[0]);
    main.amount = main.amount.plus(diff);
  }
  return scaled;
}
