# Migração do SYC Hub para a VPS (Dokploy)

De: frontend na **Vercel** (`syc-hub.vercel.app`) + API e PostgreSQL 18 no **Render** (Oregon, banco gratuito,
**sem backup, expira em 02/12/2026**).
Para: **VPS Contabo** (US-East, 147.93.6.15) com **Dokploy v0.31.4**, a mesma do Planejaqui, em
`https://hub.saveyourcompany.com.br`.

Regras: não tocar no Planejaqui (app, banco, backups, arquivos do Traefik); segredos só no painel do Dokploy; não
apagar nada no Render nem na Vercel até a VPS estar validada; nunca rodar seed, `migrate reset` ou `db push` no banco
de produção.

## Como o app roda na VPS

- **Um serviço só:** a API também entrega as telas compiladas (`SERVE_FRONTEND=true`), no mesmo domínio. Sem CORS e
  com cookie `SameSite=Lax`.
- [Dockerfile](../Dockerfile): Node 22.22.0 Alpine, usuário `node`, `tini`, porta 3000. Ao subir roda
  `prisma migrate deploy` (nunca o seed).
- `GET /api/health`: confere o banco (503 se não responder) e devolve o `commit` gravado no build.
- `SIGTERM`: termina as requisições em andamento (até 20 s) antes de sair.
- Limite de login: 10 erros por e-mail + IP; com `TRUST_PROXY`, também 30 erros por IP (15 min).
- No Dokploy: Swarm Settings com verificação de saúde em `http://127.0.0.1:3000/api/health` e troca `start-first`
  com `FailureAction: rollback`.
- A Action [conferir-deploy](../.github/workflows/conferir-deploy.yml) confere, a cada push na `main`, se o
  `/api/health` passou a responder com o commit novo (variável do repositório `PROD_URL`).

O Render e a Vercel continuam funcionando com este mesmo código: sem `SERVE_FRONTEND`, o CORS e o cookie
`SameSite=None` ficam como antes, e o front usa a `VITE_API_URL` da Vercel.

## Variáveis (só nomes)

| Situação | Nomes |
|---|---|
| No Dockerfile (não precisa colar) | `NODE_ENV=production`, `SERVE_FRONTEND=true`, `FRONTEND_DIST`, `PORT=3000` |
| Coladas no Dokploy (Environment) | `DATABASE_URL` (endereço interno do banco do projeto), `APP_URL=https://hub.saveyourcompany.com.br`, `TRUST_PROXY=1`, `ANTHROPIC_API_KEY` (chave nova, com limite de gasto) |
| Deixam de existir | `CORS_ORIGIN`, `VITE_API_URL`, `VITE_DEV_USER_ID` |

Não há e-mail (convite e senha são por link), webhooks de terceiros, OAuth nem arquivos em disco (logo fica no banco;
o PDF da importação só passa pela memória).

## Fases

| # | Fase | Quem | Pronto quando | Como desfazer |
|---|---|---|---|---|
| 0 | Cópia de segurança do banco do Render (o gratuito não tem backup): `pg_dump` 18 num contêiner temporário na VPS, lendo `~/.syc-render-db` sem mostrar a senha; arquivo numa pasta restrita do SYC e, depois, no R2 | Claude | arquivo restaurado num Postgres 18 de ensaio, contagens iguais | apagar o arquivo |
| 1 | Código (este PR) | Claude | PR revisado | não fazer o merge |
| 2 | Projeto "SYC Hub" no Dokploy: banco `postgres:18.7` (versão exata; o Render está no 18.6; sem porta externa) e app (GitHub `viniciusgois/syc-hub`, `main`, Dockerfile); Swarm Settings e limites (app 768 MB, banco 512 MB) | Dono no painel; Claude pela API | banco e app criados; Planejaqui 200 | apagar o projeto |
| 3 | Primeiro deploy em `hub.saveyourcompany.com.br` (registro A só para 147.93.6.15, TTL 300), banco vazio e um usuário de teste pelo script | Dono (DNS); Claude verifica | HTTPS, `/api/health` com o commit, Action verde, troca de versão sem erro, versão quebrada volta sozinha | apagar o app e o registro |
| 4 | Backup: bucket `syc-hub-backups` no R2 (chave que só grava nele, trava de 30 dias, regra de 90), backup diário às 03:15 | Dono (Cloudflare e painel) | arquivo no bucket e ensaio de restauração | desligar o agendamento |
| 5 | Ensaio da migração: cópia do Render restaurada num banco de ensaio, contagem de todas as tabelas | Claude | contagens idênticas | apagar o banco de ensaio |
| 6 | Migração (janela de 20 a 30 min, abaixo) | Claude, com ok do dono a cada passo | contagens iguais e checklist | plano de volta |
| 7 | Observação (1 a 2 semanas): Render suspenso, Vercel redirecionando | todos | backups diários, Action verde | — |
| 8 | Desligar Render e Vercel, depois de uma última cópia no R2 | Dono | — | sem volta |

### Janela da migração

1. Avisar os usuários. **Suspender** (não apagar) o serviço web no Render: sem API, ninguém grava.
2. `pg_dump -Fc` final do banco do Render (versão 18).
3. Com o app da VPS parado, `pg_restore` no banco da VPS.
4. Comparar a contagem de linhas de todas as tabelas (inclusive `_prisma_migrations`). Têm de bater.
5. Subir o app na VPS e fazer o checklist rápido.
6. Vercel: redirecionar tudo para `https://hub.saveyourcompany.com.br`, mantendo o caminho e o `?acesso=` dos links
   já enviados.

Cada usuário entra de novo uma vez: o login fica guardado no navegador por endereço. As senhas não mudam.

### Plano de volta

- Antes de liberar a VPS: reativar o serviço no Render.
- Depois: parar o app da VPS, copiar o banco da VPS para o Render (depois de uma cópia do Render), comparar as
  contagens, reativar o Render e tirar o redirecionamento da Vercel. Nada do que foi lançado na VPS se perde.

## Checklist de validação

- [ ] Login, troca de senha e saída
- [ ] Trocar de empresa; Resumo, Contas & Extratos e Fluxo de caixa com os mesmos saldos do Render
- [ ] Agendar e baixar pagamento e recebimento; conciliar uma linha
- [ ] Importar OFX, planilha e PDF com IA
- [ ] Busca de CNPJ e CEP (BrasilAPI) e municípios (IBGE)
- [ ] Link de convite e de nova senha abertos num navegador anônimo
- [ ] Exportar relatório em Excel e PDF
- [ ] Backup do dia no R2 e ensaio de restauração registrado
- [ ] `/api/health` com o commit atual; Action verde
- [ ] `https://www.planejaqui.com.br/api/health` = 200 e o Planejaqui funcionando

## Registro

| Data | O quê | Resultado |
|---|---|---|
| 19/11/2026 | Fase 0: cópia de segurança do banco do Render (PostgreSQL 18.6, 22 MB) com `pg_dump` 18.7 num contêiner temporário na VPS; arquivo em `/root/syc-migracao` (só root) | cópia de 1,8 MB em 17 s; ensaio de restauração num Postgres 18 sem rede em 1 s, sem avisos; **20 tabelas, contagens idênticas** (ex.: 7.040 transações, 5.766 contas a pagar, 1.689 a receber) |
| 19/11/2026 | Imagem simulada sem Docker: só dependências de produção, `prisma migrate deploy`, API entregando as telas | `/api/health` com commit, links `?acesso=`, cookie `Lax; Secure`, limite por IP (429 no 31º erro), SIGTERM com calma, telas carregando dados pela `/api` |
