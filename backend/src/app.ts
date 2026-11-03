import express, { Router } from 'express';
import cors from 'cors';
import { Prisma } from '@prisma/client';
import { errorHandler } from './middleware/errorHandler.js';
import { requireCompany, writeRequires } from './middleware/requireCompany.js';
import { authenticate } from './middleware/authenticate.js';
import { authRouter } from './modules/auth.routes.js';
import { companiesRouter } from './modules/companies.routes.js';
import { bankAccountsRouter } from './modules/bankAccounts.routes.js';
import { categoriesRouter } from './modules/categories.routes.js';
import { contactsRouter } from './modules/contacts.routes.js';
import { costCentersRouter } from './modules/costCenters.routes.js';
import { transactionsRouter } from './modules/transactions.routes.js';
import { importsRouter } from './modules/imports.routes.js';
import { rulesRouter } from './modules/rules.routes.js';
import { reportsRouter } from './modules/reports.routes.js';
import { lookupRouter } from './modules/lookup.routes.js';
import { entriesRouter } from './modules/entries.routes.js';
import { recurrencesRouter } from './modules/recurrences.routes.js';
import { companyAdminRouter } from './modules/companyAdmin.routes.js';
import { niboImportsRouter } from './modules/niboImports.routes.js';

export function createApp() {
  const app = express();

  // Cookie de sessão entre o front (5173) e a API: origens explícitas + credentials
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true }));
  app.use(express.json({ limit: '10mb' }));

  // Decimal do Prisma serializa como string; a API expõe valores monetários como number
  app.set('json replacer', function (this: Record<string, unknown>, key: string, value: unknown) {
    const raw = this[key];
    return raw instanceof Prisma.Decimal ? raw.toNumber() : value;
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Permissões por papel: leitura para todos os membros; escrita conforme a área
  // (operador: lançamentos, extrato, contatos e regras; administrador: estrutura e configurações)
  const scoped = Router({ mergeParams: true });
  scoped.use(requireCompany);
  scoped.use('/bank-accounts', writeRequires('ADMIN'), bankAccountsRouter);
  scoped.use('/categories', writeRequires('ADMIN'), categoriesRouter);
  scoped.use('/cost-centers', writeRequires('ADMIN'), costCentersRouter);
  scoped.use('/contacts', writeRequires('FINANCIAL_OPERATOR'), contactsRouter);
  scoped.use('/transactions', writeRequires('FINANCIAL_OPERATOR'), transactionsRouter);
  scoped.use('/imports', writeRequires('FINANCIAL_OPERATOR'), importsRouter);
  scoped.use('/rules', writeRequires('FINANCIAL_OPERATOR'), rulesRouter);
  scoped.use('/reports', reportsRouter);
  scoped.use('/receivables', writeRequires('FINANCIAL_OPERATOR'), entriesRouter('RECEIVABLE'));
  scoped.use('/payables', writeRequires('FINANCIAL_OPERATOR'), entriesRouter('PAYABLE'));
  scoped.use('/recurrences', writeRequires('FINANCIAL_OPERATOR'), recurrencesRouter);
  scoped.use('/nibo-imports', writeRequires('ADMIN'), niboImportsRouter); // migração cria contas e categorias
  scoped.use('/', writeRequires('ADMIN'), companyAdminRouter); // usuários, limpar dados; excluir exige proprietário

  app.use('/api/auth', authRouter);
  app.use('/api/lookup', authenticate, lookupRouter);
  app.use('/api/companies', authenticate, companiesRouter);
  app.use('/api/companies/:companyId', authenticate, scoped);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
  });
  app.use(errorHandler);

  return app;
}
