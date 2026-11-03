/**
 * Correções de português em nomes de categorias (opção "regras fixas"): acentos que faltam em palavras
 * comuns de finanças, grafias erradas conhecidas, hífen e espaços. Só sugere; quem aprova é o usuário.
 * Não mexe em maiúsculas/minúsculas por estilo nem em descrições vindas do banco.
 */

/** Palavra sem acento (minúscula) -> forma correta (minúscula) */
const WORDS: Record<string, string> = {
  agua: 'água',
  alimentacao: 'alimentação',
  antecipacao: 'antecipação',
  aplicacao: 'aplicação',
  aplicacoes: 'aplicações',
  bancaria: 'bancária',
  bancarias: 'bancárias',
  bancario: 'bancário',
  bancarios: 'bancários',
  bonificacao: 'bonificação',
  capacitacao: 'capacitação',
  cartao: 'cartão',
  cartoes: 'cartões',
  combustivel: 'combustível',
  combustiveis: 'combustíveis',
  comissao: 'comissão',
  comissoes: 'comissões',
  comunicacao: 'comunicação',
  condominio: 'condomínio',
  consorcio: 'consórcio',
  contabil: 'contábil',
  contabeis: 'contábeis',
  contribuicao: 'contribuição',
  contribuicoes: 'contribuições',
  credito: 'crédito',
  creditos: 'créditos',
  debito: 'débito',
  debitos: 'débitos',
  decimo: 'décimo',
  devolucao: 'devolução',
  devolucoes: 'devoluções',
  distribuicao: 'distribuição',
  doacao: 'doação',
  doacoes: 'doações',
  eletrica: 'elétrica',
  emprestimo: 'empréstimo',
  emprestimos: 'empréstimos',
  escritorio: 'escritório',
  estagio: 'estágio',
  estagiarios: 'estagiários',
  ferias: 'férias',
  honorarios: 'honorários',
  indenizacao: 'indenização',
  indenizacoes: 'indenizações',
  informatica: 'informática',
  juridico: 'jurídico',
  juridicos: 'jurídicos',
  licenca: 'licença',
  licencas: 'licenças',
  locacao: 'locação',
  logistica: 'logística',
  maquina: 'máquina',
  maquinas: 'máquinas',
  manutencao: 'manutenção',
  materia: 'matéria',
  medico: 'médico',
  medicos: 'médicos',
  moveis: 'móveis',
  odontologico: 'odontológico',
  premiacao: 'premiação',
  premiacoes: 'premiações',
  previdencia: 'previdência',
  publicacao: 'publicação',
  rescisao: 'rescisão',
  rescisoes: 'rescisões',
  salario: 'salário',
  salarios: 'salários',
  saude: 'saúde',
  seguranca: 'segurança',
  servico: 'serviço',
  servicos: 'serviços',
  socio: 'sócio',
  socios: 'sócios',
  tributaria: 'tributária',
  tributarias: 'tributárias',
  utensilios: 'utensílios',
  veiculo: 'veículo',
  veiculos: 'veículos',
  // Grafias erradas conhecidas
  softwers: 'softwares',
  sofwares: 'softwares',
  softwere: 'software',
  sotware: 'software',
};

/** Mantém a caixa da palavra original: "MAQUINAS" -> "MÁQUINAS", "Maquinas" -> "Máquinas" */
function sameCase(original: string, fixed: string) {
  if (original === original.toUpperCase() && original !== original.toLowerCase()) return fixed.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
}

/** Nome corrigido, ou null se não há o que corrigir */
export function correctCategoryName(name: string): string | null {
  let v = name.replace(/\s+/g, ' ').trim();
  // "On- Line", "On -Line", "On Line", "Online" -> "On-line"
  v = v.replace(/\bon\s*-\s*line\b|\bon line\b|\bonline\b/gi, (m) => (m[0] === 'O' ? 'On-line' : 'on-line'));
  // "Pro labore" / "Pro-labore" -> "Pró-labore"
  v = v.replace(/\bpro[\s-]*labore\b/gi, (m) => (m[0] === 'P' ? 'Pró-labore' : 'pró-labore'));
  // Hífen entre palavras sem espaço de um dos lados: "São Luiz- Maranhão" -> "São Luiz - Maranhão"
  v = v.replace(/(\p{L})\s+-(\p{L})|(\p{L})-\s+(\p{L})/gu, (_m, a, b, c, d) => `${a ?? c} - ${b ?? d}`);
  v = v.replace(/\p{L}+/gu, (word) => {
    const fixed = WORDS[word.toLowerCase()];
    return fixed && fixed !== word.toLowerCase() ? sameCase(word, fixed) : word;
  });
  return v !== name ? v : null;
}
