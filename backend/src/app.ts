import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import cors from 'cors';
import { Prisma } from '@prisma/client';
import { errorHandler } from './middleware/errorHandler.js';
import { HttpError } from './lib/http.js';
import { APP_COMMIT, checkDatabase } from './lib/health.js';
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
  const serveFrontend = process.env.SERVE_FRONTEND === 'true';

  // Atrás do proxy (Traefik na VPS): req.ip passa a ser o IP de quem acessa (usado no limite de login)
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  // Front e API em domínios diferentes (Vercel + Render, ou o Vite em desenvolvimento): CORS com credentials.
  // Num serviço só (SERVE_FRONTEND=true), tudo fica no mesmo domínio e o CORS só liga se CORS_ORIGIN for definida.
  if (!serveFrontend || process.env.CORS_ORIGIN) {
    app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true }));
  }
  app.use(express.json({ limit: '10mb' }));

  // Decimal do Prisma serializa como string; a API expõe valores monetários como number
  app.set('json replacer', function (this: Record<string, unknown>, key: string, value: unknown) {
    const raw = this[key];
    return raw instanceof Prisma.Decimal ? raw.toNumber() : value;
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Saúde para o Dokploy/Swarm (troca de versão sem queda e volta automática) e para a Action "Conferir deploy".
  // Fica antes de tudo (sem login, sem limite); 503 quando o banco não responde.
  app.get('/api/health', async (_req, res) => {
    const database = await checkDatabase();
    res.status(database ? 200 : 503).json({
      status: database ? 'ok' : 'erro',
      service: 'syc-hub',
      database: database ? 'ok' : 'sem resposta',
      commit: APP_COMMIT,
      timestamp: new Date().toISOString(),
    });
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

  // Produção num serviço só: a API também entrega as telas compiladas (frontend/dist)
  if (serveFrontend) {
    const dist = path.resolve(process.env.FRONTEND_DIST ?? path.join(process.cwd(), '..', 'frontend', 'dist'));
    if (!fs.existsSync(path.join(dist, 'index.html'))) {
      throw new Error(`SERVE_FRONTEND=true, mas não encontrei ${dist}/index.html. Rode o build do frontend.`);
    }
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // Qualquer rota que não seja da API abre o app (inclusive /?acesso=... dos links de convite e de senha)
    app.get(/^\/(?!api\/|api$).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'Rota não encontrada')));
  app.use(errorHandler);

  return app;
}
