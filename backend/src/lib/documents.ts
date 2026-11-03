export const onlyDigits = (v: string) => v.replace(/\D/g, '');

const allSameDigits = (d: string) => /^(\d)\1+$/.test(d);

export function isValidCNPJ(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSameDigits(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const rest = sum % 11;
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
