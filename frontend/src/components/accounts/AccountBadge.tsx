import React from 'react';
import { CreditCard, Landmark, TrendingUp, Wallet } from 'lucide-react';
import { BankAccount } from '../../types';

/** Quadrado com a cor do banco e o nome curto (no lugar do logo do banco) */
export const AccountBadge: React.FC<{ account: Pick<BankAccount, 'type' | 'bankName' | 'color'>; size?: 'md' | 'lg' }> = ({ account, size = 'md' }) => {
  const box = size === 'lg' ? 'w-12 h-12 text-[11px]' : 'w-10 h-10 text-[10px]';
  const Icon = account.type === 'CASH' ? Wallet : account.type === 'CREDIT_CARD' ? CreditCard : account.type === 'INVESTMENT' ? TrendingUp : Landmark;
  // "Banco Santander Brasil" -> "santander"; "Itaú Unibanco" -> "itaú"
  const short = account.bankName
    ?.split(/[\s-]+/)
    .find((w) => w.length > 1 && !/^(banco|bco|bank)$/i.test(w))
    ?.slice(0, 7)
    .toLowerCase();
  return (
    <span className={`${box} rounded-lg shrink-0 flex items-center justify-center font-bold text-white`} style={{ backgroundColor: account.color }} aria-hidden="true">
      {short && account.type !== 'CASH' ? short : <Icon className="w-5 h-5" />}
    </span>
  );
};
