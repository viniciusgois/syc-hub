import { ContactType } from '../types';

export interface ContactSection {
  module: string; // id do módulo na navegação
  type: ContactType;
  title: string; // "Clientes"
  singular: string; // "cliente"
  newLabel: string; // "Novo cliente"
  editLabel: string;
  upcomingTitle: string;
  recentTitle: string;
}

export const CONTACT_SECTIONS: ContactSection[] = [
  {
    module: 'clientes',
    type: 'CUSTOMER',
    title: 'Clientes',
    singular: 'cliente',
    newLabel: 'Novo cliente',
    editLabel: 'Editar cliente',
    upcomingTitle: 'Próximas contas a receber',
    recentTitle: 'Últimas contas recebidas',
  },
  {
    module: 'fornecedores',
    type: 'SUPPLIER',
    title: 'Fornecedores',
    singular: 'fornecedor',
    newLabel: 'Novo fornecedor',
    editLabel: 'Editar fornecedor',
    upcomingTitle: 'Próximas contas a pagar',
    recentTitle: 'Últimas contas pagas',
  },
  {
    module: 'funcionarios',
    type: 'EMPLOYEE',
    title: 'Funcionários',
    singular: 'funcionário',
    newLabel: 'Novo funcionário',
    editLabel: 'Editar funcionário',
    upcomingTitle: 'Próximas contas a pagar',
    recentTitle: 'Últimas contas pagas',
  },
  {
    module: 'socios',
    type: 'PARTNER',
    title: 'Sócios',
    singular: 'sócio',
    newLabel: 'Novo sócio',
    editLabel: 'Editar sócio',
    upcomingTitle: 'Próximas contas a pagar',
    recentTitle: 'Últimas movimentações',
  },
];

export const contactSectionFor = (module: string) => CONTACT_SECTIONS.find((s) => s.module === module);

export const PIX_KEY_TYPES = [
  { value: 'CPF', label: 'CPF' },
  { value: 'CNPJ', label: 'CNPJ' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'PHONE', label: 'Telefone' },
  { value: 'RANDOM', label: 'Chave aleatória' },
] as const;
