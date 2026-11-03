import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { isValidCNPJ, onlyDigits } from '../lib/documents.js';

/**
 * Consultas a bases públicas (BrasilAPI / IBGE) para autopreenchimento de cadastros.
 * Ficam no backend para padronizar a resposta e não depender de CORS de terceiros.
 */
export const lookupRouter = Router();

const TIMEOUT_MS = 8000;

async function fetchJson(url: string) {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', 'User-Agent': 'SYC-Hub/0.1' } }); // BrasilAPI recusa (403) sem User-Agent
  } catch {
    throw new HttpError(504, 'Serviço de consulta indisponível no momento');
  }
  if (res.status === 404) throw new HttpError(404, 'Não encontrado na base pública');
  if (!res.ok) throw new HttpError(502, 'Falha na consulta à base pública');
  return res.json() as Promise<Record<string, any>>;
}

const TAX_REGIME_BY_LABEL: Record<string, string> = {
  'LUCRO REAL': 'LUCRO_REAL',
  'LUCRO PRESUMIDO': 'LUCRO_PRESUMIDO',
  'SIMPLES NACIONAL': 'SIMPLES_NACIONAL',
};

lookupRouter.get('/cnpj/:cnpj', async (req, res) => {
  const cnpj = onlyDigits(req.params.cnpj);
  if (!isValidCNPJ(cnpj)) throw new HttpError(400, 'CNPJ inválido');
  const d = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);

  const latestRegime = [...(d.regime_tributario ?? [])].sort((a, b) => b.ano - a.ano)[0]?.forma_de_tributacao;
  const taxRegime = d.opcao_pelo_mei
    ? 'MEI'
    : d.opcao_pelo_simples
      ? 'SIMPLES_NACIONAL'
      : (TAX_REGIME_BY_LABEL[latestRegime?.toUpperCase()] ?? null);

  res.json({
    cnpj,
    legalName: d.razao_social ?? '',
    tradeName: d.nome_fantasia || null,
    status: d.descricao_situacao_cadastral ?? null,
    taxRegime,
    email: d.email || null,
    phone: d.ddd_telefone_1 || null,
    postalCode: d.cep ? onlyDigits(String(d.cep)) : null,
    address: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' ') || null,
    addressNumber: d.numero || null,
    addressComplement: d.complemento || null,
    district: d.bairro || null,
    city: d.municipio || null,
    cityIbgeCode: d.codigo_municipio_ibge ? String(d.codigo_municipio_ibge) : null,
    state: d.uf || null,
    cnae: d.cnae_fiscal ? String(d.cnae_fiscal).padStart(7, '0') : null,
    cnaeDescription: d.cnae_fiscal_descricao || null,
    partners: (d.qsa ?? []).map((s: Record<string, any>) => ({
      name: s.nome_socio,
      role: s.qualificacao_socio ?? null,
      since: s.data_entrada_sociedade ?? null,
    })),
  });
});

lookupRouter.get('/cep/:cep', async (req, res) => {
  const cep = onlyDigits(req.params.cep);
  if (cep.length !== 8) throw new HttpError(400, 'CEP inválido');
  const d = await fetchJson(`https://brasilapi.com.br/api/cep/v2/${cep}`);
  res.json({
    postalCode: cep,
    address: d.street || null,
    district: d.neighborhood || null,
    city: d.city || null,
    cityIbgeCode: d.ibge?.city ?? null,
    state: d.state || null,
  });
});

const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const municipiosCache = new Map<string, { id: string; name: string }[]>();

lookupRouter.get('/municipios/:uf', async (req, res) => {
  const uf = req.params.uf.toUpperCase();
  if (!UFS.has(uf)) throw new HttpError(400, 'UF inválida');
  let list = municipiosCache.get(uf);
  if (!list) {
    const data = (await fetchJson(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?view=nivelado`,
    )) as unknown as Record<string, any>[];
    list = data
      .map((m) => ({ id: String(m['municipio-id']), name: String(m['municipio-nome']) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    municipiosCache.set(uf, list);
  }
  res.json(list);
});

// Nomes amigáveis dos bancos mais usados (a base pública traz razões sociais abreviadas)
const POPULAR_BANKS: Record<string, string> = {
  '1': 'Banco do Brasil',
  '237': 'Bradesco',
  '104': 'Caixa Econômica',
  '341': 'Itaú',
  '33': 'Santander',
  '260': 'Nubank',
  '77': 'Inter',
  '756': 'Sicoob',
  '748': 'Sicredi',
  '336': 'C6 Bank',
  '208': 'BTG Pactual',
  '290': 'PagBank',
  '323': 'Mercado Pago',
  '197': 'Stone',
};

const KEEP_UPPER = new Set(['S.A.', 'S.A', 'SA', 'IP', 'LTDA', 'LTDA.', 'BTG', 'BRB', 'BS2', 'XP', 'CCB', 'DTVM', 'SCFI', 'CFI']);
const prettyBankName = (name: string) =>
  name
    .replace(/^BCO\b/, 'BANCO')
    .split(/\s+/)
    .map((w) => (KEEP_UPPER.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ')
    .replace(/\b(Do|Da|De|Dos|Das|E)\b/g, (m) => m.toLowerCase());

let banksCache: { code: string; name: string; logoUrl: string | null; popular: boolean }[] | null = null;

/** Bancos com código COMPE (BrasilAPI), mais usados primeiro */
lookupRouter.get('/banks', async (_req, res) => {
  if (!banksCache) {
    const data = (await fetchJson('https://brasilapi.com.br/api/banks/v1')) as unknown as Record<string, any>[];
    banksCache = data
      .filter((b) => Number(b.code) > 0) // código 0 = câmaras da B3, não são bancos
      .map((b) => {
        const code = String(b.code);
        return {
          code,
          name: POPULAR_BANKS[code] ?? prettyBankName(String(b.fullName || b.name)),
          logoUrl: b.logo_url ?? null,
          popular: code in POPULAR_BANKS,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  res.json(banksCache);
});
