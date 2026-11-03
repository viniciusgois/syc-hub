import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { HttpError } from '../lib/http.js';

/** Exige um dos papéis informados (usar depois de `currentUser`) */
export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (_req, res, next) => {
    if (!roles.includes(res.locals.role as UserRole)) throw new HttpError(403, 'Seu papel nesta empresa não permite esta ação');
    next();
  };
