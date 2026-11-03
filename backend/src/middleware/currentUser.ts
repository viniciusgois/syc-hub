import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http.js';

/**
 * Garante que a rota roda depois de `authenticate` + `requireCompany` (usuário logado e membro da empresa).
 * Mantido nas rotas que registram quem fez a ação (conciliação, baixas, importações).
 */
export const currentUser: RequestHandler = (_req, res, next) => {
  if (!res.locals.userId || !res.locals.role) throw new HttpError(401, 'Faça login para continuar');
  next();
};

export const userIdOf = (res: { locals: Record<string, unknown> }) => res.locals.userId as string;
