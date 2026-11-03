import { useEffect, useState } from 'react';
import { useCompany } from '../../context/CompanyContext';
import { api } from '../../lib/api';

export interface CostCenterOption {
  id: string;
  name: string;
}

/** Centros de custo ativos (vazio quando desabilitados em Configurações) */
export function useCostCenters(active = true) {
  const { currentCompany } = useCompany();
  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);
  useEffect(() => {
    if (!active || !currentCompany.costCentersEnabled) {
      setCostCenters([]);
      return;
    }
    let cancelled = false;
    api
      .get<(CostCenterOption & { isActive: boolean })[]>(`/companies/${currentCompany.id}/cost-centers`)
      .then((list) => !cancelled && setCostCenters(list.filter((c) => c.isActive)))
      .catch(() => !cancelled && setCostCenters([]));
    return () => {
      cancelled = true;
    };
  }, [active, currentCompany.id, currentCompany.costCentersEnabled]);
  return costCenters;
}
