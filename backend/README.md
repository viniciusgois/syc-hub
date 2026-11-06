# SYC Hub — API

API REST multi-tenant do SYC Hub (BPO financeiro): contas bancárias, plano de contas, importação OFX, conciliação por regras e DRE gerencial.

**Stack:** Node 22 · Express 5 · Prisma 6 (PostgreSQL) · Zod 4 · TypeScript

## Como rodar

```bash
npm install
npm run db:start              # Postgres local (prisma dev) na porta 51214 — já configurado no .env
npx prisma migrate deploy     # aplica as migrations
npm run db:seed               # (opcional) empresas de exemplo + dados de demonstração na SYC Hub Matriz
npm run db:reset              # (opcional) APAGA o banco local, reaplica migrations e roda o seed
npm run dev                   # API em http://localhost:3333
```

Com outro Postgres, ajuste `DATABASE_URL` no `.env` (veja `.env.example`). Com o `prisma dev`, a URL precisa
de `&pgbouncer=true` (o servidor local não suporta prepared statements entre conexões).

O frontend (`../frontend`, `npm run dev`) consome a API em `http://localhost:3333/api` (configurável em `VITE_API_URL`).

## Login e permissões

- **Login:** `POST /api/auth/login` (`{ email, password }`) grava o cookie httpOnly `syc_session` (30 dias) e devolve
  `token`, que scripts podem enviar como `Authorization: Bearer <token>`. `POST /api/auth/logout`, `GET/PATCH /api/auth/me`,
  `POST /api/auth/me/password` (encerra as outras sessões). 10 tentativas erradas por e-mail+IP em 15 min → 429.
- **Senhas:** scrypt (nativo do Node), mínimo 8 caracteres com letras e números. O banco guarda só hashes (senhas,
  sessões e links).
- **Convite / redefinição sem e-mail:** ao adicionar um usuário sem senha (`POST /users`) ou em
  `POST /users/:memberId/access-link`, a API devolve um link de uso único (`APP_URL/?acesso=...`; convite 7 dias,
  redefinição 24 h) que o administrador copia e envia. `GET/POST /api/auth/access/:token` define a senha e já entra.
  Só gera link quem administra **todas** as empresas do usuário (evita assumir a conta de quem acessa outras empresas).
- **Papéis (escrita; leitura é livre para membros):** operador financeiro = lançamentos, extrato/importação,
  conciliação, contatos e regras; administrador = + contas bancárias, plano de contas, centros de custo, dados e
  configurações da empresa, usuários e limpar dados; proprietário = + excluir a empresa e gerenciar proprietários.
  Consultor e somente leitura só visualizam. Empresa de que o usuário não participa responde 404.
- **Desenvolvimento:** o seed define a senha do usuário `dev@sychub.com.br` como `sychub123` (só se ele ainda não tiver).

## Endpoints

Todas as rotas de dados ficam sob `/api/companies/:companyId/…`, e toda referência
(categoria, contato, centro de custo, conta) é validada como pertencente à mesma empresa.
Valores monetários saem como `number` e datas em ISO 8601.

| Recurso | Rotas |
|---|---|
| Empresas | `GET/POST /api/companies`, `GET/PATCH /api/companies/:id` (nova empresa já recebe o plano de contas padrão) |
| Contas bancárias | `GET/POST /bank-accounts`, `GET/PATCH/DELETE /bank-accounts/:id` (lista inclui `unreconciledCount`; `isActive: false` = arquivada), `GET /bank-accounts/:id/statement?from&to` (extrato: saldo anterior, linhas conciliadas com saldo acumulado, saldo diário para o gráfico, `pendingCount`) |
| Importar PDF (IA) | `POST /imports/pdf/extract` (multipart: `file` PDF até 20 MB + `documentType` `BANK_STATEMENT` ou `CREDIT_CARD`) devolve um rascunho `{ transactions: [{date, description, amount}], openingBalance, closingBalance, invoiceTotal, dueDate, fileHash }` sem gravar nada; a gravação é `POST /imports/rows` com `fileType: "PDF"` e `fileHash` (impede importar o mesmo PDF duas vezes) |
| Migração do Nibo | `POST /nibo-imports/preview` (linhas do relatório "Unificado por lançamento" lidas pelo frontend → contas, categorias, totais e revisão; não grava), `POST /nibo-imports` (`rows` + `mapping` de contas e categorias; grava tudo numa transação), `GET /nibo-imports`, `POST /nibo-imports/:id/rollback`, `POST /nibo-imports/chart/preview` e `POST /nibo-imports/chart` (plano de contas do Nibo lido do PDF pelo frontend: `items`, `renames`, `removeUnmatched`), `POST /nibo-imports/transfers/preview` e `POST /nibo-imports/transfers` (relatório "Transferências" em Excel: `transfers`, `accountMap`; o rollback é o mesmo `/:id/rollback`) — só administrador |
| Transferências | `POST /transactions/transfer` (`fromAccountId`, `toAccountId`, `amount`/`date` ou `transactionId` de uma linha do extrato, `counterpartId` opcional); desfazer = `POST /transactions/:id/unreconcile` de qualquer lado |
| Plano de contas | `GET/POST /categories` (5 seções fixas da DRE; `isGroup` = subgrupo), `PATCH/DELETE /categories/:id`, `POST /categories/reorder` |
| Contatos | `GET/POST /contacts` (`?type=&search=&archived=true`, com em aberto/vencido), `GET /contacts/:id` (saldos, movimentado 12 meses, próximas contas, últimas movimentações, anotações), `PATCH /contacts/:id`, `DELETE /contacts/:id` (arquiva), `POST/DELETE /contacts/:id/notes` |
| Centros de custo | `GET/POST /cost-centers`, `PATCH/DELETE /cost-centers/:id` |
| Transações | `GET /transactions` (`bankAccountId, status=PENDING,SUGGESTED, categoryId, contactId, type, from, to, search, importBatchId, page, pageSize`), `POST /transactions` (lançamento manual), `PATCH /transactions/:id` |
| Conciliação | `POST /transactions/:id/match` (`{ entries: [{ direction, id }], mode: ADJUST\|PARTIAL, differenceCategoryId? }` — linha do extrato ↔ contas a pagar/receber), `GET /transactions/:id/candidates`, `GET /receivables/:id/statement-candidates` (idem payables), `POST /transactions/:id/reconcile` (aceita `splits`), `PATCH /transactions/:id` (`splits: [...] \| null`), `POST /transactions/reconcile-bulk` (`{ ids, categoryId? }`), `POST /transactions/:id/unreconcile`, `POST /transactions/:id/ignore`, `DELETE /transactions/:id` (só manuais) |
| Importação | `POST /imports/ofx` (`{ bankAccountId, fileName, content, dryRun? }`), `POST /imports/rows` (planilha já lida: `{ rows: [{ date, description, amount }] }`), `GET /imports`, `POST /imports/:id/rollback` |
| Contas a receber / pagar | `/receivables` e `/payables` (mesmas rotas): `GET /` (`status=open\|settled\|lost\|all, from, to, contactId, categoryId, search, min, max`), `GET /:id` (com baixas e rateio), `POST /` (agendado; `splits: [{ categoryId, costCenterId?, amount }]` no lugar de `categoryId`; `recurrence: { type: INSTALLMENT\|RECURRING, frequency, occurrences\|null }`; ou `settlement: { bankAccountId, date }` para "não agendado"), `PATCH/DELETE /:id`, `POST /settle` (baixa em lote), `POST /write-off` (perda), `POST /payables/bank-schedule` (`{ ids, value }`, programado no banco), `POST /:id/reopen`, `POST /:id/settlements/:txId/reverse` (estorno) |
| Recorrências | `GET /recurrences?direction=RECEIVABLE\|PAYABLE`, `POST /recurrences/:id/end` |
| Administração | `GET/POST /users`, `PATCH/DELETE /users/:memberId` (papéis), `POST /clear-data` e `DELETE /api/companies/:id` (confirmação com o CNPJ) |
| Regras | `GET/POST /rules`, `PATCH/DELETE /rules/:id`, `POST /rules/apply` (reaplica nas PENDING) |
| Consultas | `GET /api/lookup/banks` (bancos COMPE com logo, mais usados marcados), `GET /api/lookup/cnpj/:cnpj` (Receita via BrasilAPI, inclui sócios), `GET /api/lookup/cep/:cep`, `GET /api/lookup/municipios/:uf` (IBGE) |
| Relatórios | `GET /reports/panel?year=2026&basis=CASH|ACCRUAL&costCenterId=` (Painel de acompanhamento, matriz anual), `GET /reports/panel/details?from&to&basis&categoryId|groupId|section` (lançamentos de uma célula), `GET /reports/entries?type=receivable|payable&state=open|settled&dateBy=due|payment|competence&from&to&contactId&categoryId&costCenterId&bankAccountId&search&min&max` (contas a receber/recebidas/a pagar/pagas, uma linha por categoria/CC), `GET /reports/summary`, `GET /reports/alerts` (vencidos em aberto + linhas a conciliar), `GET /reports/cashflow?from=&to=&accounts=id,id` (saldo real diário, projeção pelos agendamentos em aberto, passados e futuros com saldo acumulado) |

### Regras de negócio

- **Importação OFX:** o mesmo arquivo (SHA-256) é recusado com 409; FITIDs já existentes na conta são ignorados;
  regras ativas são aplicadas por prioridade (`autoReconcile` → RECONCILED, senão SUGGESTED). Divergência entre
  a conta do arquivo e a selecionada gera `warnings`, sem bloquear.
- **Saldo (como no Nibo):** `currentBalance` = saldo inicial + créditos − débitos **conciliados** desde
  `initialBalanceDate`. O importado ainda não conciliado (PENDING/SUGGESTED) fica na tela de Conciliação e não entra
  no saldo, no extrato nem no fluxo de caixa. Recalculado em toda mudança de status (conciliar, desfazer, ignorar,
  baixa, importação com regra automática, transferência).
- **Conciliação:** a lista de linhas em aberto (`GET /transactions`) traz `matchSuggestion` (conta agendada),
  `transferSuggestion` (linha em aberto de outra conta, sentido oposto, mesmo valor, até 3 dias) e `guess` (palpite:
  classificação da última linha conciliada com a mesma descrição). Filtros extras: `min`, `max`, `order`
  (`date_asc|date_desc|amount_desc`); `search` também procura no nome do contato e no documento.
- **Criar agendamento detalhado:** `POST /receivables|payables` com `settlement: { transactionId }` cria o lançamento
  já quitado pela linha do extrato (sem gerar outra transação).
- **Migração do Nibo (`services/niboImport.ts`):** só Excel. Recebido/Pago viram lançamentos já baixados (baixa
  `SETTLEMENT` conciliada na conta; o OFX importado depois casa com ela em ±3 dias); A receber/A pagar ficam em aberto.
  Conta, categoria, centro de custo e contato são reaproveitados pelo nome (sem acento/caixa) ou criados. Saldo inicial
  de cada conta é informado na prévia. Diferença entre valor pago e valor da categoria vira juros/desconto. O mesmo
  arquivo não é importado duas vezes; desfazer remove os lançamentos e o que foi criado e não está em uso.
- **Plano de contas do Nibo (`services/niboChart.ts`):** o PDF de Configurações › Categorias é lido pela posição do
  texto (`frontend/src/lib/niboChart.ts`, pdf.js carregado só quando usado). Cria subgrupos e categorias na seção e ordem
  do Nibo, move as que já existem e (opcional) remove as sem uso fora do plano. Categorias do sistema (juros, multas,
  descontos) são reconhecidas pelo nome e nunca alteradas. Vale só para a empresa: o plano padrão não muda.
- **Importação de PDF por IA (`services/pdfStatement.ts`):** o PDF vai direto para o Claude Haiku 5.5 (lê texto e layout,
  inclusive PDF escaneado) com saída estruturada (JSON garantido). Fatura de cartão: o pagamento da fatura e o saldo
  anterior ficam de fora. O frontend mostra um rascunho editável e confere com o saldo final do extrato ou o total da
  fatura antes de gravar. Requer `ANTHROPIC_API_KEY` no ambiente (sem ela a rota responde 503 com mensagem clara).
- **Transferências do Nibo (`services/niboTransfers.ts`):** o Excel traz cada transferência em duas linhas (saída e
  entrada); o frontend junta pela data, contas e valor. Contas casadas pelo nome com as do passo 2; transferências já
  existentes (mesma data, contas e valor) ficam de fora. Cada uma vira os dois lados conciliados (`isTransfer`).
  A prévia aponta transferências anteriores à data do saldo inicial de uma conta (não entrariam no saldo) e sugere
  recuar a data; o extrato (`GET /bank-accounts/:id/statement`, campo `beforeInitial`) avisa o mesmo para qualquer conta.
- **Lançamentos com rateio / pagos em várias vezes:** linhas com o mesmo "Agendamento" são um lançamento só — rateio
  (mesmo pagamento repetido, uma parte por linha) vira `EntrySplit`; pagamentos separados viram uma baixa cada.
- **Correção de português (`services/ptCorrections.ts`):** só nomes de categorias/subgrupos, por regras fixas (acentos de
  palavras comuns, "Softwers", "On- Line", hífen); sempre sugerida na prévia e aplicada só se aprovada.
- **Transferências:** os dois lados ficam conciliados, com `isTransfer` e fora do Painel/DRE. Lado criado no sistema
  (sem FITID) é reconhecido pela importação do extrato da outra conta (mesmo valor, ±3 dias) e não duplica.
- **Razão gerencial (`services/ledger.ts`):** base única do Painel, do detalhamento e dos relatórios de contas. Cada
  movimento vira linhas (categoria, centro de custo, valor com sinal) a partir do rateio ou da categoria, mais
  juros/multa e desconto. Só dois regimes (decisão da equipe; não há "visão" separada como no Nibo):
  **Caixa** = só o realizado (extrato conciliado + baixas), pela data do pagamento; **Competência** = realizado +
  agendado (inclusive vencidos em aberto, exceto perdas), pela data de competência. Transferências ficam de fora.
- **Painel de acompanhamento:** 5 seções fixas com letras (A receitas, B custos, C despesas, E investimento,
  F financiamento) e subgrupos; Lucro bruto (A+B) em R$, Margem de contribuição ((A+B)÷A) em %, Ponto de
  equilíbrio = |C| ÷ margem, Resultado operacional (A+B+C=D) e Variação de caixa / Resultado (D+E+F).
- **Plano de contas padrão:** `services/defaultChartOfAccounts.ts`; categorias `isSystem` (juros, multas, descontos)
  não podem ser editadas/excluídas; categoria em uso é arquivada em vez de excluída.
- **Contas a pagar/receber:** em aberto = valor + juros/multa − desconto − baixado. A baixa cria um lançamento
  (`origin: SETTLEMENT`) já categorizado na conta escolhida, entrando no saldo e na DRE; baixa parcial é permitida e
  valor acima do aberto vira juros. Recorrências sem fim são geradas `Company.provisioningMonths` meses à frente na leitura das listas.
- **Conciliação com contas (manual):** a listagem do extrato traz `matchSuggestion` (conta em aberto de mesma direção,
  valor exato e até 5 dias do vencimento/previsto) para o usuário confirmar. Uma linha pode quitar várias contas
  (alocação pela ordem de vencimento); linha maior que o aberto gera juros, menor gera desconto (`ADJUST`) ou baixa
  parcial (`PARTIAL`). Vínculos ficam em `entry_settlements`; a DRE soma cada parte na categoria da conta quitada.
- **Extrato x baixas:** ao importar OFX, a linha de mesmo tipo e valor, até 3 dias da data de uma baixa sem extrato,
  é casada com ela (não duplica o lançamento). O rollback da importação desfaz o casamento e mantém a baixa.
- **Rateio (`entry_splits`):** com `Company.splitsEnabled`, recebimentos, pagamentos, recorrências e linhas do extrato
  categorizadas direto podem ser divididos entre categorias e centros de custo (mín. 2 linhas). O cliente envia valores
  positivos; o servidor grava com sinal (categoria de natureza oposta fica negativa, ex.: recebimento líquido = venda −
  taxa da maquininha) e exige que a soma feche com o valor. A categoria/centro de custo "de capa" vira o da maior
  linha. Parcelas e ocorrências recebem o rateio reescalado (sobra de arredondamento na maior linha); mudar o valor
  reescala. Na DRE, cada baixa entra proporcionalmente nas linhas; o filtro de centro de custo vale por linha.
  Com o rateio ativo, juros/multa e desconto vão para Multas recebidas/pagas e Descontos concedidos/obtidos; a
  diferença da conciliação pode ir para uma categoria escolhida (`interestCategoryId`/`discountCategoryId`).
- **Programado no banco:** `Payable.scheduledAtBank`, disponível com `Company.bankScheduleEnabled`.
- **Exclusões:** contas com movimento, categorias de sistema/em uso e contatos são desativados, não apagados.

## Pendências conhecidas

- Envio de e-mail (convite / esqueci a senha): hoje o administrador copia e envia o link.
- Consultor e somente leitura têm as mesmas permissões (só visualizar).
- Conciliação automática (sem confirmação) quando houver um único candidato exato — hoje só sugere.
- Rollback de importação remove também as transações já conciliadas daquele lote.
- `npm audit` aponta 3 alertas no CLI do Prisma (`deepmerge-ts`); afetam só o tooling de dev e a correção exige
  migrar para o Prisma 7 (que muda o `datasource` do schema).
