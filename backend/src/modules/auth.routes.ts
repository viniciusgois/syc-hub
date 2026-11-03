import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { authenticate, sessionToken } from '../middleware/authenticate.js';
import { assertStrongPassword, createSession, hashPassword, sessionCookie, tokenHash, verifyPassword } from '../services/auth.js';

export const authRouter = Router();

const email = z.email('E-mail inválido').transform((e) => e.trim().toLowerCase());

// Limite de tentativas de login por e-mail + IP (memória do processo; suficiente para uma instância)
const ATTEMPTS = 10;
const WINDOW_MS = 15 * 60_000;
const attempts = new Map<string, { count: number; first: number }>();
function checkRate(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && now - a.first < WINDOW_MS && a.count >= ATTEMPTS) {
    throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo');
  }
}
function registerFailure(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  attempts.set(key, a && now - a.first < WINDOW_MS ? { ...a, count: a.count + 1 } : { count: 1, first: now });
}

const publicUser = (u: { id: string; name: string; email: string }) => ({ id: u.id, name: u.name, email: u.email });

/** Verifica se o sistema precisa da configuração inicial (0 usuários no banco) */
authRouter.get('/setup-status', async (_req, res) => {
  const count = await prisma.user.count();
  res.json({ needsSetup: count === 0 });
});

/** Cadastro do primeiro administrador (só funciona enquanto houver 0 usuários) */
authRouter.post('/setup', async (req, res) => {
  const count = await prisma.user.count();
  if (count > 0) {
    throw new HttpError(403, 'A configuração inicial já foi realizada. Faça login.');
  }
  const body = z
    .object({
      name: z.string().trim().min(2, 'Informe o nome'),
      email,
      password: z.string().min(8, 'A senha deve ter no mínimo 8 caracteres'),
    })
    .parse(req.body);

  assertStrongPassword(body.password);
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      passwordHash: await hashPassword(body.password),
    },
  });

  const token = await createSession(user.id, req.header('user-agent'));
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ user: publicUser(user), token });
});

/** Login com e-mail e senha: grava o cookie da sessão e devolve o token (para clientes sem cookie) */
authRouter.post('/login', async (req, res) => {
  const body = z.object({ email, password: z.string().min(1, 'Informe a senha') }).parse(req.body);
  const key = `${body.email}|${req.ip}`;
  checkRate(key);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !user.isActive || !(await verifyPassword(body.password, user.passwordHash))) {
    registerFailure(key);
    throw new HttpError(401, 'E-mail ou senha incorretos');
  }
  attempts.delete(key);
  const token = await createSession(user.id, req.header('user-agent'));
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ user: publicUser(user), token });
});

authRouter.post('/logout', async (req, res) => {
  const token = sessionToken(req);
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  res.setHeader('Set-Cookie', sessionCookie(null));
  res.status(204).end();
});

authRouter.get('/me', authenticate, (_req, res) => {
  res.json({ user: publicUser(res.locals.user) });
});

authRouter.patch('/me', authenticate, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2, 'Informe o nome').max(120) }).parse(req.body);
  res.json({ user: publicUser(await prisma.user.update({ where: { id: res.locals.userId }, data: { name } })) });
});

/** Troca de senha: confere a atual e encerra as outras sessões */
authRouter.post('/me/password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string() }).parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: res.locals.userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new HttpError(400, 'Senha atual incorreta', { fields: ['currentPassword'] });
  assertStrongPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.session.deleteMany({ where: { userId: user.id, id: { not: res.locals.sessionId } } }),
  ]);
  res.status(204).end();
});

async function findValidToken(token: string) {
  const record = await prisma.userToken.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } });
  if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
    throw new HttpError(410, 'Este link não é mais válido. Peça um novo ao administrador da empresa');
  }
  return record;
}

/** Dados do link de convite/redefinição (para a tela de definir senha) */
authRouter.get('/access/:token', async (req, res) => {
  const record = await findValidToken(req.params.token);
  res.json({ type: record.type, user: { name: record.user.name, email: record.user.email }, expiresAt: record.expiresAt });
});

/** Define a senha pelo link (uso único) e já entra no sistema */
authRouter.post('/access/:token', async (req, res) => {
  const record = await findValidToken(req.params.token);
  const { password, name } = z.object({ password: z.string(), name: z.string().trim().min(2).max(120).optional() }).parse(req.body);
  assertStrongPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password), ...(name && { name }) } }),
    prisma.userToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Nova senha encerra as sessões antigas (ex.: alguém usando a senha esquecida)
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);
  const token = await createSession(record.userId, req.header('user-agent'));
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ user: publicUser(record.user), token });
});
