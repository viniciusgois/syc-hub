import React, { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { todayIso } from '../../lib/entries';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';
import { MoneyInput } from '../common/MoneyInput';

/** Nova transferência entre contas da empresa (fica fora do resultado: DRE e Painel) */
export const TransferModal: React.FC<{ defaultFromId?: string; onClose: () => void; onDone: () => void }> = ({ defaultFromId, onClose, onDone }) => {
  const { currentCompany, accounts, notify, refreshLedger } = useCompany();
  const [fromId, setFromId] = useState(defaultFromId ?? '');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!fromId || !toId) return setError('Escolha a conta de origem e a de destino');
    if (fromId === toId) return setError('Escolha contas diferentes');
    if (amount <= 0) return setError('Informe o valor');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${currentCompany.id}/transactions/transfer`, { fromAccountId: fromId, toAccountId: toId, amount, date, description: description || null });
      await refreshLedger();
      notify('Transferência registrada');
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const accountSelect = (id: string, value: string, onChange: (v: string) => void) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass()} ${value ? '' : 'text-slate-400'}`}>
      <option value="">Selecione uma conta</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <Modal
      title="Nova transferência"
      onClose={onClose}
      busy={busy}
      width="max-w-xl"
      footer={
        <>
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
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div>
            <label htmlFor="tr-from" className="block text-sm font-medium text-slate-800 mb-1.5">
              Sai de
            </label>
            {accountSelect('tr-from', fromId, setFromId)}
          </div>
          <ArrowRight className="w-5 h-5 text-slate-400 mb-2.5" />
          <div>
            <label htmlFor="tr-to" className="block text-sm font-medium text-slate-800 mb-1.5">
              Entra em
            </label>
            {accountSelect('tr-to', toId, setToId)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="tr-amount" className="block text-sm font-medium text-slate-800 mb-1.5">
              Valor
            </label>
            <MoneyInput id="tr-amount" value={amount} onChange={setAmount} allowNegative={false} />
          </div>
          <div>
            <label htmlFor="tr-date" className="block text-sm font-medium text-slate-800 mb-1.5">
              Data
            </label>
            <input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass()} />
          </div>
        </div>
        <div>
          <label htmlFor="tr-desc" className="block text-sm font-medium text-slate-800 mb-1.5">
            Descrição <span className="italic font-normal text-xs text-slate-400">(opcional)</span>
          </label>
          <input id="tr-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Aplicação na reserva" className={fieldClass()} />
        </div>
        <p className="text-xs text-slate-500">
          A transferência entra no extrato das duas contas e não conta como receita nem despesa. Quando o extrato do banco for importado, as linhas iguais são
          reconhecidas e não duplicam.
        </p>
      </div>
    </Modal>
  );
};
