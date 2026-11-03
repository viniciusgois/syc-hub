import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';

export interface Bank {
  code: string;
  name: string;
  logoUrl: string | null;
  popular: boolean;
}

// Lista de bancos (muda raramente): carregada uma vez por sessão
let banksCache: Bank[] | null = null;

/** Bancos para o seletor; carrega quando `enabled` fica true */
export function useBanks(enabled = true) {
  const [banks, setBanks] = useState<Bank[] | null>(banksCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || banks) return;
    let cancelled = false;
    api
      .get<Bank[]>('/lookup/banks')
      .then((list) => {
        banksCache = list;
        if (!cancelled) setBanks(list);
      })
      .catch((err) => !cancelled && setError(`Não foi possível carregar os bancos: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [enabled, banks]);
  return { banks, error };
}

/** Encontra o banco pelo código salvo ("033" ou "33") */
export const findBank = (banks: Bank[] | null, code?: string | null) =>
  code ? (banks?.find((b) => b.code === code.replace(/^0+(?=\d)/, '')) ?? null) : null;
