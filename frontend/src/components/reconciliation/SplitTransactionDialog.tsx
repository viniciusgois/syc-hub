import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { SplitDraft, draftFromSplits, resolveSplit, signOf, splitError, splitPayload, startSplit } from '../../lib/splits';
import { Transaction } from '../../types';
import { Modal, LinkButton, PrimaryButton } from '../common/Modal';
import { SplitEditor } from '../common/SplitEditor';
import { useCostCenters } from '../common/useCostCenters';

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rateio de uma linha do extrato categorizada direto (sem conta a pagar/receber vinculada) */
export const SplitTransactionDialog: React.FC<{ tx: Transaction; onClose: () => void }> = ({ tx, onClose }) => {
  const { currentCompany, categories, notify, refreshLedger } = useCompany();
  const costCenters = useCostCenters();
  const nature = tx.type === 'CREDIT' ? 'INCOME' : 'EXPENSE';
  const [draft, setDraft] = useState<SplitDraft>(() =>
    tx.splits?.length ? draftFromSplits(tx.splits, tx.amount) : startSplit(tx.amount, tx.categoryId ?? tx.suggestedCategoryId ?? '', tx.costCenterId ?? ''),
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const sign = (id: string) => signOf(categories, id, nature);
  const lines = resolveSplit(draft, tx.amount, sign);
  const error = splitError(lines, tx.amount, sign);
  const path = `/companies/${currentCompany.id}/transactions/${tx.id}`;

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      notify(message);
      await refreshLedger();
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    setSubmitted(true);
    if (error) return;
    run(() => api.post(`${path}/reconcile`, { splits: splitPayload(lines) }), 'Linha rateada e conciliada');
  };

  return (
    <Modal
      title="Ratear linha do extrato"
      onClose={onClose}
      busy={busy}
      width="max-w-4xl"
      footer={
        <>
          {!!tx.splits?.length && (
            <LinkButton type="button" onClick={() => run(() => api.patch(path, { splits: null }), 'Rateio removido')} disabled={busy} className="mr-auto">
              Remover rateio
            </LinkButton>
          )}
          <LinkButton type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </LinkButton>
          <PrimaryButton type="button" onClick={save} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar e conciliar
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600 truncate">
            {tx.date.split('-').reverse().join('/')} · {tx.customDescription || tx.description}
          </span>
          <strong className={tx.type === 'CREDIT' ? 'text-emerald-600' : 'text-rose-600'}>
            {tx.type === 'CREDIT' ? '+' : '−'} R$ {money(tx.amount)}
          </strong>
        </div>
        <SplitEditor draft={draft} onChange={setDraft} total={tx.amount} nature={nature} costCenters={costCenters} error={submitted ? error : null} />
      </div>
    </Modal>
  );
};
