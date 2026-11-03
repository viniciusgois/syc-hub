import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export interface Municipio {
  id: string; // código IBGE
  name: string;
}

export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const cache = new Map<string, Municipio[]>();

/** Municípios da UF (IBGE), com cache por sessão */
export function useMunicipios(uf: string) {
  const [list, setList] = useState<Municipio[]>(() => cache.get(uf) ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!uf) {
      setList([]);
      return;
    }
    const cached = cache.get(uf);
    if (cached) {
      setList(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<Municipio[]>(`/lookup/municipios/${uf}`)
      .then((data) => {
        cache.set(uf, data);
        if (!cancelled) setList(data);
      })
      .catch(() => !cancelled && setList([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uf]);

  return { municipios: list, loading };
}
