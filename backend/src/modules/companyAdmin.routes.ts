import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError, companyIdOf, idParam, notFound } from '../lib/http.js';
import { onlyDigits } from '../lib/documents.js';
import { currentUser } from '../middleware/currentUser.js';
import { requireRole } from '../middleware/requireRole.js';
import { recalculateBalance } from '../services/balance.js';
import { assertCanManageCredentials, issueUserToken } from '../services/auth.js';

/** Administração da empresa: usuários, limpar dados e excluir */
export const companyAdminRouter = Router({ mergeParams: true });

const roles = z.enum(['OWNER', 'ADMIN', 'FINANCIAL_OPERATOR', 'CONSULTANT', 'VIEWER']);
const admins = requireRole('OWNER', 'ADMIN');

companyAdminRouter.get('/users', async (req, res) => {
  const members = await prisma.companyUser.findMany({
    where: { companyId: companyIdOf(req) },
    include: { user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, passwordHash: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json(
    members.map(({ user: { passwordHash, ...user }, ...m }) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt,
      user,
      // Sem senha definida = ainda não aceitou o convite
      pendingInvite: !passwordHash,
    })),
  );
});

/** Adiciona um usuário (por e-mail) à empresa; cria o cadastro se ainda não existir */
companyAdminRouter.post('/users', currentUser, admins, async (req, res) => {
  const companyId = companyIdOf(req);
  const { name, email, role } = z
    .object({ name: z.string().trim().min(2, 'Informe o nome'), email: z.email('E-mail inválido').transform((e) => e.toLowerCase()), role: roles })
    .parse(req.body);
  if (role === 'OWNER' && res.locals.role !== 'OWNER') throw new HttpError(403, 'Só o proprietário pode adicionar outro proprietário');

  const member = await prisma.$transaction(async (db) => {
    const user = await db.user.upsert({ where: { email }, update: {}, create: { email, name } });
    const exists = await db.companyUser.findUnique({ where: { userId_companyId: { userId: user.id, companyId } } });
    if (exists) throw new HttpError(409, 'Este usuário já tem acesso à empresa');
    return db.companyUser.create({ data: { userId: user.id, companyId, role }, include: { user: { select: { id: true, name: true, email: true, passwordHash: true } } } });
  });
  const { passwordHash, ...user } = member.user;
  // Quem ainda não tem senha recebe um link de convite (o administrador copia e envia; não há envio de e-mail)
  let invite = null;
  if (!passwordHash) {
    try {
      await assertCanManageCredentials(res.locals.userId, user.id);
      invite = await issueUserToken(user.id, 'INVITE', res.locals.userId);
    } catch (err) {
      if (!(err instanceof HttpError)) throw err; // já convidado por outra empresa: ele usa aquele convite
    }
  }
  res.status(201).json({ ...member, user, pendingInvite: !passwordHash, invite });
});

/**
 * Gera o link de acesso do usuário: convite (ainda sem senha) ou redefinição de senha.
 * Só para quem administra todas as empresas dele (ver assertCanManageCredentials).
 */
companyAdminRouter.post('/users/:memberId/access-link', currentUser, admins, async (req, res) => {
  const member = await findMember(companyIdOf(req), idParam(req, 'memberId'));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: member.userId } });
  if (!user.isActive) throw new HttpError(400, 'Usuário desativado');
  await assertCanManageCredentials(res.locals.userId, user.id);
  res.json(await issueUserToken(user.id, user.passwordHash ? 'PASSWORD_RESET' : 'INVITE', res.locals.userId));
});

async function findMember(companyId: string, id: string) {
  const member = await prisma.companyUser.findFirst({ where: { id, companyId } });
  if (!member) throw notFound('Usuário');
  return member;
}

/** Garante que a empresa continua com ao menos um proprietário */
async function assertKeepsOwner(companyId: string, memberId: string) {
  const owners = await prisma.companyUser.count({ where: { companyId, role: 'OWNER', id: { not: memberId } } });
  if (!owners) throw new HttpError(400, 'A empresa precisa de ao menos um proprietário');
}

companyAdminRouter.patch('/users/:memberId', currentUser, admins, async (req, res) => {
  const companyId = companyIdOf(req);
  const member = await findMember(companyId, idParam(req, 'memberId'));
  const { role } = z.object({ role: roles }).parse(req.body);
  if ((role === 'OWNER' || member.role === 'OWNER') && res.locals.role !== 'OWNER') throw new HttpError(403, 'Só o proprietário pode alterar proprietários');
  if (member.role === 'OWNER' && role !== 'OWNER') await assertKeepsOwner(companyId, member.id);
  res.json(await prisma.companyUser.update({ where: { id: member.id }, data: { role } }));
});

companyAdminRouter.delete('/users/:memberId', currentUser, admins, async (req, res) => {
  const companyId = companyIdOf(req);
  const member = await findMember(companyId, idParam(req, 'memberId'));
  if (member.role === 'OWNER') {
    if (res.locals.role !== 'OWNER') throw new HttpError(403, 'Só o proprietário pode remover proprietários');
    await assertKeepsOwner(companyId, member.id);
  }
  await prisma.companyUser.delete({ where: { id: member.id } });
  res.status(204).end();
});

/** Confirmação digitando o CNPJ/CPF da empresa */
async function assertConfirmation(companyId: string, confirm: unknown) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { cnpj: true } });
  if (typeof confirm !== 'string' || onlyDigits(confirm) !== company.cnpj) {
    throw new HttpError(400, 'Digite o CNPJ/CPF da empresa para confirmar', { fields: ['confirm'] });
  }
}

/**
 * Limpar dados: apaga lançamentos do extrato, importações, contas a pagar/receber e recorrências.
 * Mantém empresa, contas bancárias (saldo volta ao inicial), plano de contas, contatos, centros de custo e regras.
 */
companyAdminRouter.post('/clear-data', currentUser, admins, async (req, res) => {
  const companyId = companyIdOf(req);
  await assertConfirmation(companyId, req.body?.confirm);
  const result = await prisma.$transaction(async (db) => {
    const transactions = await db.transaction.deleteMany({ where: { companyId } });
    const imports = await db.importBatch.deleteMany({ where: { companyId } });
    const receivables = await db.receivable.deleteMany({ where: { companyId } });
    const payables = await db.payable.deleteMany({ where: { companyId } });
    await db.recurrence.deleteMany({ where: { companyId } });
    for (const a of await db.bankAccount.findMany({ where: { companyId }, select: { id: true } })) await recalculateBalance(db, a.id);
    return { transactions: transactions.count, imports: imports.count, receivables: receivables.count, payables: payables.count };
  });
  res.json(result);
});

/** Excluir a empresa e todos os seus dados (somente proprietário) */
companyAdminRouter.delete('/', currentUser, requireRole('OWNER'), async (req, res) => {
  const companyId = companyIdOf(req);
  await assertConfirmation(companyId, req.body?.confirm);
  await prisma.company.delete({ where: { id: companyId } });
  res.status(204).end();
});
