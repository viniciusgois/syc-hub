import React, { useState } from 'react';
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { BankAccount } from '../../types';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';
import { MoneyInput } from '../common/MoneyInput';

/** Editar os dados da conta (lápis ao lado do nome) e arquivar/reativar */
export const EditAccountModal: React.FC<{ account: BankAccount; onClose: () => void }> = ({ account, onClose }) => {
  const { currentCompany, notify, refreshLedger } = useCompany();
  const [form, setForm] = useState({
    name: account.name,
    agency: account.agency ?? '',
    accountNumber: account.accountNumber ?? '',
    accountDigit: account.accountDigit ?? '',
    initialBalance: account.initialBalance,
    initialBalanceDate: (account.initialBalanceDate ?? '').slice(0, 10),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const archived = account.isActive === false;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const send = async (body: Record<string, unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/companies/${currentCompany.id}/bank-accounts/${account.id}`, body);
      await refreshLedger();
      notify(message);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!form.name.trim()) return setError('Informe o nome da conta');
    send({ ...form, initialBalanceDate: form.initialBalanceDate || undefined }, 'Conta atualizada');
  };

  return (
    <Modal
      title="Editar conta"
      onClose={onClose}
      busy={busy}
      width="max-w-xl"
      footer={
        <>
          <button
            type="button"
            onClick={() => send({ isActive: archived }, archived ? 'Conta reativada' : 'Conta arquivada')}
            disabled={busy}
            className="mr-auto text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1.5 disabled:opacity-50"
          >
            {archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
            {archived ? 'Reativar conta' : 'Arquivar conta'}
          </button>
          <LinkButton onClick={onClose} disabled={busy}>
            Cancelar
          </LinkButton>
          <PrimaryButton onClick={save} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="ea-name" className="block text-sm font-medium text-slate-800 mb-1.5">
            Nome da conta
          </label>
          <input id="ea-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass()} />
        </div>
        {account.type !== 'CASH' && (
          <div className="grid grid-cols-[1fr_1.5fr_80px] gap-3">
            <div>
              <label htmlFor="ea-agency" className="block text-sm font-medium text-slate-800 mb-1.5">
                Agência
              </label>
              <input id="ea-agency" value={form.agency} onChange={(e) => set('agency', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <label htmlFor="ea-number" className="block text-sm font-medium text-slate-800 mb-1.5">
                Conta
              </label>
              <input id="ea-number" value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} className={fieldClass()} />
            </div>
            <div>
              <label htmlFor="ea-digit" className="block text-sm font-medium text-slate-800 mb-1.5">
                Dígito
              </label>
              <input id="ea-digit" value={form.accountDigit} onChange={(e) => set('accountDigit', e.target.value)} className={fieldClass()} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ea-balance" className="block text-sm font-medium text-slate-800 mb-1.5">
              Saldo inicial
            </label>
            <MoneyInput id="ea-balance" value={form.initialBalance} onChange={(v) => set('initialBalance', v)} />
          </div>
          <div>
            <label htmlFor="ea-balance-date" className="block text-sm font-medium text-slate-800 mb-1.5">
              Data do saldo inicial
            </label>
            <input id="ea-balance-date" type="date" value={form.initialBalanceDate} onChange={(e) => set('initialBalanceDate', e.target.value)} className={fieldClass()} />
          </div>
        </div>
        <p className="text-xs text-slate-500">Conta arquivada sai da lista e dos totais, mas o histórico continua nos relatórios. Dá para reativar em "Ver arquivadas".</p>
      </div>
    </Modal>
  );
};
