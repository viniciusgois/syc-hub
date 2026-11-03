import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { categoryChoices } from '../../lib/categories';
import { contactOptions } from '../../lib/entries';
import { Transaction } from '../../types';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';
import { SearchSelect } from '../common/SearchSelect';

/** Texto da regra sugerido a partir da descrição do extrato (sem números variáveis no fim) */
const patternFrom = (description: string) =>
  description
    .replace(/\s+/g, ' ')
    .replace(/[\s\-/]*\d[\d\s./-]*$/, '')
    .trim()
    .slice(0, 60);

/** "+ Criar regra" da Conciliação: cria a regra e já aplica nas movimentações em aberto da conta */
export const QuickRuleModal: React.FC<{ tx: Transaction; onClose: () => void; onDone: () => void }> = ({ tx, onClose, onDone }) => {
  const { currentCompany, categories, contacts, notify } = useCompany();
  const isCredit = tx.type === 'CREDIT';
  const pattern0 = patternFrom(tx.description) || tx.description;
  const [form, setForm] = useState({ name: pattern0.slice(0, 40), pattern: pattern0, categoryId: tx.guess?.categoryId ?? '', contactId: tx.guess?.contactId ?? '', autoReconcile: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const catOptions = useMemo(
    () => categoryChoices(categories, isCredit ? 'INCOME' : 'EXPENSE').map((o) => ({ value: o.value, label: o.label, group: o.group })),
    [categories, isCredit],
  );
  const contOptions = useMemo(() => contactOptions(contacts, isCredit ? 'RECEIVABLE' : 'PAYABLE'), [contacts, isCredit]);

  const save = async () => {
    if (!form.name.trim()) return setError('Informe o nome da regra');
    if (!form.pattern.trim()) return setError('Informe o texto a procurar');
    if (!form.categoryId) return setError('Selecione a categoria');
    setBusy(true);
    setError(null);
    try {
      const base = `/companies/${currentCompany.id}/rules`;
      await api.post(base, {
        name: form.name.trim(),
        matchType: 'CONTAINS',
        pattern: form.pattern.trim(),
        targetCategoryId: form.categoryId,
        targetContactId: form.contactId || null,
        autoReconcile: form.autoReconcile,
      });
      const applied = await api.post<{ matched: number }>(`${base}/apply`, { bankAccountId: tx.bankAccountId });
      notify(applied.matched ? `Regra criada e aplicada em ${applied.matched} movimentação(ões)` : 'Regra criada');
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Criar regra"
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
            Criar regra
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
        <p className="text-xs text-slate-500 px-3 py-2 rounded bg-slate-50 border border-slate-200">Extrato: {tx.description}</p>
        <div>
          <label htmlFor="qr-name" className="block text-sm font-medium text-slate-800 mb-1.5">
            Nome da regra
          </label>
          <input id="qr-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={fieldClass()} />
        </div>
        <div>
          <label htmlFor="qr-pattern" className="block text-sm font-medium text-slate-800 mb-1.5">
            Quando a descrição contém
          </label>
          <input id="qr-pattern" value={form.pattern} onChange={(e) => set('pattern', e.target.value)} className={`${fieldClass()} font-mono`} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="qr-cat" className="block text-sm font-medium text-slate-800 mb-1.5">
              Categoria
            </label>
            <SearchSelect id="qr-cat" value={form.categoryId} onChange={(v) => set('categoryId', v)} options={catOptions} placeholder="Selecione..." />
          </div>
          <div>
            <label htmlFor="qr-contact" className="block text-sm font-medium text-slate-800 mb-1.5">
              Nome <span className="italic font-normal text-xs text-slate-400">(opcional)</span>
            </label>
            <SearchSelect id="qr-contact" value={form.contactId} onChange={(v) => set('contactId', v)} options={contOptions} placeholder="Selecione..." clearable />
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={form.autoReconcile} onChange={(e) => set('autoReconcile', e.target.checked)} className="mt-0.5 w-4 h-4 accent-nibo-blue" />
          <span>
            Conciliar automaticamente
            <span className="block text-xs text-slate-500">Desmarcado: a movimentação chega com a sugestão e você confirma com OK.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
};
