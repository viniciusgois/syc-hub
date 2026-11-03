import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';

type Refs = {
  bankAccountId?: string | null;
  categoryId?: string | null;
  contactId?: string | null;
  costCenterId?: string | null;
};

/**
 * Isolamento multi-tenant: garante que todas as referências informadas pertencem à mesma empresa.
 */
export async function assertRefsBelongToCompany(companyId: string, refs: Refs) {
  const checks: [string, string | null | undefined, (id: string) => Promise<unknown>][] = [
    ['bankAccountId', refs.bankAccountId, (id) => prisma.bankAccount.findFirst({ where: { id, companyId }, select: { id: true } })],
    ['categoryId', refs.categoryId, (id) => prisma.category.findFirst({ where: { id, companyId }, select: { id: true } })],
    ['contactId', refs.contactId, (id) => prisma.contact.findFirst({ where: { id, companyId }, select: { id: true } })],
    ['costCenterId', refs.costCenterId, (id) => prisma.costCenter.findFirst({ where: { id, companyId }, select: { id: true } })],
  ];

  const invalid: string[] = [];
  await Promise.all(
    checks.map(async ([field, id, find]) => {
      if (id && !(await find(id))) invalid.push(field);
    }),
  );
  if (invalid.length) throw new HttpError(400, 'Referências não pertencem à empresa', { fields: invalid });
}
