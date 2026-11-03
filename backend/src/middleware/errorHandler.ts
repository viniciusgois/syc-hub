import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { HttpError } from '../lib/http.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    // Validações próprias (superRefine) têm mensagem em português; as demais viram "Dados inválidos"
    const custom = err.issues.filter((i) => i.code === 'custom');
    res.status(400).json({ error: custom.map((i) => i.message).join('; ') || 'Dados inválidos', details: err.issues });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Registro duplicado', details: err.meta });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Registro não encontrado' });
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json({ error: 'Referência inválida (chave estrangeira)', details: err.meta });
      return;
    }
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor' });
};
