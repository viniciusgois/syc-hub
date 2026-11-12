import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { EntryDirection, contactOptions } from '../../lib/entries';
import { ContactType } from '../../types';
import { SearchSelect } from '../common/SearchSelect';

/** Tipos oferecidos no cadastro rápido (como no NIBO); o primeiro vem selecionado */
const QUICK_TYPES: Record<EntryDirection, { value: ContactType; label: string }[]> = {
  PAYABLE: [
    { value: 'SUPPLIER', label: 'Fornecedor' },
    { value: 'EMPLOYEE', label: 'Funcionário' },
    { value: 'PARTNER', label: 'Sócio' },
  ],
  RECEIVABLE: [
    { value: 'CUSTOMER', label: 'Cliente' },
    { value: 'PARTNER', label: 'Sócio' },
    { value: 'OTHER', label: 'Outros' },
  ],
};

/**
 * Campo "Nome" de pagamentos/recebimentos: lista de contatos com "-- Criar novo --".
 * O cadastro rápido (tipo + nome) abre logo abaixo do campo e, ao criar, já seleciona o contato
 * sem perder o restante do lançamento. Os demais dados ficam para a tela de Contatos.
 */
export const ContactField: React.FC<{
  id?: string;
  value: string;
  onChange: (contactId: string) => void;
  direction: EntryDirection;
  error?: string;
}> = ({ id, value, onChange, direction, error }) => {
  const { currentCompany, contacts, reloadContacts, notify, can } = useCompany();
  const types = QUICK_TYPES[direction];
  const options = useMemo(() => contactOptions(contacts, direction), [contacts, direction]);
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<ContactType>(types[0].value);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  const startCreate = (query: string) => {
    setType(types[0].value);
    setName(query);
    setCreateError(null);
    setCreating(true);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Informe o nome do contato');
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setCreateError(null);
    try {
      const created = await api.post<{ id: string; name: string }>(`/companies/${currentCompany.id}/contacts`, {
        type,
        personType: type === 'EMPLOYEE' || type === 'PARTNER' ? 'NATURAL' : 'LEGAL',
        name: trimmed,
      });
      await reloadContacts();
      onChange(created.id);
      setCreating(false);
      notify(`Contato ${created.name} cadastrado`);
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Esc fecha só o cadastro rápido (o painel do lançamento continua aberto)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) setCreating(false);
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="relative">
      <SearchSelect
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder="Selecione um contato..."
        emptyText="Nenhum contato encontrado"
        error={error}
        clearable
        onCreate={can('FINANCIAL_OPERATOR') ? startCreate : undefined}
      />
      {creating && (
        <div
          role="dialog"
          aria-label="Novo contato"
          onKeyDown={onKeyDown}
          className="absolute z-40 left-0 mt-2 w-full min-w-[260px] bg-white border border-slate-200 rounded shadow-xl"
        >
          <span className="absolute -top-1.5 left-1/2 w-3 h-3 bg-white border-l border-t border-slate-200 rotate-45" />
          <div className="px-3 py-2.5 flex items-center justify-between border-b border-slate-100">
            <span className="text-sm text-slate-800">Novo contato</span>
            <button type="button" onClick={() => setCreating(false)} disabled={busy} aria-label="Fechar cadastro de contato" className="p-0.5 text-slate-500 hover:text-slate-800">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-3 py-3 space-y-3">
            <div>
              <label htmlFor={`${id ?? 'contact'}-new-type`} className="block text-sm text-slate-800 mb-1">
                Tipo de contato
              </label>
              <select
                id={`${id ?? 'contact'}-new-type`}
                value={type}
                onChange={(e) => setType(e.target.value as ContactType)}
                className="w-full h-9 px-2 rounded border border-slate-300 text-sm bg-white focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight"
              >
                {types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id ?? 'contact'}-new-name`} className="block text-sm text-slate-800 mb-1">
                Nome
              </label>
              <input
                ref={nameRef}
                id={`${id ?? 'contact'}-new-name`}
                value={name}
                onChange={(e) => (setName(e.target.value), setCreateError(null))}
                placeholder="Digite o nome do contato..."
                className={`w-full h-9 px-2 rounded border text-sm focus:outline-none focus:ring-2 ${
                  createError ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
                }`}
              />
              {createError && <p className="text-xs text-rose-600 mt-1">{createError}</p>}
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={submit} disabled={busy} className="flex items-center gap-1.5 text-sm text-nibo-blue hover:underline disabled:opacity-60">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
