import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { companyIdOf, idParam } from '../lib/http.js';
import { currentUser, userIdOf } from '../middleware/currentUser.js';
import { analyzeNibo, commitNibo, niboMappingSchema, niboRowsSchema, rollbackNibo } from '../services/niboImport.js';
import { analyzeNiboTransfers, commitNiboTransfers, niboTransfersSchema, rollbackNiboTransfers, transferAccountMapSchema } from '../services/niboTransfers.js';
import { HttpError } from '../lib/http.js';
import { applyChart, assertChartItems, chartApplySchema, chartItemsSchema, planChart } from '../services/niboChart.js';

/** Migração do Nibo: relatório "Unificado por lançamento" (Excel lido pelo frontend) */
export const niboImportsRouter = Router({ mergeParams: true });

const fileSchema = z.object({ fileName: z.string().trim().min(1).max(250), rows: niboRowsSchema });

niboImportsRouter.get('/', async (req, res) => {
  res.json(
    await prisma.dataImport.findMany({
      where: { companyId: companyIdOf(req), source: { in: ['NIBO', 'NIBO_TRANSFERS'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, source: true, fileName: true, status: true, summary: true, createdAt: true },
    }),
  );
});

/** Plano de contas do Nibo (PDF lido pelo frontend): prévia do que será criado, movido e removido */
niboImportsRouter.post('/chart/preview', async (req, res) => {
  const { items } = z.object({ items: chartItemsSchema }).parse(req.body);
  assertChartItems(items);
  res.json(await planChart(companyIdOf(req), items));
});

niboImportsRouter.post('/chart', async (req, res) => {
  const body = chartApplySchema.parse(req.body);
  assertChartItems(body.items);
  res.json(await applyChart(companyIdOf(req), body));
});

/** Prévia: agrupa contas/categorias, confere totais e lista o que revisar (não grava nada) */
niboImportsRouter.post('/preview', async (req, res) => {
  const { rows } = fileSchema.parse(req.body);
  res.json(await analyzeNibo(companyIdOf(req), rows));
});

niboImportsRouter.post('/', currentUser, async (req, res) => {
  const { fileName, rows, mapping } = fileSchema.extend({ mapping: niboMappingSchema }).parse(req.body);
  res.status(201).json(await commitNibo(companyIdOf(req), userIdOf(res), fileName, rows, mapping));
});

/** Passo 3: transferências entre contas (relatório "Transferências" do Nibo, Excel lido pelo frontend) */
const transfersBody = z.object({ fileName: z.string().trim().min(1).max(250), transfers: niboTransfersSchema, accountMap: transferAccountMapSchema.default({}) });

niboImportsRouter.post('/transfers/preview', async (req, res) => {
  const { transfers, accountMap } = transfersBody.parse(req.body);
  res.json(await analyzeNiboTransfers(companyIdOf(req), transfers, accountMap));
});

niboImportsRouter.post('/transfers', currentUser, async (req, res) => {
  const { fileName, transfers, accountMap } = transfersBody.parse(req.body);
  res.status(201).json(await commitNiboTransfers(companyIdOf(req), userIdOf(res), fileName, transfers, accountMap));
});

niboImportsRouter.post('/:id/rollback', async (req, res) => {
  const companyId = companyIdOf(req);
  const record = await prisma.dataImport.findFirst({ where: { id: idParam(req), companyId } });
  if (!record) throw new HttpError(404, 'Importação não encontrada');
  if (record.source === 'NIBO_TRANSFERS') {
    if (record.status !== 'PROCESSED') throw new HttpError(409, 'Esta importação já foi desfeita');
    res.json(await rollbackNiboTransfers(companyId, record));
    return;
  }
  res.json(await rollbackNibo(companyId, record.id));
});
