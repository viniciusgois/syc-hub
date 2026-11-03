import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { companyIdOf, idParam, notFound } from '../lib/http.js';

export const costCentersRouter = Router({ mergeParams: true });

const costCenterSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

costCentersRouter.get('/', async (req, res) => {
  res.json(await prisma.costCenter.findMany({ where: { companyId: companyIdOf(req) }, orderBy: { name: 'asc' } }));
});

costCentersRouter.post('/', async (req, res) => {
  const data = costCenterSchema.parse(req.body);
  res.status(201).json(await prisma.costCenter.create({ data: { ...data, companyId: companyIdOf(req) } }));
});

costCentersRouter.patch('/:id', async (req, res) => {
  const data = costCenterSchema.partial().parse(req.body);
  const cc = await prisma.costCenter.findFirst({ where: { id: idParam(req), companyId: companyIdOf(req) } });
  if (!cc) throw notFound('Centro de custo');
  res.json(await prisma.costCenter.update({ where: { id: cc.id }, data }));
});

/** Exclui se nunca foi usado; senão arquiva (mantém o histórico) */
costCentersRouter.delete('/:id', async (req, res) => {
  const cc = await prisma.costCenter.findFirst({
    where: { id: idParam(req), companyId: companyIdOf(req) },
    include: { _count: { select: { transactions: true, receivables: true, payables: true, rules: true, splits: true } } },
  });
  if (!cc) throw notFound('Centro de custo');
  if (Object.values(cc._count).some((n) => n > 0)) {
    await prisma.costCenter.update({ where: { id: cc.id }, data: { isActive: false } });
    res.json({ archived: true });
    return;
  }
  await prisma.costCenter.delete({ where: { id: cc.id } });
  res.json({ deleted: true });
});
