import type { RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';
import { SESSION_COOKIE, readCookie, tokenHash } from '../services/auth.js';

/** Token da sessão: cookie httpOnly (navegador) ou `Authorization: Bearer` (scripts/integrações) */
export const sessionToken = (req: Parameters<RequestHandler>[0]) => {
  const auth = req.header('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return readCookie(req.header('cookie'), SESSION_COOKIE);
};

/** Exige uma sessão válida; deixa o usuário em res.locals.userId / res.locals.user */
export const authenticate: RequestHandler = async (req, res, next) => {
  if (res.locals.userId) return next(); // já autenticado por um middleware anterior na mesma requisição
  const token = sessionToken(req);
  if (!token) throw new HttpError(401, 'Faça login para continuar');
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) throw new HttpError(401, 'Sua sessão expirou. Faça login novamente');

  // Marca o uso no máximo a cada 5 minutos (evita uma escrita por requisição)
  if (Date.now() - session.lastUsedAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  res.locals.userId = session.user.id;
  res.locals.user = session.user;
  res.locals.sessionId = session.id;
  next();
};
