import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError, notFound } from '../lib/http.js';
import { atLeast } from '../services/auth.js';

/**
 * Rotas escopadas: a empresa precisa existir e o usuário logado precisa ser membro dela.
 * O papel fica em res.locals.role para as checagens de permissão.
 */
export const requireCompany: RequestHandler = async (req, res, next) => {
  const companyId = req.params.companyId as string;
  const membership = await prisma.companyUser.findUnique({
    where: { userId_companyId: { userId: res.locals.userId as string, companyId } },
    select: { role: true },
  });
  if (!membership) {
    // Mesma resposta para "não existe" e "sem acesso" quando o usuário não participa (não revela empresas alheias)
    throw notFound('Empresa');
  }
  res.locals.role = membership.role;
  next();
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Leitura liberada a todos os membros; escrita exige o papel mínimo */
export const writeRequires =
  (min: UserRole): RequestHandler =>
  (req, res, next) => {
    if (!READ_METHODS.has(req.method) && !atLeast(res.locals.role as UserRole, min)) {
      throw new HttpError(403, 'Seu papel nesta empresa não permite esta ação');
    }
    next();
  };
