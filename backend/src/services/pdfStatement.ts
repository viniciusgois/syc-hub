import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { HttpError } from '../lib/http.js';
import { sha256 } from './ofx.js';

/**
 * Importação de extrato/fatura em PDF: o PDF vai direto para o Claude (lê texto e layout, inclusive PDF
 * escaneado) e volta como JSON estruturado. Nada é gravado aqui: o frontend mostra um rascunho para revisão
 * e grava pela importação de linhas (POST /imports/rows), como a planilha.
 */

const MODEL = 'claude-haiku-5-5';
// Sem streaming, o SDK aceita até ~16k tokens de saída (cerca de 500 lançamentos)
const MAX_TOKENS = 16000;

export type PdfDocumentType = 'BANK_STATEMENT' | 'CREDIT_CARD';

const extractionSchema = z.object({
  bankName: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  openingBalance: z.number().nullable(),
  closingBalance: z.number().nullable(),
  invoiceTotal: z.number().nullable(),
  dueDate: z.string().nullable(),
  transactions: z.array(z.object({ date: z.string(), description: z.string(), amount: z.number() })),
});

const BASE_PROMPT = `Você é um parser financeiro. Extraia do documento todas as transações e devolva no formato pedido.
- date: data da transação no formato YYYY-MM-DD. Quando o documento mostrar só dia/mês, deduza o ano pelo período do documento (atenção à virada de ano).
- description: o texto da transação como está no documento (sem inventar nem resumir).
- amount: número com ponto decimal. Valores negativos para saídas, positivos para entradas.
- Não inclua linhas de saldo (saldo anterior, saldo do dia, saldo final), totais nem subtotais como transações.
- Se uma transação aparecer quebrada em várias linhas do documento, junte em uma só.
- bankName: nome do banco ou emissor. periodStart/periodEnd: período coberto (YYYY-MM-DD), se houver.
- openingBalance/closingBalance: saldo inicial e saldo final do período, se o documento mostrar; senão null.
- invoiceTotal e dueDate: só para fatura de cartão (total da fatura e vencimento); senão null.`;

const CREDIT_CARD_RULE = `
Este documento é uma FATURA DE CARTÃO DE CRÉDITO.
- Compras e tarifas são saídas (valores negativos); estornos e créditos são entradas (valores positivos).
- Compras parceladas: mantenha a parcela na descrição (ex.: "LOJA X 03/10") e use a data da compra que aparece na fatura.
REGRA CRÍTICA DE EXCLUSÃO: IGNORE e NÃO INCLUA lançamentos que representem o pagamento da própria fatura (ex.: "PAGAMENTO DE FATURA", "PAGTO EFETUADO", "PAGAMENTO RECEBIDO") nem o "SALDO ANTERIOR". Liste apenas as despesas e estornos reais.
- invoiceTotal: valor total desta fatura (positivo). dueDate: data de vencimento.`;

const BANK_STATEMENT_RULE = `
Este documento é um EXTRATO DE CONTA CORRENTE. Se houver colunas separadas de entrada/crédito e saída/débito, use a coluna para definir o sinal.`;

let client: Anthropic | null = null;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, 'Importação de PDF não configurada: falta a chave ANTHROPIC_API_KEY no servidor.');
  }
  client ??= new Anthropic();
  return client;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const round = (v: number) => Math.round(v * 100) / 100;
const validDate = (v: string | null) => (v && isoDate.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

export async function extractPdfStatement(pdf: Buffer, documentType: PdfDocumentType) {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'O arquivo enviado não é um PDF válido.');

  let response;
  try {
    response = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium', format: zodOutputFormat(extractionSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
            { type: 'text', text: BASE_PROMPT + (documentType === 'CREDIT_CARD' ? CREDIT_CARD_RULE : BANK_STATEMENT_RULE) },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'A chave da API da Anthropic é inválida. Confira ANTHROPIC_API_KEY no servidor.');
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Limite de uso da IA atingido. Tente de novo em alguns minutos.');
    if (err instanceof Anthropic.BadRequestError) throw new HttpError(422, `A IA não conseguiu ler este PDF: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new HttpError(502, 'O serviço de IA não respondeu. Tente de novo em instantes.');
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new HttpError(422, 'A IA recusou ler este documento.');
  if (response.stop_reason === 'max_tokens') {
    throw new HttpError(422, 'O documento tem lançamentos demais para uma leitura só. Divida o PDF em partes menores (por exemplo, por mês) e importe cada uma.');
  }
  const data = response.parsed_output;
  if (!data) throw new HttpError(502, 'A IA devolveu uma resposta fora do formato esperado. Tente de novo.');

  const transactions = data.transactions
    .map((t) => ({ date: validDate(t.date), description: t.description.replace(/\s+/g, ' ').trim(), amount: round(t.amount) }))
    .filter((t): t is { date: string; description: string; amount: number } => !!t.date && !!t.description && t.amount !== 0);

  return {
    documentType,
    model: MODEL,
    fileHash: sha256(pdf.toString('base64')),
    bankName: data.bankName,
    periodStart: validDate(data.periodStart),
    periodEnd: validDate(data.periodEnd),
    openingBalance: data.openingBalance === null ? null : round(data.openingBalance),
    closingBalance: data.closingBalance === null ? null : round(data.closingBalance),
    invoiceTotal: data.invoiceTotal === null ? null : round(Math.abs(data.invoiceTotal)),
    dueDate: validDate(data.dueDate),
    transactions,
    discarded: data.transactions.length - transactions.length,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
