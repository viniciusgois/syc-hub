import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Mail, MoreVertical, Plus, Search } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { formatDocument, onlyDigits } from '../../lib/documents';
import { Company } from '../../types';
import { CreateCompanyModal } from './CreateCompanyModal';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';

const isAdmin = (c: Company) => c.role === 'ADMIN' || c.role === 'OWNER';

/** SYC Empresas: todas as empresas que o usuário acessa, em cards (como o "Nibo Empresa") */
export const CompaniesView: React.FC = () => {
  const { companies, currentCompany, setCurrentCompanyId, setActiveModule, addCompany, removeCompany, notify } = useCompany();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Company | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuFor) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuFor]);

  const term = search.trim().toLowerCase();
  const digits = onlyDigits(term);
  const list = companies.filter(
    (c) => !term || c.legalName.toLowerCase().includes(term) || c.tradeName.toLowerCase().includes(term) || (digits !== '' && c.cnpj.includes(digits)),
  );

  const open = (c: Company, module = 'resumo') => {
    setCurrentCompanyId(c.id);
    setActiveModule(module);
  };

  const startDelete = (c: Company) => {
    setMenuFor(null);
    setConfirm('');
    setDeleteError(null);
    setToDelete(c);
  };

  const runDelete = async () => {
    if (!toDelete) return;
    const isPJ = toDelete.personType !== 'NATURAL';
    if (onlyDigits(confirm) !== toDelete.cnpj) {
      setDeleteError(`Digite ${isPJ ? 'o CNPJ' : 'o CPF'} ${formatDocument(toDelete.cnpj)} para confirmar`);
      return;
    }
    setBusy(true);
    setDeleteError(null);
    try {
      await api.delete(`/companies/${toDelete.id}`, { confirm });
      notify(`Empresa ${toDelete.legalName} excluída`);
      removeCompany(toDelete.id, { keepModule: true });
      setToDelete(null);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <h1 className="text-lg font-medium text-slate-800">Minhas empresas</h1>
        <div className="relative w-full max-w-xs order-last md:order-none">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar em Minhas empresas..."
            aria-label="Buscar em Minhas empresas"
            className="w-full text-xs pl-4 pr-8 py-2 rounded-full bg-slate-100 border border-transparent focus:outline-none focus:border-blue-400 focus:bg-white text-slate-700 placeholder-slate-400"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-2.5" />
        </div>
        <div className="flex items-center gap-2">
          {isAdmin(currentCompany) && (
            <button
              type="button"
              onClick={() => setActiveModule('config-usuarios')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
              title={`Convidar usuários para ${currentCompany.legalName}`}
            >
              <Mail className="w-3.5 h-3.5" /> Convidar usuários
            </button>
          )}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar empresa
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">Nenhuma empresa encontrada para “{search}”.</p>
      ) : (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => (
            <div
              key={c.id}
              className={`relative rounded bg-slate-50 shadow-sm border hover:shadow-md transition-shadow ${
                c.id === currentCompany.id ? 'border-blue-300' : 'border-slate-200/80'
              }`}
            >
              <button type="button" onClick={() => open(c)} className="w-full text-left px-4 pt-4 pb-8 pr-10">
                <span className="block text-sm font-medium text-blue-600 uppercase truncate" title={c.legalName}>
                  {c.legalName}
                </span>
                <span className="block text-xs text-slate-500 mt-1">{formatDocument(c.cnpj)}</span>
              </button>
              <div className="absolute top-3 right-2" ref={menuFor === c.id ? menuRef : undefined}>
                <button
                  type="button"
                  onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                  aria-label={`Opções de ${c.legalName}`}
                  aria-expanded={menuFor === c.id}
                  className="p-1 rounded text-slate-500 hover:bg-slate-200"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {menuFor === c.id && (
                  <div className="absolute right-0 mt-1 w-48 bg-white rounded-md border border-slate-200 shadow-lg py-1 z-20 text-xs text-slate-700">
                    <button type="button" onClick={() => open(c)} className="w-full text-left px-3 py-2 hover:bg-slate-50">
                      Acessar
                    </button>
                    {isAdmin(c) && (
                      <button type="button" onClick={() => open(c, 'config-empresa')} className="w-full text-left px-3 py-2 hover:bg-slate-50">
                        Editar dados da empresa
                      </button>
                    )}
                    {c.role === 'OWNER' && (
                      <button type="button" onClick={() => startDelete(c)} className="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50">
                        Excluir empresa
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateCompanyModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(company) => {
          addCompany(company);
          notify(`Empresa ${company.legalName} criada`);
        }}
      />

      {toDelete && (
        <Modal
          title="Excluir a empresa"
          onClose={() => setToDelete(null)}
          busy={busy}
          footer={
            <>
              <LinkButton onClick={() => setToDelete(null)}>Cancelar</LinkButton>
              <PrimaryButton className="bg-rose-600 hover:bg-rose-700" onClick={runDelete} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Excluir empresa
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-4 text-sm text-slate-700">
            <p>
              Exclui <strong>{toDelete.legalName}</strong> e <strong>todos os seus dados</strong> (contas, lançamentos, contatos, plano de contas...). Esta ação não pode ser
              desfeita.
            </p>
            <div>
              <label htmlFor="company-delete-confirm" className="block font-medium text-slate-800 mb-1.5">
                Para confirmar, digite {toDelete.personType !== 'NATURAL' ? 'o CNPJ' : 'o CPF'} {formatDocument(toDelete.cnpj)}
              </label>
              <input
                id="company-delete-confirm"
                autoFocus
                value={confirm}
                onChange={(e) => (setConfirm(e.target.value), setDeleteError(null))}
                inputMode="numeric"
                className={`${fieldClass(deleteError ?? undefined)} font-mono`}
              />
              {deleteError && <p className="text-xs text-rose-600 mt-1">{deleteError}</p>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
