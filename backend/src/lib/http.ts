import type { Request } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (entity: string) => new HttpError(404, `${entity} não encontrado(a)`);

/** companyId resolvido pelo middleware requireCompany */
export function companyIdOf(req: Request): string {
  return req.params.companyId as string;
}

export const idParam = (req: Request, name = 'id') => req.params[name] as string;

// Converte query strings em números/datas/booleans
export const queryDate = z.coerce.date();
export const queryBool = z.enum(['true', 'false']).transform((v) => v === 'true');
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
