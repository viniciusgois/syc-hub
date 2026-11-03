import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, idParam, notFound } from '../lib/http.js';
import { isValidCNPJ, isValidCPF, onlyDigits } from '../lib/documents.js';
import { defaultCategoriesFor } from '../services/defaultChartOfAccounts.js';
import { atLeast } from '../services/auth.js';

export const companiesRouter = Router();

const optionalText = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullable()
  .optional();
const optionalDigits = optionalText.transform((v) => (v ? onlyDigits(v) || null : v));

const companySchema = z.object({
  personType: z.enum(['LEGAL', 'NATURAL']).optional(), // padrão LEGAL na criação
  code: optionalText,
  legalName: z.string().trim().min(2),
  tradeName: optionalText,
  cnpj: z.string().transform(onlyDigits),
  cei: optionalDigits,
  stateReg: optionalText,
  cityReg: optionalText,
  taxRegime: z.enum(['SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'MEI']).optional(),
  email: z.email().nullable().optional(),
  phone: optionalText,
  postalCode: optionalDigits,
  address: optionalText,
  addressNumber: optionalText,
  addressComplement: optionalText,
  district: optionalText,
  city: optionalText,
  cityIbgeCode: optionalText,
  state: z.string().length(2).nullable().optional(),
  segment: optionalText,
  cnae: optionalDigits,
  cnaeDescription: optionalText,
  // Logo pequena (100x100) gravada como data URL ou link externo
  logoUrl: z.string().max(400_000).refine((v) => /^(https?:|data:image\/)/.test(v), 'Logo inválida').nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'TRIAL', 'SUSPENDED']).optional(),
  // Configurações avançadas
  provisioningMonths: z.number().int().min(1, 'Mínimo 1 mês').max(60, 'Máximo 60 meses').optional(),
  accrualBasis: z.boolean().optional(),
  costCentersEnabled: z.boolean().optional(),
  splitsEnabled: z.boolean().optional(),
  bankScheduleEnabled: z.boolean().optional(),
});

function assertDocument(personType: 'LEGAL' | 'NATURAL' | 'FOREIGN', document: string) {
  if (personType === 'FOREIGN') throw new HttpError(400, 'Empresas do exterior não são suportadas');
  const valid = personType === 'LEGAL' ? isValidCNPJ(document) : isValidCPF(document);
  if (!valid) throw new HttpError(400, personType === 'LEGAL' ? 'CNPJ inválido' : 'CPF inválido', { fields: ['cnpj'] });
}

/** Papel do usuário logado na empresa (404 quando não participa: não revela empresas alheias) */
async function membershipRole(userId: string, companyId: string) {
  const m = await prisma.companyUser.findUnique({ where: { userId_companyId: { userId, companyId } }, select: { role: true } });
  if (!m) throw notFound('Empresa');
  return m.role;
}

/** Empresas das quais o usuário logado participa, com o papel dele em cada uma */
companiesRouter.get('/', async (_req, res) => {
  const memberships = await prisma.companyUser.findMany({
    where: { userId: res.locals.userId as string },
    include: { company: { include: { _count: { select: { bankAccounts: true, transactions: true } } } } },
  });
  res.json(memberships.map((m) => ({ ...m.company, role: m.role })).sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'pt-BR')));
});

companiesRouter.get('/:id', async (req, res) => {
  const role = await membershipRole(res.locals.userId as string, idParam(req));
  const company = await prisma.company.findUniqueOrThrow({ where: { id: idParam(req) } });
  res.json({ ...company, role });
});

/** Cria a empresa com o plano de contas padrão; quem cria vira proprietário */
companiesRouter.post('/', async (req, res) => {
  const { tradeName, ...parsed } = companySchema.parse(req.body);
  const data = { ...parsed, personType: parsed.personType ?? ('LEGAL' as const) };
  assertDocument(data.personType, data.cnpj);
  const userId = res.locals.userId as string;

  const company = await prisma.$transaction(async (db) => {
    const created = await db.company.create({ data: { ...data, tradeName: tradeName ?? data.legalName } });
    await db.category.createMany({ data: defaultCategoriesFor(created.id) });
    await db.companyUser.create({ data: { userId, companyId: created.id, role: 'OWNER' } });
    return created;
  });
  res.status(201).json({ ...company, role: 'OWNER' });
});

/** Dados e configurações da empresa: administradores e proprietários */
companiesRouter.patch('/:id', async (req, res) => {
  const role = await membershipRole(res.locals.userId as string, idParam(req));
  if (!atLeast(role, 'ADMIN')) throw new HttpError(403, 'Só administradores alteram os dados e as configurações da empresa');
  const current = await prisma.company.findUniqueOrThrow({ where: { id: idParam(req) } });
  const data = companySchema.partial().parse(req.body);
  // Só revalida o documento quando ele (ou o tipo de pessoa) muda de fato
  if ((data.cnpj !== undefined && data.cnpj !== current.cnpj) || (data.personType !== undefined && data.personType !== current.personType)) {
    assertDocument(data.personType ?? current.personType, data.cnpj ?? current.cnpj);
  }
  const updated = await prisma.company.update({
    where: { id: current.id },
    data: { ...data, tradeName: data.tradeName === null ? current.legalName : data.tradeName },
  });
  res.json({ ...updated, role });
});
