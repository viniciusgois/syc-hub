import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2, Plus, Ban, CheckCircle2, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { Company } from '../../types';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';

interface CostCenter {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
}

export const CostCentersSettings: React.FC = () => {
  const { currentCompany, notify, updateCompany } = useCompany();
  const base = `/companies/${currentCompany.id}/cost-centers`;
  const [list, setList] = useState<CostCenter[] | null>(null);
  const [form, setForm] = useState<{ id?: string; name: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CostCenter | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await api.get<CostCenter[]>(base)).filter((c) => c.isActive));
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }, [base, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) return setFormError('Informe o nome');
    if (list?.some((c) => c.id !== form.id && c.name.toLowerCase() === name.toLowerCase())) return setFormError('Já existe um centro de custo com esse nome');
    setBusy(true);
    try {
      if (form.id) await api.patch(`${base}/${form.id}`, { name });
      else await api.post(base, { name });
      notify(form.id ? 'Centro de custo atualizado' : 'Centro de custo criado');
      setForm(null);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CostCenter) => {
    setBusy(true);
    try {
      const res = await api.delete<{ archived?: boolean }>(`${base}/${c.id}`);
      notify(res?.archived ? `"${c.name}" está em uso: foi arquivado (mantém o histórico)` : `"${c.name}" excluído`);
      setConfirmDelete(null);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    try {
      updateCompany(await api.patch<Company>(`/companies/${currentCompany.id}`, { costCentersEnabled: enabled }));
      notify(enabled ? 'Centros de custo habilitados' : 'Centros de custo desabilitados');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  if (!currentCompany.costCentersEnabled) {
    return (
      <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
        <h1 className="text-xl font-medium text-slate-700 mb-4">Centros de custo</h1>
        <div className="max-w-xl p-5 rounded border border-slate-200 bg-slate-50">
          <p className="text-sm text-slate-700">Os centros de custo estão desabilitados para esta empresa: o campo não aparece nos lançamentos.</p>
          <button onClick={() => setEnabled(true)} className="mt-3 text-sm text-nibo-blue hover:underline flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Habilitar centros de custo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-medium text-slate-700">Centros de custo</h1>
        <button
          onClick={() => {
            setFormError(null);
            setForm({ name: '' });
          }}
          className="flex items-center gap-1.5 px-4 h-9 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Criar novo centro de custo
        </button>
      </div>

      {!list && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </p>
      )}
      {list?.length === 0 && <p className="text-sm text-slate-500 py-4">Nenhum centro de custo. Use-os para separar resultados por loja, projeto, cliente ou área.</p>}
      <ul className="border-t border-slate-100">
        {list?.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-2 border-b border-slate-100 text-sm hover:bg-slate-50">
            <span>{c.name}</span>
            <span className="flex items-center gap-1">
              <button onClick={() => (setFormError(null), setForm({ id: c.id, name: c.name }))} aria-label={`Editar ${c.name}`} className="p-1.5 rounded text-nibo-blue hover:bg-nibo-blueLight">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => setConfirmDelete(c)} aria-label={`Excluir ${c.name}`} className="p-1.5 rounded text-nibo-blue hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-10 pt-5 border-t border-slate-200">
        <button onClick={() => setEnabled(false)} className="text-sm text-nibo-blue hover:underline flex items-center gap-1.5">
          <Ban className="w-4 h-4" /> Desabilitar centros de custo
        </button>
      </div>

      {form && (
        <Modal
          title={form.id ? 'Editar centro de custo' : 'Novo centro de custo'}
          onClose={() => setForm(null)}
          busy={busy}
          footer={
            <>
              <LinkButton onClick={() => setForm(null)}>Cancelar</LinkButton>
              <PrimaryButton onClick={save} disabled={busy}>
                Salvar
              </PrimaryButton>
            </>
          }
        >
          <label htmlFor="cc-name" className="block text-sm font-medium text-slate-800 mb-1.5">
            Nome
          </label>
          <input
            id="cc-name"
            autoFocus
            value={form.name}
            maxLength={80}
            onChange={(e) => (setForm({ ...form, name: e.target.value }), setFormError(null))}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className={fieldClass(formError ?? undefined)}
          />
          {formError && <p className="text-xs text-rose-600 mt-1">{formError}</p>}
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="Excluir centro de custo"
          onClose={() => setConfirmDelete(null)}
          busy={busy}
          footer={
            <>
              <LinkButton onClick={() => setConfirmDelete(null)}>Cancelar</LinkButton>
              <PrimaryButton onClick={() => remove(confirmDelete)} disabled={busy} className="bg-rose-600 hover:bg-rose-700">
                Excluir
              </PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-slate-700">Excluir "{confirmDelete.name}"? Se já foi usado em lançamentos, ele é arquivado e o histórico é mantido.</p>
        </Modal>
      )}
    </div>
  );
};
