import { z } from 'zod';
import type { Category, DRESection, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { norm } from './niboImport.js';
import { correctCategoryName } from './ptCorrections.js';

/**
 * Plano de contas do Nibo (PDF da tela Configurações › Categorias, lido pelo frontend).
 * Aplica na empresa: cria subgrupos e categorias, move as que já existem para a seção/subgrupo do Nibo,
 * na mesma ordem, e (opcional) remove as categorias sem uso que não estão no plano.
 * Só vale para a empresa escolhida: o plano padrão das empresas novas não muda.
 * Categorias do sistema (juros, multas, descontos) são reconhecidas, mas nunca alteradas.
 */

const sections = ['OPERATING_REVENUE', 'OPERATING_COSTS', 'OPERATING_EXPENSES', 'INVESTING', 'FINANCING'] as const;

export const chartItemSchema = z.object({
  section: z.enum(sections),
  group: z.string().trim().min(1).max(120).nullable(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['INCOME', 'EXPENSE']),
  locked: z.boolean().default(false), // cadeado no Nibo (categoria do sistema)
});
export type ChartItem = z.infer<typeof chartItemSchema>;
export const chartItemsSchema = z.array(chartItemSchema).min(1, 'Nenhuma categoria encontrada no PDF').max(2000);

export const chartApplySchema = z.object({
  items: chartItemsSchema,
  /** Nome corrigido aprovado (chave = itemKey/groupKey) */
  renames: z.record(z.string(), z.string().trim().min(1).max(120)).default({}),
  removeUnmatched: z.boolean().default(true),
});

/** Nomes que o Nibo e o SYC Hub escrevem diferente para a mesma categoria do sistema */
const SYNONYMS: Record<string, string> = { 'descontos recebidos': 'descontos obtidos' };

export const itemKey = (i: Pick<ChartItem, 'type' | 'name'>) => `${i.type}|${i.name}`;
export const groupKey = (section: DRESection, name: string) => `GROUP|${section}|${name}`;

type Cat = Pick<Category, 'id' | 'name' | 'type' | 'section' | 'parentId' | 'isGroup' | 'isSystem' | 'orderIndex'>;

async function usage(companyId: string) {
  const counts = new Map<string, number>();
  const add = (rows: { categoryId: string | null; _count: { _all: number } }[]) => {
    for (const r of rows) if (r.categoryId) counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + r._count._all);
  };
  const where = { companyId };
  const [rec, pay, tx, spl, rules, recur] = await Promise.all([
    prisma.receivable.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
    prisma.payable.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
    prisma.transaction.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
    prisma.entrySplit.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
    prisma.reconciliationRule.groupBy({ by: ['targetCategoryId'], where, _count: { _all: true } }),
    prisma.recurrence.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
  ]);
  add(rec);
  add(pay);
  add(tx);
  add(spl);
  add(recur);
  add(rules.map((r) => ({ categoryId: r.targetCategoryId, _count: r._count })));
  return counts;
}

/** Casa o plano do Nibo com o que já existe na empresa (nada é gravado) */
export async function planChart(companyId: string, items: ChartItem[]) {
  const existing: Cat[] = await prisma.category.findMany({
    where: { companyId, section: { not: null } },
    select: { id: true, name: true, type: true, section: true, parentId: true, isGroup: true, isSystem: true, orderIndex: true },
  });
  const used = await usage(companyId);
  const taken = new Set<string>();
  const find = (pred: (c: Cat) => boolean, names: string[]) => {
    const wanted = new Set(names.map(norm).flatMap((n) => [n, SYNONYMS[n]].filter((v): v is string => !!v)));
    const hit = existing.find((c) => !taken.has(c.id) && pred(c) && wanted.has(norm(c.name)));
    if (hit) taken.add(hit.id);
    return hit;
  };

  // Subgrupos, na ordem em que aparecem
  const groupList: { key: string; section: DRESection; name: string; suggestedName: string | null; existingId: string | null; existingName: string | null }[] = [];
  for (const i of items) {
    if (!i.group || groupList.some((g) => g.section === i.section && g.name === i.group)) continue;
    const suggestedName = correctCategoryName(i.group);
    const hit = find((c) => c.isGroup, [i.group, ...(suggestedName ? [suggestedName] : [])]);
    // Já corrigido numa aplicação anterior: nada a sugerir
    groupList.push({ key: groupKey(i.section, i.group), section: i.section, name: i.group, suggestedName: hit?.name === suggestedName ? null : suggestedName, existingId: hit?.id ?? null, existingName: hit?.name ?? null });
  }

  const plan = items.map((i, index) => {
    const suggestedName = i.locked ? null : correctCategoryName(i.name);
    const hit = find((c) => !c.isGroup && c.type === i.type, [i.name, ...(suggestedName ? [suggestedName] : [])]);
    const group = i.group ? groupList.find((g) => g.section === i.section && g.name === i.group)! : null;
    const moves = !!hit && !hit.isSystem && (hit.section !== i.section || (group ? hit.parentId !== group.existingId || !group.existingId : !!hit.parentId));
    return {
      key: itemKey(i),
      index,
      ...i,
      suggestedName: hit?.name === suggestedName ? null : suggestedName,
      existingId: hit?.id ?? null,
      existingName: hit?.name ?? null,
      action: !hit ? ('create' as const) : hit.isSystem ? ('system' as const) : moves ? ('move' as const) : ('keep' as const),
      uses: hit ? (used.get(hit.id) ?? 0) : 0,
    };
  });

  // O que não está no plano: sem uso pode sair; com lançamentos fica
  const leftovers = existing.filter((c) => !taken.has(c.id) && !c.isSystem && !c.isGroup);
  const remove = leftovers.filter((c) => !used.get(c.id)).map((c) => ({ id: c.id, name: c.name, section: c.section }));
  const keep = leftovers.filter((c) => used.get(c.id)).map((c) => ({ id: c.id, name: c.name, section: c.section, uses: used.get(c.id)! }));
  const systemOutside = existing.filter((c) => c.isSystem && !taken.has(c.id)).map((c) => c.name);

  return {
    groups: groupList,
    items: plan,
    remove,
    keep,
    systemOutside,
    counts: {
      create: plan.filter((p) => p.action === 'create').length + groupList.filter((g) => !g.existingId).length,
      move: plan.filter((p) => p.action === 'move').length,
      keep: plan.filter((p) => p.action === 'keep' || p.action === 'system').length,
      corrections: plan.filter((p) => p.suggestedName).length + groupList.filter((g) => g.suggestedName).length,
    },
  };
}

/** Aplica o plano numa transação */
export async function applyChart(companyId: string, input: z.infer<typeof chartApplySchema>) {
  const plan = await planChart(companyId, input.items);
  // Correção aprovada; senão, a que já existe mantém o nome atual e a nova usa o nome do Nibo
  const nameOf = (key: string, original: string, existingName: string | null) => input.renames[key] ?? existingName ?? original;

  return prisma.$transaction(
    async (db) => {
      let order = 0;
      const groupId = new Map<string, string>();
      for (const g of plan.groups) {
        const name = nameOf(g.key, g.name, g.existingName);
        if (g.existingId) {
          await db.category.update({ where: { id: g.existingId }, data: { name, section: g.section, orderIndex: ++order, isActive: true } });
          groupId.set(g.key, g.existingId);
        } else {
          const created = await db.category.create({ data: { companyId, name, isGroup: true, type: 'EXPENSE', section: g.section, orderIndex: ++order } });
          groupId.set(g.key, created.id);
        }
      }
      const result = { created: plan.groups.filter((g) => !g.existingId).length, moved: 0, renamed: 0, removed: 0 };
      for (const p of plan.items) {
        const parentId = p.group ? groupId.get(groupKey(p.section, p.group))! : null;
        const name = nameOf(p.key, p.name, p.existingName);
        const data: Prisma.CategoryUncheckedUpdateInput = { section: p.section, parentId, orderIndex: ++order, isActive: true };
        if (p.action === 'system') continue; // categorias do sistema ficam como estão
        if (p.existingId) {
          const current = await db.category.findUniqueOrThrow({ where: { id: p.existingId }, select: { name: true } });
          if (name !== current.name) result.renamed++;
          if (p.action === 'move') result.moved++;
          await db.category.update({ where: { id: p.existingId }, data: { ...data, name } });
        } else {
          await db.category.create({ data: { companyId, name, type: p.type, section: p.section, parentId, orderIndex: order } });
          result.created++;
        }
      }
      if (input.removeUnmatched) {
        const ids = plan.remove.map((r) => r.id);
        result.removed = (await db.category.deleteMany({ where: { id: { in: ids }, companyId, isSystem: false } })).count;
        // Subgrupos que ficaram vazios e não estão no plano
        const keepGroups = new Set(groupId.values());
        const emptyGroups = await db.category.findMany({ where: { companyId, isGroup: true, id: { notIn: [...keepGroups] }, children: { none: {} } }, select: { id: true } });
        await db.category.deleteMany({ where: { id: { in: emptyGroups.map((g) => g.id) } } });
      }
      return { ...result, kept: plan.keep.length };
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
}

export function assertChartItems(items: ChartItem[]) {
  const seen = new Set<string>();
  for (const i of items) {
    const k = itemKey(i); // o Nibo aceita nomes que só mudam a caixa ("Serviços Contratados" e "Serviços contratados")
    if (seen.has(k)) throw new HttpError(400, `Categoria repetida no PDF: "${i.name}"`);
    seen.add(k);
  }
}
