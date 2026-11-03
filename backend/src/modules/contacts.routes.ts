import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError, companyIdOf, idParam, notFound } from '../lib/http.js';
import { isValidCNPJ, isValidCPF, onlyDigits } from '../lib/documents.js';
import { currentUser, userIdOf } from '../middleware/currentUser.js';
import { displayDescription, openAmount, startOfTodayUtc } from '../services/entries.js';

export const contactsRouter = Router({ mergeParams: true });

const contactTypes = z.enum(['CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'PARTNER', 'OTHER']);
type ContactTypeValue = z.infer<typeof contactTypes>;

const TYPE_LABEL: Record<ContactTypeValue, string> = {
  CUSTOMER: 'cliente',
  SUPPLIER: 'fornecedor',
  EMPLOYEE: 'funcionário',
  PARTNER: 'sócio',
  OTHER: 'contato',
};

// Texto opcional: aceita ausente, null ou vazio (vira null)
const optionalText = z
  .string()
  .trim()
  .transform((v) => v || null)
  .nullish();

/** "a@x.com; b@y.com" -> "a@x.com, b@y.com" (cada e-mail validado) */
const emailList = optionalText.superRefine((value, ctx) => {
  if (!value) return;
  const invalid = value.split(/[,;]/).map((e) => e.trim()).filter((e) => e && !z.email().safeParse(e).success);
  if (invalid.length) ctx.addIssue({ code: 'custom', message: `E-mail inválido: ${invalid.join(', ')}` });
}).transform((value) => (value ? value.split(/[,;]/).map((e) => e.trim()).filter(Boolean).join(', ') : value));

const bankDetailsSchema = z
  .object({
    bankCode: optionalText,
    bankName: optionalText,
    agency: optionalText,
    accountNumber: optionalText,
    accountDigit: optionalText,
    accountType: z.enum(['CHECKING', 'SAVINGS']).nullish(),
    pixKeyType: z.enum(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM']).nullish(),
    pixKey: optionalText,
  })
  .nullish();

const contactSchema = z.object({
  type: contactTypes,
  personType: z.enum(['LEGAL', 'NATURAL', 'FOREIGN']).default('LEGAL'),
  name: z.string().trim().min(1, 'Informe o nome'),
  tradeName: optionalText,
  document: optionalText,
  cityReg: optionalText,
  email: emailList,
  phone: optionalText,
  mobile: optionalText,
  contactPerson: optionalText,
  website: optionalText,
  postalCode: optionalText,
  address: optionalText,
  addressNumber: optionalText,
  addressComplement: optionalText,
  district: optionalText,
  city: optionalText,
  cityIbgeCode: optionalText,
  state: optionalText,
  country: optionalText,
  bankDetails: bankDetailsSchema,
  notes: optionalText,
  isActive: z.boolean().optional(),
});

type ContactInput = z.infer<typeof contactSchema>;

/** Normaliza e valida o documento conforme o tipo de pessoa (CNPJ/CPF só dígitos; exterior livre) */
function normalizeDocument(personType: ContactInput['personType'], document: string | null | undefined) {
  if (!document) return document;
  if (personType === 'FOREIGN') return document;
  const digits = onlyDigits(document);
  const valid = personType === 'LEGAL' ? isValidCNPJ(digits) : isValidCPF(digits);
  if (!valid) throw new HttpError(400, personType === 'LEGAL' ? 'CNPJ inválido' : 'CPF inválido', { fields: ['document'] });
  return digits;
}

async function assertUniqueDocument(companyId: string, type: ContactTypeValue, document: string | null | undefined, ignoreId?: string) {
  if (!document) return;
  const existing = await prisma.contact.findFirst({
    where: { companyId, type, document, ...(ignoreId && { id: { not: ignoreId } }) },
    select: { id: true, name: true, isActive: true },
  });
  if (existing) {
    throw new HttpError(409, `Já existe um ${TYPE_LABEL[type]} com este documento: ${existing.name}${existing.isActive ? '' : ' (arquivado)'}`, {
      fields: ['document'],
      contactId: existing.id,
    });
  }
}


/** Em aberto / vencido por contato, somando contas a pagar e a receber pendentes */
async function openBalances(companyId: string, contactIds?: string[]) {
  const where = { companyId, status: 'PENDING' as const, contactId: contactIds ? { in: contactIds } : { not: null } };
  const select = { contactId: true, amount: true, interestFine: true, discount: true, settledAmount: true, dueDate: true } as const;
  const [receivables, payables] = await Promise.all([
    prisma.receivable.findMany({ where, select }),
    prisma.payable.findMany({ where, select }),
  ]);
  const today = startOfTodayUtc();
  const result = new Map<string, { open: Prisma.Decimal; overdue: Prisma.Decimal }>();
  for (const e of [...receivables, ...payables]) {
    if (!e.contactId) continue;
    const open = openAmount(e);
    const entry = result.get(e.contactId) ?? { open: new Prisma.Decimal(0), overdue: new Prisma.Decimal(0) };
    entry.open = entry.open.plus(open);
    if (e.dueDate < today) entry.overdue = entry.overdue.plus(open);
    result.set(e.contactId, entry);
  }
  return result;
}

async function findOwned(companyId: string, id: string) {
  const contact = await prisma.contact.findFirst({ where: { id, companyId } });
  if (!contact) throw notFound('Contato');
  return contact;
}

/** Lista com saldos. ?archived=true inclui os arquivados */
contactsRouter.get('/', async (req, res) => {
  const { type, search, archived } = z
    .object({
      type: contactTypes.optional(),
      search: z.string().optional(),
      archived: z.enum(['true', 'false']).optional(),
    })
    .parse(req.query);
  const companyId = companyIdOf(req);
  const digits = search ? onlyDigits(search) : '';

  const contacts = await prisma.contact.findMany({
    where: {
      companyId,
      type,
      ...(archived !== 'true' && { isActive: true }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { tradeName: { contains: search, mode: 'insensitive' } },
          ...(digits ? [{ document: { contains: digits } }] : []),
        ],
      }),
    },
    orderBy: { name: 'asc' },
  });

  const balances = await openBalances(companyId, contacts.map((c) => c.id));
  res.json(
    contacts.map((c) => ({
      ...c,
      openAmount: balances.get(c.id)?.open ?? new Prisma.Decimal(0),
      overdueAmount: balances.get(c.id)?.overdue ?? new Prisma.Decimal(0),
    })),
  );
});

/** Detalhe: dados, saldos, movimentado em 12 meses, próximas contas, últimas movimentações e anotações */
contactsRouter.get('/:id', async (req, res) => {
  const companyId = companyIdOf(req);
  const contact = await findOwned(companyId, idParam(req));
  const since = new Date(Date.now() - 365 * 86_400_000);
  const pending = { companyId, contactId: contact.id, status: 'PENDING' as const };

  const [balances, moved, receivables, payables, recentTransactions, annotations] = await Promise.all([
    openBalances(companyId, [contact.id]),
    prisma.transaction.aggregate({
      where: { companyId, contactId: contact.id, date: { gte: since }, reconciliationStatus: { not: 'IGNORED' } },
      _sum: { amount: true },
    }),
    prisma.receivable.findMany({ where: pending, orderBy: { dueDate: 'asc' }, take: 10 }),
    prisma.payable.findMany({ where: pending, orderBy: { dueDate: 'asc' }, take: 10 }),
    prisma.transaction.findMany({
      where: { companyId, contactId: contact.id, reconciliationStatus: { not: 'IGNORED' } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 10,
      select: {
        id: true,
        date: true,
        description: true,
        customDescription: true,
        checknum: true,
        type: true,
        amount: true,
        reconciliationStatus: true,
        bankAccount: { select: { name: true } },
      },
    }),
    prisma.contactNote.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    }),
  ]);

  const upcoming = [
    ...receivables.map((r) => ({ id: r.id, kind: 'RECEIVABLE' as const, description: displayDescription(r), documentNumber: r.documentNumber, dueDate: r.dueDate, amount: openAmount(r) })),
    ...payables.map((p) => ({ id: p.id, kind: 'PAYABLE' as const, description: displayDescription(p), documentNumber: p.documentNumber, dueDate: p.dueDate, amount: openAmount(p) })),
  ]
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .slice(0, 10);

  res.json({
    ...contact,
    openAmount: balances.get(contact.id)?.open ?? new Prisma.Decimal(0),
    overdueAmount: balances.get(contact.id)?.overdue ?? new Prisma.Decimal(0),
    moved12m: moved._sum.amount ?? new Prisma.Decimal(0),
    upcoming,
    recentTransactions,
    annotations,
  });
});

contactsRouter.post('/', async (req, res) => {
  const companyId = companyIdOf(req);
  const data = contactSchema.parse(req.body);
  data.document = normalizeDocument(data.personType, data.document);
  await assertUniqueDocument(companyId, data.type, data.document);
  const { bankDetails, ...rest } = data;
  const contact = await prisma.contact.create({
    data: { ...rest, companyId, bankDetails: bankDetails ?? Prisma.JsonNull },
  });
  res.status(201).json(contact);
});

contactsRouter.patch('/:id', async (req, res) => {
  const companyId = companyIdOf(req);
  const current = await findOwned(companyId, idParam(req));
  const data = contactSchema.partial().parse(req.body);
  const personType = data.personType ?? current.personType;
  if (data.document !== undefined) data.document = normalizeDocument(personType, data.document);
  await assertUniqueDocument(companyId, data.type ?? current.type, data.document === undefined ? current.document : data.document, current.id);
  const { bankDetails, ...rest } = data;
  res.json(
    await prisma.contact.update({
      where: { id: current.id },
      data: { ...rest, ...(bankDetails !== undefined && { bankDetails: bankDetails ?? Prisma.JsonNull }) },
    }),
  );
});

/** Arquiva (contatos podem ter histórico financeiro; nunca são apagados) */
contactsRouter.delete('/:id', async (req, res) => {
  const contact = await findOwned(companyIdOf(req), idParam(req));
  res.json(await prisma.contact.update({ where: { id: contact.id }, data: { isActive: false } }));
});

// ----------------------------------------------------------------------------
// Anotações
// ----------------------------------------------------------------------------

contactsRouter.post('/:id/notes', currentUser, async (req, res) => {
  const companyId = companyIdOf(req);
  const contact = await findOwned(companyId, idParam(req));
  const { text } = z.object({ text: z.string().trim().min(1, 'Escreva a anotação').max(5000) }).parse(req.body);
  const note = await prisma.contactNote.create({
    data: { companyId, contactId: contact.id, authorId: userIdOf(res), text },
    include: { author: { select: { id: true, name: true } } },
  });
  res.status(201).json(note);
});

contactsRouter.delete('/:id/notes/:noteId', async (req, res) => {
  const contact = await findOwned(companyIdOf(req), idParam(req));
  const { count } = await prisma.contactNote.deleteMany({ where: { id: idParam(req, 'noteId'), contactId: contact.id } });
  if (!count) throw notFound('Anotação');
  res.status(204).end();
});
