import { Router } from 'express';
import { z } from 'zod';
import type { DRESection } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError, companyIdOf, idParam, notFound } from '../lib/http.js';

export const categoriesRouter = Router({ mergeParams: true });

const sections = z.enum(['OPERATING_REVENUE', 'OPERATING_COSTS', 'OPERATING_EXPENSES', 'INVESTING', 'FINANCING']);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(80),
  isGroup: z.boolean().default(false),
  type: z.enum(['INCOME', 'EXPENSE']).optional(), // obrigatório para categoria
  section: sections,
  parentId: z.uuid().nullish(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(80).optional(),
  type: z.enum(['INCOME', 'EXPENSE']).optional(),
  section: sections.optional(),
  parentId: z.uuid().nullish(),
  isActive: z.boolean().optional(),
});

async function findOwned(companyId: string, id: string) {
  const category = await prisma.category.findFirst({ where: { id, companyId } });
  if (!category) throw notFound('Categoria');
  return category;
}

/** Valida o subgrupo de destino: precisa ser um subgrupo da mesma empresa e seção */
async function assertParent(companyId: string, section: DRESection, parentId?: string | null) {
  if (!parentId) return;
  const parent = await prisma.category.findFirst({ where: { id: parentId, companyId } });
  if (!parent || !parent.isGroup) throw new HttpError(400, 'Subgrupo inválido');
  if (parent.section !== section) throw new HttpError(400, 'O subgrupo pertence a outra seção');
}

/** Próxima posição no nível; recebe o cliente da transação quando chamado dentro de uma */
const nextOrder = async (companyId: string, section: DRESection, parentId: string | null, db: Pick<typeof prisma, 'category'> = prisma) =>
  ((await db.category.aggregate({ where: { companyId, section, parentId }, _max: { orderIndex: true } }))._max.orderIndex ?? -1) + 1;

/** Plano de contas (inclui subgrupos). ?all=true inclui arquivadas e categorias fora da DRE */
categoriesRouter.get('/', async (req, res) => {
  const all = req.query.all === 'true';
  const categories = await prisma.category.findMany({
    where: { companyId: companyIdOf(req), ...(!all && { isActive: true }) },
    orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { transactions: true, receivables: true, payables: true, rules: true, recurrences: true, children: true, splits: true } },
    },
  });
  res.json(categories.map(({ _count, ...c }) => ({ ...c, usageCount: _count.transactions + _count.receivables + _count.payables + _count.recurrences + _count.splits, childrenCount: _count.children })));
});

categoriesRouter.post('/', async (req, res) => {
  const companyId = companyIdOf(req);
  const data = createSchema.parse(req.body);
  if (!data.isGroup && !data.type) throw new HttpError(400, 'Informe se é entrada ou saída', { fields: ['type'] });
  if (data.isGroup && data.parentId) throw new HttpError(400, 'Subgrupo não pode ficar dentro de outro subgrupo');
  await assertParent(companyId, data.section, data.parentId);

  const parentId = data.parentId ?? null;
  const category = await prisma.category.create({
    data: {
      companyId,
      name: data.name,
      isGroup: data.isGroup,
      type: data.isGroup ? 'EXPENSE' : data.type!,
      section: data.section,
      parentId,
      orderIndex: await nextOrder(companyId, data.section, parentId),
    },
  });
  res.status(201).json(category);
});

categoriesRouter.patch('/:id', async (req, res) => {
  const companyId = companyIdOf(req);
  const current = await findOwned(companyId, idParam(req));
  const data = updateSchema.parse(req.body);
  if (current.isSystem) throw new HttpError(400, 'Categoria do sistema não pode ser alterada');

  const section = data.section ?? current.section;
  if (!section) throw new HttpError(400, 'Esta categoria não faz parte da DRE');
  // Trocar de seção sem informar subgrupo: vai para a raiz da nova seção
  const parentId = data.parentId !== undefined ? data.parentId : data.section && data.section !== current.section ? null : current.parentId;
  if (current.isGroup && parentId) throw new HttpError(400, 'Subgrupo não pode ficar dentro de outro subgrupo');
  if (parentId === current.id) throw new HttpError(400, 'Categoria não pode ficar dentro dela mesma');
  await assertParent(companyId, section, parentId);

  const moved = section !== current.section || parentId !== current.parentId;
  const updated = await prisma.$transaction(async (db) => {
    const result = await db.category.update({
      where: { id: current.id },
      data: {
        name: data.name,
        type: current.isGroup ? undefined : data.type,
        isActive: data.isActive,
        section,
        parentId,
        ...(moved && { orderIndex: await nextOrder(companyId, section, parentId, db) }),
      },
    });
    // Subgrupo levado para outra seção leva as categorias junto
    if (current.isGroup && section !== current.section) {
      await db.category.updateMany({ where: { parentId: current.id }, data: { section } });
    }
    return result;
  });
  res.json(updated);
});

/** Reordena itens de um mesmo nível (raiz da seção ou dentro de um subgrupo) */
categoriesRouter.post('/reorder', async (req, res) => {
  const companyId = companyIdOf(req);
  const { ids } = z.object({ ids: z.array(z.uuid()).min(1).max(500) }).parse(req.body);
  const rows = await prisma.category.findMany({ where: { id: { in: ids }, companyId }, select: { id: true, section: true, parentId: true } });
  if (rows.length !== ids.length) throw notFound('Categoria');
  const sameLevel = rows.every((r) => r.section === rows[0].section && r.parentId === rows[0].parentId);
  if (!sameLevel) throw new HttpError(400, 'Só é possível reordenar itens do mesmo nível');
  await prisma.$transaction(ids.map((id, orderIndex) => prisma.category.update({ where: { id }, data: { orderIndex } })));
  res.json({ reordered: ids.length });
});

/**
 * Excluir: subgrupo devolve as categorias para a raiz da seção; categoria em uso é arquivada
 * (some das listas mas mantém o histórico); categorias do sistema não podem ser excluídas.
 */
categoriesRouter.delete('/:id', async (req, res) => {
  const companyId = companyIdOf(req);
  const category = await prisma.category.findFirst({
    where: { id: idParam(req), companyId },
    include: { _count: { select: { transactions: true, receivables: true, payables: true, rules: true, recurrences: true, splits: true } } },
  });
  if (!category) throw notFound('Categoria');
  if (category.isSystem) throw new HttpError(400, 'Categoria do sistema não pode ser excluída');

  if (category.isGroup) {
    await prisma.$transaction(async (db) => {
      const base = await nextOrder(companyId, category.section!, null, db);
      const children = await db.category.findMany({ where: { parentId: category.id }, orderBy: { orderIndex: 'asc' }, select: { id: true } });
      for (const [i, c] of children.entries()) await db.category.update({ where: { id: c.id }, data: { parentId: null, orderIndex: base + i } });
      await db.category.delete({ where: { id: category.id } });
    });
    res.json({ deleted: true, movedChildren: true });
    return;
  }

  const inUse = Object.values(category._count).some((n) => n > 0);
  if (inUse) {
    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    res.json({ archived: true });
    return;
  }
  await prisma.category.delete({ where: { id: category.id } });
  res.json({ deleted: true });
});
