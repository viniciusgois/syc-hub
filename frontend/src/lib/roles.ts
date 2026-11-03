import { UserRole } from '../types';

export const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  FINANCIAL_OPERATOR: 'Operador financeiro',
  CONSULTANT: 'Consultor',
  VIEWER: 'Somente leitura',
};
