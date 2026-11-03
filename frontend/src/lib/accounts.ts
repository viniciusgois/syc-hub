import { AccountType, BankAccount } from '../types';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: 'Conta bancária',
  SAVINGS: 'Poupança',
  INVESTMENT: 'Investimento',
  CASH: 'Caixinha',
  CREDIT_CARD: 'Cartão de crédito',
  PAYMENT_GATEWAY: 'Maquininha / Gateway',
  OTHER: 'Outra conta',
};

/** Cor padrão por banco (código COMPE sem zeros à esquerda) para identificar a conta na UI */
const BANK_COLORS: Record<string, string> = {
  '1': '#eab308',
  '237': '#cc092f',
  '104': '#005ca9',
  '341': '#ec7000',
  '33': '#ec0000',
  '260': '#820ad1',
  '77': '#ff7a00',
  '756': '#00a091',
  '748': '#3fa110',
  '336': '#334155',
  '208': '#0b2a5b',
  '290': '#1bb99a',
  '323': '#00b1ea',
  '197': '#00a868',
};

const TYPE_COLORS: Partial<Record<AccountType, string>> = {
  CASH: '#10b981',
  CREDIT_CARD: '#6366f1',
};

export const normalizeBankCode = (code?: string | null) => (code ?? '').replace(/^0+(?=\d)/, '');

export function accountColor(type: AccountType, bankCode?: string | null): string {
  return BANK_COLORS[normalizeBankCode(bankCode)] ?? TYPE_COLORS[type] ?? '#64748b';
}

/** "ag 3069 / cc 00351890-6", ou o tipo da conta quando não há dados bancários */
export function accountDetails(acc: Pick<BankAccount, 'type' | 'agency' | 'accountNumber' | 'accountDigit'>): string {
  const parts: string[] = [];
  if (acc.agency) parts.push(`ag ${acc.agency}`);
  if (acc.accountNumber) parts.push(`cc ${acc.accountNumber}${acc.accountDigit ? `-${acc.accountDigit}` : ''}`);
  return parts.join(' / ') || ACCOUNT_TYPE_LABELS[acc.type];
}

/** Título curto da conta: nome do banco ou o tipo (Caixinha, Cartão de crédito...) */
export const accountInstitution = (acc: Pick<BankAccount, 'type' | 'bankName'>) =>
  acc.bankName || ACCOUNT_TYPE_LABELS[acc.type];
