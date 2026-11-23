import React, { useState } from 'react';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { Company } from '../../types';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';

/**
 * Lembrete no topo das telas da empresa enquanto a data de início do contrato não estiver cadastrada
 * (mesmo estilo do aviso de movimentos anteriores ao saldo inicial). Só para quem pode editar a empresa.
 */
export const ContractStartBanner: React.FC = () => {
  const { currentCompany, can, updateCompany, notify } = useCompany();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (currentCompany.contractStartDate || !can('ADMIN')) return null;

  const save = async () => {
    if (!date) {
      setError('Informe a data');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<Company>(`/companies/${currentCompany.id}`, { contractStartDate: date });
      updateCompany(updated);
      notify('Data de início do contrato cadastrada');
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div role="status" className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3 shrink-0 print:hidden">
        <span className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 shrink-0" />
          <span>
            A <strong>data de início do contrato</strong> de {currentCompany.legalName} ainda não foi cadastrada.
          </span>
        </span>
        <button type="button" onClick={() => (setDate(''), setError(null), setOpen(true))} className="text-sm text-nibo-blue hover:underline">
          Cadastrar data de início do contrato
        </button>
      </div>

      {open && (
        <Modal
          title="Início do contrato"
          onClose={() => setOpen(false)}
          busy={busy}
          width="max-w-sm"
          footer={
            <>
              <LinkButton type="button" onClick={() => setOpen(false)} disabled={busy}>
                Cancelar
              </LinkButton>
              <PrimaryButton type="button" onClick={save} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </PrimaryButton>
            </>
          }
        >
          <label htmlFor="contract-start" className="block text-sm font-medium text-slate-800 mb-1.5">
            Data de início do contrato de {currentCompany.legalName}
          </label>
          <input
            id="contract-start"
            type="date"
            autoFocus
            value={date}
            onChange={(e) => (setDate(e.target.value), setError(null))}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className={fieldClass(error ?? undefined)}
          />
          {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
          <p className="text-xs text-slate-500 mt-3">Também pode ser alterada depois em Configurações → Empresa.</p>
        </Modal>
      )}
    </>
  );
};
