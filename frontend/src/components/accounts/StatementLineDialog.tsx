import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { brDate, categoryOptions, money } from '../../lib/entries';
import { ApiTransaction, toTransaction } from '../../lib/transactions';
import { Transaction } from '../../types';
import { LinkButton, Modal, PrimaryButton } from '../common/Modal';
import { SearchSelect } from '../common/SearchSelect';
import { useCostCenters } from '../common/useCostCenters';
import { ContactField } from '../entries/ContactField';
import { SplitTransactionDialog } from '../reconciliation/SplitTransactionDialog';

type Line = ApiTransaction & {
  notes: string | null;
  costCenterId: string | null;
  bankAccount: { id: string; name: string };
  transferAccount: { id: string; name: string } | null;
};

const inputClass =
  'w-full h-10 px-3 rounded border border-slate-300 text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight disabled:bg-slate-50 disabled:text-slate-500';

const Label: React.FC<{ htmlFor?: string; children: React.ReactNode; optional?: boolean }> = ({ htmlFor, children, optional }) => (
  <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800 mb-1.5">
    {children} {optional && <span className="italic font-normal text-slate-400">(opcional)</span>}
  </label>
);

/**
 * Linha do extrato sem conta a pagar/receber vinculada (categorizada direto na Conciliação, ou transferência):
 * mostra os dados do banco (fixos) e permite editar nome, descrição, categoria, centro de custo e observações.
 */
export const StatementLineDialog: React.FC<{ transactionId: string; onClose: () => void }> = ({ transactionId, onClose }) => {
  const { currentCompany, categories, can, notify, refreshLedger } = useCompany();
  const costCenters = useCostCenters();
  const canEdit = can('FINANCIAL_OPERATOR');
  const [line, setLine] = useState<Line | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ contactId: '', customDescription: '', categoryId: '', costCenterId: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [splitting, setSplitting] = useState<Transaction | null>(null);
  const path = `/companies/${currentCompany.id}/transactions/${transactionId}`;

  useEffect(() => {
    let cancelled = false;
    api
      .get<Line>(path)
      .then((t) => {
        if (cancelled) return;
        setLine(t);
        setForm({
          contactId: t.contactId ?? '',
          customDescription: t.customDescription ?? '',
          categoryId: t.categoryId ?? '',
          costCenterId: t.costCenterId ?? '',
          notes: t.notes ?? '',
        });
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [path]);

  const credit = line?.type === 'CREDIT';
  const catOptions = useMemo(() => categoryOptions(categories, credit ? 'INCOME' : 'EXPENSE'), [categories, credit]);
  const splitCount = line?.splits?.length ?? 0;
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!line) return;
    setBusy(true);
    try {
      await api.patch(path, {
        customDescription: form.customDescription.trim() || null,
        notes: form.notes.trim() || null,
        ...(!line.isTransfer && {
          contactId: form.contactId || null,
          ...(splitCount < 2 && { categoryId: form.categoryId || null, costCenterId: form.costCenterId || null }),
        }),
      });
      notify('Lançamento atualizado');
      await refreshLedger();
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (splitting) return <SplitTransactionDialog tx={splitting} onClose={onClose} />;

  return (
    <Modal
      title={line?.isTransfer ? 'Transferência entre contas' : 'Lançamento do extrato'}
      onClose={onClose}
      busy={busy}
      width="max-w-2xl"
      footer={
        <>
          <LinkButton type="button" onClick={onClose} disabled={busy}>
            {canEdit ? 'Cancelar' : 'Fechar'}
          </LinkButton>
          {canEdit && (
            <PrimaryButton type="button" onClick={save} disabled={busy || !line}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </PrimaryButton>
          )}
        </>
      }
    >
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!line && !error && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </p>
      )}
      {line && (
        <div className="space-y-5">
          {/* Dados do banco: não mudam (vêm do extrato) */}
          <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500">Data</p>
              <p className="text-slate-800">{brDate(line.date)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500">Conta</p>
              <p className="text-slate-800 truncate">{line.bankAccount.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{credit ? 'Entrada' : 'Saída'}</p>
              <p className={`flex items-center gap-1 font-medium ${credit ? 'text-emerald-700' : 'text-rose-600'}`}>
                {credit ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />} {money(Number(line.amount))}
              </p>
            </div>
            {line.isTransfer && (
              <div className="min-w-0">
                <p className="text-xs text-slate-500">{credit ? 'Veio da conta' : 'Foi para a conta'}</p>
                <p className="text-slate-800 truncate flex items-center gap-1">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-slate-400 shrink-0" /> {line.transferAccount?.name ?? '—'}
                </p>
              </div>
            )}
            <div className="col-span-2 sm:col-span-4 min-w-0">
              <p className="text-xs text-slate-500">Descrição no banco</p>
              <p className="text-slate-800 break-words">{line.description}</p>
            </div>
          </div>

          {!line.isTransfer && (
            <div>
              <Label>Nome</Label>
              {canEdit ? (
                <ContactField value={form.contactId} onChange={(v) => set('contactId', v)} direction={credit ? 'RECEIVABLE' : 'PAYABLE'} />
              ) : (
                <input className={inputClass} disabled value={form.contactId ? 'Contato vinculado' : ''} />
              )}
            </div>
          )}

          <div>
            <Label htmlFor="sl-desc" optional>
              Descrição
            </Label>
            <input
              id="sl-desc"
              value={form.customDescription}
              onChange={(e) => set('customDescription', e.target.value)}
              placeholder={line.description}
              disabled={!canEdit}
              className={inputClass}
            />
          </div>

          {!line.isTransfer && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="sl-cat">Categoria</Label>
                {splitCount > 1 ? (
                  <p id="sl-cat" className="h-10 px-3 flex items-center rounded border border-slate-200 bg-slate-50 text-sm text-slate-600">
                    Rateio em {splitCount} categorias
                  </p>
                ) : (
                  <SearchSelect id="sl-cat" value={form.categoryId} onChange={(v) => set('categoryId', v)} options={catOptions} placeholder="Selecione uma categoria..." />
                )}
                {canEdit && currentCompany.splitsEnabled && (
                  <button
                    type="button"
                    onClick={() => setSplitting(toTransaction(line))}
                    className="mt-1 text-xs text-nibo-blue hover:underline"
                  >
                    {splitCount > 1 ? 'Editar rateio' : 'Ratear entre categorias'}
                  </button>
                )}
              </div>
              {splitCount < 2 && costCenters.length > 0 && (
                <div>
                  <Label htmlFor="sl-cc" optional>
                    Centro de custo
                  </Label>
                  <select id="sl-cc" value={form.costCenterId} onChange={(e) => set('costCenterId', e.target.value)} disabled={!canEdit} className={inputClass}>
                    <option value="">Sem centro de custo</option>
                    {costCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="sl-notes" optional>
              Observações
            </Label>
            <textarea
              id="sl-notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              disabled={!canEdit}
              rows={2}
              className={`${inputClass} h-auto py-2`}
            />
          </div>

          {line.isTransfer && (
            <p className="text-xs text-slate-500">
              Para trocar as contas ou o valor, desfaça a transferência (ícone ↺ no extrato) e lance de novo.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
};
