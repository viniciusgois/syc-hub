/**
 * Seed de desenvolvimento: reproduz as empresas/contas do mock do frontend.
 * Idempotente: empresas já existentes (mesmo CNPJ) são ignoradas.
 */
import 'dotenv/config';
import { Prisma, type AccountType, type ContactType, type RuleMatchType } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { defaultCategoriesFor } from '../src/services/defaultChartOfAccounts.js';
import { occurrenceDate, occurrenceRow, settleEntry, totalDue } from '../src/services/entries.js';
import { recalculateBalance } from '../src/services/balance.js';
import { hashPassword } from '../src/services/auth.js';
import { importStatement } from '../src/services/importStatement.js';
import { parseOFX, sha256 } from '../src/services/ofx.js';
import { onlyDigits } from '../src/lib/documents.js';

// Mesmo cliente dos serviços do backend (importStatement etc.), para encerrar uma única conexão

// ID fixo para usar no header x-user-id durante o desenvolvimento
export const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEV_PASSWORD = 'sychub123';

type SeedAccount = {
  name: string; type: AccountType; bankCode: string; bankName: string;
  agency: string; accountNumber: string; initialBalance: number; color: string;
};

const COMPANIES: {
  legalName: string; tradeName: string; cnpj: string;
  taxRegime: 'SIMPLES_NACIONAL' | 'LUCRO_PRESUMIDO'; city: string; state: string; segment: string;
  accounts: SeedAccount[];
}[] = [
  {
    legalName: 'Save Your Company Hub Gestão Financeira Ltda', tradeName: 'SYC Hub (Matriz BPO)', cnpj: '45182903000179',
    taxRegime: 'LUCRO_PRESUMIDO', city: 'São Paulo', state: 'SP', segment: 'Serviços',
    accounts: [
      { name: 'Itaú Empresas - Principal', type: 'CHECKING', bankCode: '341', bankName: 'Banco Itaú S.A.', agency: '0842', accountNumber: '49281-5', initialBalance: 125000, color: '#ea580c' },
      { name: 'Banco Inter - Operações Pix', type: 'CHECKING', bankCode: '077', bankName: 'Banco Inter S.A.', agency: '0001', accountNumber: '839210-9', initialBalance: 20000, color: '#f97316' },
      { name: 'XP Investimentos - Reserva', type: 'INVESTMENT', bankCode: '102', bankName: 'XP Investimentos', agency: '0001', accountNumber: '110294-0', initialBalance: 300000, color: '#eab308' },
    ],
  },
  {
    legalName: 'TechVenture Inovações Digitais S.A.', tradeName: 'TechVenture Software', cnpj: '33912441000119',
    taxRegime: 'SIMPLES_NACIONAL', city: 'Florianópolis', state: 'SC', segment: 'Tecnologia',
    accounts: [
      { name: 'Bradesco Prime - Recebimentos', type: 'CHECKING', bankCode: '237', bankName: 'Banco Bradesco S.A.', agency: '1420', accountNumber: '18492-3', initialBalance: 45000, color: '#dc2626' },
      { name: 'Nubank PJ', type: 'CHECKING', bankCode: '260', bankName: 'Nu Pagamentos S.A.', agency: '0001', accountNumber: '746192-1', initialBalance: 15000, color: '#8b5cf6' },
    ],
  },
  {
    legalName: 'Restaurante e Bistrô Vila Nobre Ltda', tradeName: 'Bistrô Vila Nobre', cnpj: '18742665000136',
    taxRegime: 'SIMPLES_NACIONAL', city: 'Rio de Janeiro', state: 'RJ', segment: 'Alimentação',
    accounts: [
      { name: 'Santander - Vendas Cartão', type: 'CHECKING', bankCode: '033', bankName: 'Banco Santander Brasil', agency: '2105', accountNumber: '1300921-8', initialBalance: 12000, color: '#ef4444' },
      { name: 'Caixa Gaveta (Espécie)', type: 'CASH', bankCode: '999', bankName: 'Caixa Local', agency: '0000', accountNumber: '00000-0', initialBalance: 2500, color: '#10b981' },
    ],
  },
];

const CONTACTS: { name: string; type: ContactType; document: string }[] = [
  { name: 'Amazon Web Services Brasil Ltda', type: 'SUPPLIER', document: '23.412.901/0001-44' },
  { name: 'Google Brasil Internet Ltda', type: 'SUPPLIER', document: '06.990.590/0001-23' },
  { name: 'Banco Itaú Unibanco S.A.', type: 'SUPPLIER', document: '60.701.190/0001-04' },
  { name: 'Alpha Participações & Negócios S.A.', type: 'CUSTOMER', document: '14.921.492/0001-11' },
  { name: 'Delta Logística e Distribuição Ltda', type: 'CUSTOMER', document: '08.192.381/0001-90' },
  { name: 'Carlos Eduardo Silveira (Sócio)', type: 'PARTNER', document: '291.821.940-02' },
  { name: 'Mariana Fontes (Sócia)', type: 'PARTNER', document: '192.481.902-15' },
];

// Equivalente às sugestões fixas do ofxParser do frontend, agora como regras editáveis
const RULES: { name: string; matchType: RuleMatchType; pattern: string; category: string; contact?: string }[] = [
  { name: 'Infraestrutura Cloud', matchType: 'REGEX', pattern: 'AWS|AMAZON|CLOUD', category: 'Sistemas e softwares', contact: 'Amazon Web Services Brasil Ltda' },
  { name: 'Marketing & Anúncios', matchType: 'REGEX', pattern: 'GOOGLE|\\bADS\\b|FACEBOOK|META', category: 'Marketing e publicidade', contact: 'Google Brasil Internet Ltda' },
  { name: 'Despesas Bancárias', matchType: 'REGEX', pattern: '\\bTAR\\b|TARIFA|PACOTE MENSAL|IOF', category: 'Tarifas bancárias', contact: 'Banco Itaú Unibanco S.A.' },
  { name: 'Pró-Labore Sócios', matchType: 'REGEX', pattern: 'PRO[- ]?LABORE', category: 'Pró-labore' },
  { name: 'Despesas Imobiliárias', matchType: 'REGEX', pattern: 'ALUGUEL|CONDOMINIO', category: 'Aluguel e condomínio' },
  { name: 'Receita de Consultoria', matchType: 'REGEX', pattern: 'CLIENTE|CONTRATO|HONORARIOS', category: 'Receita com serviços' },
];

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'dev@sychub.com.br' },
    update: {},
    create: { id: DEV_USER_ID, email: 'dev@sychub.com.br', name: 'Usuário Dev' },
  });
  // Senha do ambiente de desenvolvimento (só é definida se o usuário ainda não tem uma)
  if (!user.passwordHash) await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(DEV_PASSWORD) } });

  for (const [index, { accounts, ...companyData }] of COMPANIES.entries()) {
    if (await prisma.company.findUnique({ where: { cnpj: companyData.cnpj } })) {
      console.log(`↷ ${companyData.tradeName} já existe`);
      continue;
    }

    await prisma.$transaction(async (db) => {
      const company = await db.company.create({ data: companyData });
      await db.companyUser.create({ data: { userId: user.id, companyId: company.id, role: 'OWNER', isDefault: index === 0 } });
      await db.category.createMany({ data: defaultCategoriesFor(company.id) });
      await db.bankAccount.createMany({
        data: accounts.map((a, i) => ({
          ...a,
          companyId: company.id,
          currentBalance: a.initialBalance,
          initialBalanceDate: new Date(Date.UTC(2026, 0, 1)),
          isDefault: i === 0,
        })),
      });
      await db.contact.createMany({
        data: CONTACTS.map((c) => {
          const document = onlyDigits(c.document);
          return { ...c, document, personType: document.length === 11 ? ('NATURAL' as const) : ('LEGAL' as const), companyId: company.id };
        }),
      });

      const categories = await db.category.findMany({ where: { companyId: company.id }, select: { id: true, name: true } });
      const contacts = await db.contact.findMany({ where: { companyId: company.id }, select: { id: true, name: true } });
      await db.reconciliationRule.createMany({
        data: RULES.map((r, i) => ({
          companyId: company.id,
          name: r.name,
          matchType: r.matchType,
          pattern: r.pattern,
          targetCategoryId: categories.find((c) => c.name === r.category)!.id,
          targetContactId: contacts.find((c) => c.name === r.contact)?.id,
          priority: RULES.length - i,
        })),
      });
      console.log(`✓ ${company.tradeName} (${company.id})`);
    });
  }

  // Dados de demonstração (datas relativas a hoje) na empresa padrão, se ela ainda não tem lançamentos
  const demo = await prisma.company.findUnique({ where: { cnpj: COMPANIES[0].cnpj } });
  if (demo) {
    await seedDemoData(demo.id, user.id);
    await seedHistory(demo.id, user.id);
  }

  console.log(`\nLogin de desenvolvimento: dev@sychub.com.br / ${DEV_PASSWORD}`);
}

// ----------------------------------------------------------------------------
// Demonstração: contas a pagar/receber + extrato com uma linha que casa com um recebimento
// ----------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
const daysFromToday = (n: number) => new Date(today().getTime() + n * DAY_MS);
const ofxDate = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

async function seedDemoData(companyId: string, userId: string) {
  const existing = (await prisma.receivable.count({ where: { companyId } })) + (await prisma.payable.count({ where: { companyId } }));
  if (existing) {
    console.log('↷ Dados de demonstração já existem (empresa já tem lançamentos)');
    return;
  }
  const categories = await prisma.category.findMany({ where: { companyId }, select: { id: true, name: true } });
  const contacts = await prisma.contact.findMany({ where: { companyId }, select: { id: true, name: true } });
  const cat = (name: string) => categories.find((c) => c.name === name)!.id;
  const contact = (prefix: string) => contacts.find((c) => c.name.startsWith(prefix))?.id ?? null;

  const receivable = (data: { description: string; due: number; amount: number; category: string; contact?: string; doc?: string }) =>
    prisma.receivable.create({
      data: {
        companyId,
        description: data.description,
        dueDate: daysFromToday(data.due),
        issueDate: daysFromToday(data.due),
        amount: data.amount,
        categoryId: cat(data.category),
        contactId: data.contact ? contact(data.contact) : null,
        documentNumber: data.doc ?? null,
      },
    });
  const payable = (data: { description: string; due: number; amount: number; category: string; contact?: string }) =>
    prisma.payable.create({
      data: {
        companyId,
        description: data.description,
        dueDate: daysFromToday(data.due),
        issueDate: daysFromToday(data.due),
        amount: data.amount,
        categoryId: cat(data.category),
        contactId: data.contact ? contact(data.contact) : null,
      },
    });

  await receivable({ description: 'Consultoria mensal', due: -2, amount: 4500, category: 'Receita com serviços', contact: 'Alpha', doc: 'NF 2031' });
  await receivable({ description: 'Mensalidade suporte', due: -12, amount: 1200, category: 'Receita com serviços', contact: 'Delta' });
  await payable({ description: 'Honorários contábeis', due: -4, amount: 650, category: 'Contabilidade' });
  await payable({ description: 'Licenças de software', due: 3, amount: 890, category: 'Sistemas e softwares', contact: 'Google' });

  // Parcelamento 3x (a receber) e aluguel recorrente sem fim (a pagar)
  const installment = await prisma.recurrence.create({
    data: {
      companyId,
      direction: 'RECEIVABLE',
      type: 'INSTALLMENT',
      frequency: 'MONTHLY',
      contactId: contact('Delta'),
      categoryId: cat('Receita com serviços'),
      description: 'Projeto implantação',
      amount: 3000,
      startDate: daysFromToday(5),
      occurrences: 3,
    },
  });
  await prisma.receivable.createMany({
    data: [0, 1, 2].map((i) => occurrenceRow(installment, i + 1, 3, occurrenceDate(installment.startDate, 'MONTHLY', i), new Prisma.Decimal(3000))),
  });
  await prisma.recurrence.create({
    data: {
      companyId,
      direction: 'PAYABLE',
      type: 'RECURRING',
      frequency: 'MONTHLY',
      categoryId: cat('Aluguel e condomínio'),
      description: 'Aluguel escritório',
      amount: 3500,
      startDate: daysFromToday(7),
      occurrences: null, // as ocorrências são geradas ao abrir as listas
    },
  });

  // Extrato de demonstração no Itaú
  const account = await prisma.bankAccount.findFirst({ where: { companyId, bankCode: '341' } });
  if (account) {
    const lines: [string, number, string, number][] = [
      ['CREDIT', 4500, 'PIX RECEBIDO ALPHA PARTICIPACOES', -1], // casa com "Consultoria mensal" (sugestão)
      ['DEBIT', -79, 'TAR PACOTE MENSAL ITAU', -3], // regra: tarifas
      ['DEBIT', -1250.4, 'PAG BOLETO AWS SERVICOS', -2], // regra: cloud
      ['CREDIT', 2300, 'TED RECEBIDA DIVERSOS', -1], // sem par: conciliar manualmente ou categorizar
    ];
    const content =
      '<OFX><BANKACCTFROM><BANKID>341<ACCTID>49281-5</BANKACCTFROM>' +
      lines
        .map(([type, amount, memo, day], i) => `<STMTTRN><TRNTYPE>${type}<DTPOSTED>${ofxDate(daysFromToday(day))}<TRNAMT>${amount.toFixed(2)}<FITID>DEMO-${ofxDate(today())}-${i}<MEMO>${memo}</STMTTRN>`)
        .join('') +
      '</OFX>';
    const parsed = parseOFX(content);
    await importStatement(account, userId, {
      fileName: 'extrato-demo.ofx',
      fileType: 'OFX',
      fileSize: content.length,
      fileHash: sha256(content),
      lines: parsed.transactions,
    });
  }
  console.log('✓ Dados de demonstração criados (contas a pagar/receber, recorrências e extrato)');
}

// ----------------------------------------------------------------------------
// Histórico realizado (jan até o mês passado) para o Painel de acompanhamento ter o que mostrar
// ----------------------------------------------------------------------------

type HistoryItem = { name: string; category: string; base: number; day: number; direction: 'RECEIVABLE' | 'PAYABLE'; months?: number[]; contact?: string; competencePrevMonth?: true };

const HISTORY: HistoryItem[] = [
  { name: 'Consultoria mensal', category: 'Receita com serviços', base: 4500, day: 5, direction: 'RECEIVABLE', contact: 'Alpha' },
  { name: 'Mensalidade suporte', category: 'Receita com serviços', base: 1200, day: 8, direction: 'RECEIVABLE', contact: 'Delta' },
  // Projetos faturados no fim do mês e recebidos no dia 10 do mês seguinte (caixa ≠ competência)
  { name: 'Projetos BPO', category: 'Receita com serviços', base: 33000, day: 10, direction: 'RECEIVABLE', competencePrevMonth: true },
  { name: 'Serviços terceirizados', category: 'Produção e serviços terceirizados', base: 5800, day: 15, direction: 'PAYABLE' },
  { name: 'DAS - Simples Nacional', category: 'Simples Nacional (DAS)', base: 1900, day: 20, direction: 'PAYABLE' },
  { name: 'Comissões', category: 'Comissões sobre vendas', base: 650, day: 12, direction: 'PAYABLE' },
  { name: 'Aluguel escritório', category: 'Aluguel e condomínio', base: 3500, day: 7, direction: 'PAYABLE' },
  { name: 'Energia', category: 'Energia elétrica', base: 480, day: 14, direction: 'PAYABLE' },
  { name: 'Internet e telefonia', category: 'Telefone e internet', base: 280, day: 16, direction: 'PAYABLE' },
  { name: 'Licenças de software', category: 'Sistemas e softwares', base: 890, day: 3, direction: 'PAYABLE', contact: 'Google' },
  { name: 'Honorários contábeis', category: 'Contabilidade', base: 650, day: 10, direction: 'PAYABLE' },
  { name: 'Folha de pagamento', category: 'Salários', base: 9000, day: 5, direction: 'PAYABLE' },
  { name: 'INSS e FGTS', category: 'Encargos (INSS e FGTS)', base: 2700, day: 20, direction: 'PAYABLE' },
  { name: 'Benefícios', category: 'Benefícios (VT, VR, plano de saúde)', base: 1500, day: 5, direction: 'PAYABLE' },
  { name: 'Pró-labore sócios', category: 'Pró-labore', base: 6000, day: 5, direction: 'PAYABLE' },
  { name: 'Anúncios', category: 'Marketing e publicidade', base: 1400, day: 18, direction: 'PAYABLE' },
  { name: 'Tarifas bancárias', category: 'Tarifas bancárias', base: 79, day: 2, direction: 'PAYABLE' },
  { name: 'Notebooks equipe', category: 'Compra de ativo imobilizado', base: 8400, day: 22, direction: 'PAYABLE', months: [2] },
  { name: 'Aplicação CDB', category: 'Aplicações financeiras', base: 10000, day: 25, direction: 'PAYABLE', months: [5] },
  { name: 'Rendimento CDB', category: 'Rendimentos de aplicações financeiras', base: 95, day: 28, direction: 'RECEIVABLE', months: [6, 7, 8, 9, 10, 11] },
  { name: 'Distribuição de lucros', category: 'Distribuição de lucros', base: 6000, day: 25, direction: 'PAYABLE', months: [2, 5, 8, 11] },
];

async function seedHistory(companyId: string, userId: string) {
  const now = today();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (await prisma.transaction.count({ where: { companyId, origin: 'SETTLEMENT', date: { lt: monthStart } } })) {
    console.log('↷ Histórico de demonstração já existe');
    return;
  }
  const account = await prisma.bankAccount.findFirst({ where: { companyId, bankCode: '341' } });
  if (!account) return;
  const categories = await prisma.category.findMany({ where: { companyId }, select: { id: true, name: true } });
  const contacts = await prisma.contact.findMany({ where: { companyId }, select: { id: true, name: true } });
  const year = now.getUTCFullYear();
  // Variação determinística (o seed gera sempre os mesmos números)
  const vary = (base: number, m: number, i: number) => Math.round(base * (1 + 0.18 * Math.sin(m * 1.7 + i * 0.9)) * 100) / 100;

  let created = 0;
  for (let m = 0; m < now.getUTCMonth(); m++) {
    await prisma.$transaction(
      async (db) => {
        for (const [i, item] of HISTORY.entries()) {
          if (item.months && !item.months.includes(m)) continue;
          const paidAt = new Date(Date.UTC(year, m, item.day));
          // Competência no último dia do mês anterior (só a partir de fevereiro, para ficar no ano)
          const issueDate = item.competencePrevMonth && m > 0 ? new Date(Date.UTC(year, m, 0)) : paidAt;
          const data = {
            companyId,
            description: item.name,
            dueDate: paidAt,
            issueDate,
            amount: vary(item.base, m, i),
            categoryId: categories.find((c) => c.name === item.category)!.id,
            contactId: item.contact ? (contacts.find((c) => c.name.startsWith(item.contact!))?.id ?? null) : null,
          };
          const entry = item.direction === 'RECEIVABLE' ? await db.receivable.create({ data }) : await db.payable.create({ data });
          await settleEntry(db, item.direction, entry, { amount: totalDue(entry), date: paidAt, bankAccountId: account.id, userId });
          created++;
        }
      },
      { timeout: 60_000 },
    );
  }
  await prisma.$transaction((db) => recalculateBalance(db, account.id));
  console.log(`✓ Histórico de demonstração: ${created} lançamentos realizados de jan até o mês passado`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
