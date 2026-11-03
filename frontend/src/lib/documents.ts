export const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** Aplica uma máscara onde "9" é um dígito: applyMask('12345678', '99999-999') -> '12345-678' */
export function applyMask(value: string, mask: string): string {
  const digits = onlyDigits(value);
  let out = '';
  let i = 0;
  for (const ch of mask) {
    if (i >= digits.length) break;
    if (ch === '9') out += digits[i++];
    else out += ch;
  }
  return out;
}

export const MASKS = {
  cnpj: '99.999.999/9999-99',
  cpf: '999.999.999-99',
  cei: '99.999.99999/99',
  cep: '99999-999',
} as const;

const allSameDigits = (d: string) => /^(\d)\1+$/.test(d);

export function isValidCNPJ(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSameDigits(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function isValidCPF(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || allSameDigits(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Formata CNPJ (14 dígitos) ou CPF (11 dígitos) para exibição */
export function formatDocument(value?: string | null): string {
  if (!value) return '';
  const d = onlyDigits(value);
  if (d.length === 14) return applyMask(d, MASKS.cnpj);
  if (d.length === 11) return applyMask(d, MASKS.cpf);
  return value;
}

/** Iniciais para o badge da empresa: "Bistrô Vila Nobre" -> "BV" */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** (11) 2345-6789 ou (11) 92345-6789 conforme a quantidade de dígitos */
export function formatPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  return applyMask(d, d.length > 10 ? '(99) 99999-9999' : '(99) 9999-9999');
}
