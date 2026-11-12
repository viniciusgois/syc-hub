import React, { useEffect, useMemo, useState } from 'react';
import { X, Star, ArrowUp, ArrowDown, Loader2, AlertCircle, Trash2, RotateCcw, Link2, Search } from 'lucide-react';
import { StatementSearchDialog } from '../reconciliation/StatementSearchDialog';
import { useCompany } from '../../context/CompanyContext';
import { api, ApiError, errorMessage } from '../../lib/api';
import {
  EntryConfig,
  EntryDetail,
  FREQUENCIES,
  brDate,
  categoryOptions,
  frequencyLabel,
  money,
  todayIso,
} from '../../lib/entries';
import { MoneyInput } from '../common/MoneyInput';
import { SearchSelect } from '../common/SearchSelect';
import { ContactField } from './ContactField';
import { SplitEditor } from '../common/SplitEditor';
import { useCostCenters } from '../common/useCostCenters';
import { SplitDraft, draftFromSplits, resolveSplit, signOf, splitError, splitPayload, startSplit } from '../../lib/splits';

export type EntryDrawerMode = 'now' | 'schedule' | 'edit';

interface FormState {
  bankAccountId: string;
  settleDate: string;
  dueDate: string;
  issueDate: string;
  expectedDate: string;
  contactId: string;
  description: string;
  documentNumber: string;
  categoryId: string;
  costCenterId: string;
  notes: string;
  amount: number;
  detailed: boolean;
  interestFine: number;
  discount: number;
  recurring: boolean;
  recurrenceType: 'INSTALLMENT' | 'RECURRING';
  frequency: string;
  occurrences: number;
  endless: boolean;
  isStarred: boolean;
  scheduledAtBank: boolean;
  split: SplitDraft | null; // rateio por categoria/centro de custo
}

const emptyForm = (): FormState => ({
  bankAccountId: '',
  settleDate: todayIso(),
  dueDate: todayIso(),
  issueDate: '',
  expectedDate: '',
  contactId: '',
  description: '',
  documentNumber: '',
  categoryId: '',
  costCenterId: '',
  notes: '',
  amount: 0,
  detailed: false,
  interestFine: 0,
  discount: 0,
  recurring: false,
  recurrenceType: 'INSTALLMENT',
  frequency: 'MONTHLY',
  occurrences: 2,
  endless: false,
  isStarred: false,
  scheduledAtBank: false,
  split: null,
});

const formFrom = (e: EntryDetail): FormState => ({
  ...emptyForm(),
  dueDate: e.dueDate.slice(0, 10),
  issueDate: e.issueDate.slice(0, 10),
  expectedDate: e.expectedDate?.slice(0, 10) ?? '',
  contactId: e.contactId ?? '',
  description: e.description,
  documentNumber: e.documentNumber ?? '',
  categoryId: e.categoryId ?? '',
  costCenterId: e.costCenterId ?? '',
  notes: e.notes ?? '',
  amount: e.amount,
  detailed: e.interestFine > 0 || e.discount > 0,
  interestFine: e.interestFine,
  discount: e.discount,
  isStarred: e.isStarred,
  scheduledAtBank: !!e.scheduledAtBank,
  split: e.splits.length ? draftFromSplits(e.splits, e.amount) : null,
});

const inputClass = (error?: string) =>
  `w-full h-10 px-3 rounded border text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 ${
    error ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
  }`;

const Field: React.FC<{ label: string; optional?: boolean; htmlFor?: string; error?: string; className?: string; children: React.ReactNode }> = ({
  label,
  optional,
  htmlFor,
  error,
  className = '',
  children,
}) => (
  <div className={`min-w-0 ${className}`}>
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800 mb-1.5 whitespace-nowrap">
      {label} {optional && <span className="italic font-normal text-xs text-slate-400">(opcional)</span>}
    </label>
    {children}
    {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
  </div>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; children?: React.ReactNode }> = ({
  checked,
  onChange,
  label,
  disabled,
  children,
}) => (
  <div className="rounded-md bg-slate-100">
    <label className={`flex items-center gap-3 px-5 py-4 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className="relative inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="w-10 h-5 rounded-full bg-slate-300 peer-checked:bg-nibo-blue transition-colors" />
        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
      <span className="text-sm text-slate-800">{label}</span>
    </label>
    {checked && children && <div className="px-5 pb-5">{children}</div>}
  </div>
);

interface EntryDrawerProps {
  config: EntryConfig;
  mode: EntryDrawerMode;
  entryId?: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** Chamado após qualquer gravação (para recarregar a lista) */
  onChanged: () => void;
  /** Conta já escolhida ao lançar pelo extrato da conta */
  defaultBankAccountId?: string;
  /** Linha do extrato importado que o lançamento quita ("Criar agendamento detalhado" da Conciliação) */
  statementTx?: StatementTxPrefill | null;
}

export interface StatementTxPrefill {
  id: string;
  bankAccountId: string;
  date: string;
  amount: number;
  description: string;
  contactId?: string;
  categoryId?: string;
  costCenterId?: string;
}

export const EntryDrawer: React.FC<EntryDrawerProps> = ({ config, mode, entryId, isOpen, onClose, onChanged, defaultBankAccountId, statementTx }) => {
  const { currentCompany, accounts, categories, notify, refreshLedger } = useCompany();
  const base = `/companies/${currentCompany.id}/${config.endpoint}`;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitted, setSubmitted] = useState(false); // mostra o erro do rateio só depois de tentar salvar
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [keepCreating, setKeepCreating] = useState(false);
  const [searchingStatement, setSearchingStatement] = useState(false);
  const [settleForm, setSettleForm] = useState<{ bankAccountId: string; date: string; amount: number } | null>(null);

  const loadEntry = async (id: string) => {
    try {
      const data = await api.get<EntryDetail>(`${base}/${id}`);
      setEntry(data);
      setForm(formFrom(data));
    } catch (err) {
      setBanner(errorMessage(err));
    }
  };

  // Ao abrir: limpa ou carrega o lançamento em edição
  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setSubmitted(false);
    setBanner(null);
    setEntry(null);
    setSettleForm(null);
    setSearchingStatement(false);
    const fresh = emptyForm();
    setForm({ ...fresh, bankAccountId: defaultBankAccountId ?? (accounts.length === 1 ? accounts[0].id : '') });
    if (statementTx) {
      setForm({
        ...fresh,
        bankAccountId: statementTx.bankAccountId,
        settleDate: statementTx.date,
        amount: statementTx.amount,
        description: statementTx.description,
        contactId: statementTx.contactId ?? '',
        categoryId: statementTx.categoryId ?? '',
        costCenterId: statementTx.costCenterId ?? '',
      });
    }
    if (mode === 'edit' && entryId) loadEntry(entryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, entryId, statementTx?.id]);

  const close = () => {
    if (!saving) onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Centros de custo ativos (só quando habilitados em Configurações)
  const costCenters = useCostCenters(isOpen);

  const catOptions = useMemo(() => categoryOptions(categories, config.categoryType), [categories, config.categoryType]);

  if (!isOpen) return null;

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const total = form.amount + (form.detailed ? form.interestFine - form.discount : 0);
  const isInstallment = form.recurring && form.recurrenceType === 'INSTALLMENT';
  const isEdit = mode === 'edit';
  const locked = isEdit && !!entry && entry.settledAmount > 0; // valores ficam travados após baixa
  const title = mode === 'now' ? `Novo ${config.noun}` : isEdit ? config.editTitle : config.scheduleTitle;
  const Arrow = config.direction === 'RECEIVABLE' ? ArrowUp : ArrowDown;
  const arrowColor = config.direction === 'RECEIVABLE' ? 'text-emerald-600' : 'text-rose-600';
  const nature = config.categoryType;
  const sign = (id: string) => signOf(categories, id, nature);
  const splitLines = form.split ? resolveSplit(form.split, form.amount, sign) : [];
  const currentSplitError = form.split ? splitError(splitLines, form.amount, sign) : null;

  const validate = () => {
    const next: typeof errors = {};
    if (mode === 'now' && !form.bankAccountId) next.bankAccountId = 'Selecione uma conta';
    if (mode === 'now' && !form.settleDate) next.settleDate = 'Informe a data';
    if (mode !== 'now' && !form.dueDate) next.dueDate = 'Informe o vencimento';
    if (!form.split && !form.categoryId) next.categoryId = 'Selecione uma categoria';
    if (currentSplitError) next.split = currentSplitError;
    if (form.amount <= 0) next.amount = 'Informe o valor';
    if (form.detailed && form.discount > form.amount + form.interestFine) next.discount = 'Desconto maior que o valor';
    if (form.recurring && !form.endless && (form.occurrences < 2 || form.occurrences > 360)) next.occurrences = 'Entre 2 e 360';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const payload = () => ({
    contactId: form.contactId || null,
    ...(form.split
      ? { splits: splitPayload(splitLines) }
      : { categoryId: form.categoryId, costCenterId: form.costCenterId || null, ...(entry?.splits.length && { splits: null }) }),
    ...(config.direction === 'PAYABLE' && currentCompany.bankScheduleEnabled && { scheduledAtBank: form.scheduledAtBank }),
    description: form.description,
    documentNumber: form.documentNumber,
    notes: form.notes,
    amount: form.amount,
    interestFine: form.detailed ? form.interestFine : 0,
    discount: form.detailed ? form.discount : 0,
    ...(form.issueDate && { issueDate: form.issueDate }),
  });

  const save = async () => {
    setSubmitted(true);
    if (!validate()) return;
    setSaving(true);
    setBanner(null);
    try {
      if (isEdit && entry) {
        await api.patch(`${base}/${entry.id}`, {
          ...payload(),
          dueDate: form.dueDate,
          expectedDate: form.expectedDate || null,
          isStarred: form.isStarred,
        });
        notify('Lançamento atualizado');
      } else if (mode === 'now') {
        await api.post(base, {
          ...payload(),
          isStarred: form.isStarred,
          settlement: statementTx ? { transactionId: statementTx.id } : { bankAccountId: form.bankAccountId, date: form.settleDate },
        });
        notify(`${config.noun.charAt(0).toUpperCase()}${config.noun.slice(1)} de R$ ${money(total)} registrado`);
        refreshLedger();
      } else {
        const created = await api.post<{ created: number }>(base, {
          ...payload(),
          dueDate: form.dueDate,
          expectedDate: form.expectedDate || null,
          ...(form.recurring && {
            recurrence: { type: form.recurrenceType, frequency: form.frequency, occurrences: form.endless ? null : form.occurrences },
          }),
        });
        notify(created.created > 1 ? `${created.created} lançamentos agendados` : 'Lançamento agendado');
      }
      onChanged();
      if (!isEdit && keepCreating) {
        // Mantém conta, datas e categoria para lançar o próximo rapidamente
        setForm((f) => ({ ...emptyForm(), bankAccountId: f.bankAccountId, settleDate: f.settleDate, dueDate: f.dueDate, categoryId: f.categoryId }));
        setSubmitted(false);
      } else {
        onClose();
      }
    } catch (err) {
      const fields = (err instanceof ApiError && (err.details as { fields?: string[] })?.fields) || [];
      if (fields.includes('date')) setErrors((e) => ({ ...e, settleDate: errorMessage(err) }));
      else setBanner(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const run = async (action: () => Promise<unknown>, message: string, closeAfter = false) => {
    setSaving(true);
    try {
      await action();
      notify(message);
      onChanged();
      refreshLedger();
      if (closeAfter) onClose();
      else if (entry) await loadEntry(entry.id);
    } catch (err) {
      setBanner(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!entry || !window.confirm(`Excluir "${entry.displayDescription}"?`)) return;
    run(() => api.delete(`${base}/${entry.id}`), 'Lançamento excluído', true);
  };

  const reverse = (txId: string, matched: boolean) => {
    if (!entry) return;
    const msg = matched
      ? 'Estornar esta baixa? A linha do extrato bancário continua na conta e volta a ficar pendente de conciliação.'
      : 'Estornar esta baixa? O lançamento será removido da conta.';
    if (!window.confirm(msg)) return;
    run(() => api.post(`${base}/${entry.id}/settlements/${txId}/reverse`), 'Baixa estornada');
  };

  const installmentPreview = () => {
    if (!isInstallment || form.amount <= 0 || form.occurrences < 2) return null;
    const cents = Math.round(form.amount * 100);
    const each = Math.floor(cents / form.occurrences);
    const first = cents - each * (form.occurrences - 1);
    return first === each
      ? `${form.occurrences}x de R$ ${money(each / 100)}`
      : `1x de R$ ${money(first / 100)} + ${form.occurrences - 1}x de R$ ${money(each / 100)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="entry-drawer-title">
      <div className="absolute inset-0 bg-slate-900/40" onClick={close} />
      <div className="relative w-full md:w-[min(1080px,62vw)] md:min-w-[780px] h-full bg-white shadow-2xl flex flex-col text-slate-800">
        {/* Cabeçalho */}
        <div className="px-6 h-[72px] flex items-center justify-between border-b border-slate-200 shrink-0">
          <h2 id="entry-drawer-title" className="text-xl font-medium text-slate-700">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => set('isStarred', !form.isStarred)}
              aria-label={form.isStarred ? 'Remover dos favoritos' : 'Marcar como favorito'}
              aria-pressed={form.isStarred}
              className="p-2 rounded hover:bg-slate-100"
            >
              <Star className={`w-5 h-5 ${form.isStarred ? 'fill-amber-400 text-amber-400' : 'text-slate-400'}`} />
            </button>
            <span className="w-px h-8 bg-slate-200 mx-2" />
            <button onClick={close} aria-label="Fechar" className="p-2 rounded text-slate-500 hover:bg-slate-100">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
          {banner && (
            <div role="alert" className="flex items-start gap-2 px-3.5 py-2.5 rounded border border-rose-200 bg-rose-50 text-sm text-rose-800">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {banner}
            </div>
          )}
          {isEdit && !entry && !banner && (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
            </p>
          )}

          {(!isEdit || entry) && (
            <>
              {/* Datas + total */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-wrap gap-4">
                  {mode === 'now' && (
                    <Field label="Conta" htmlFor="en-account" error={errors.bankAccountId} className="w-60">
                      <div className="relative">
                        <select
                          id="en-account"
                          disabled={!!statementTx}
                          value={form.bankAccountId}
                          onChange={(e) => set('bankAccountId', e.target.value)}
                          className={`${inputClass(errors.bankAccountId)} appearance-none pr-9 ${form.bankAccountId ? '' : 'text-slate-400'}`}
                        >
                          <option value="">Selecione uma conta</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 border-x-[5px] border-x-transparent border-t-[6px] border-t-slate-500" />
                      </div>
                    </Field>
                  )}
                </div>
                <div className="text-right ml-auto">
                  <p className="text-sm font-medium text-slate-700">{mode === 'now' ? config.totalSettled : config.totalToSettle}</p>
                  <p className="text-3xl font-medium text-slate-800">{money(total)}</p>
                  {isEdit && entry && entry.settledAmount > 0 && (
                    <p className="text-xs text-slate-500">
                      Baixado R$ {money(entry.settledAmount)} · em aberto R$ {money(entry.openAmount)}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-4 -mt-2">
                {mode === 'now' ? (
                  <Field label={config.settledDateLabel} htmlFor="en-settle-date" error={errors.settleDate} className="md:col-span-3">
                    <input id="en-settle-date" type="date" disabled={!!statementTx} value={form.settleDate} onChange={(e) => set('settleDate', e.target.value)} className={`${inputClass(errors.settleDate)} disabled:bg-slate-50`} />
                  </Field>
                ) : (
                  <Field label="Vencimento" htmlFor="en-due" error={errors.dueDate} className="md:col-span-3">
                    <input id="en-due" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} className={inputClass(errors.dueDate)} />
                  </Field>
                )}
                <Field label="Competência" optional htmlFor="en-issue" className="md:col-span-3">
                  <input
                    id="en-issue"
                    type="date"
                    value={form.issueDate}
                    onChange={(e) => set('issueDate', e.target.value)}
                    title="Mês de referência na DRE por competência. Em branco: mesma data do vencimento/recebimento."
                    className={inputClass()}
                  />
                </Field>
                {mode !== 'now' && (
                  <Field label="Previsto para" optional htmlFor="en-expected" className="md:col-span-3">
                    <input id="en-expected" type="date" value={form.expectedDate} onChange={(e) => set('expectedDate', e.target.value)} className={inputClass()} />
                  </Field>
                )}
              </div>

              {/* Nome / descrição / referência / categoria / valor */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-4">
                <Field label="Nome" htmlFor="en-contact" className="md:col-span-4">
                  <ContactField id="en-contact" value={form.contactId} onChange={(v) => set('contactId', v)} direction={config.direction} />
                </Field>
                <Field label="Descrição" optional htmlFor="en-desc" className="md:col-span-5">
                  <input
                    id="en-desc"
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                    placeholder={config.direction === 'RECEIVABLE' ? 'Ex.: Serviço prestado' : 'Ex.: Conta de energia'}
                    maxLength={200}
                    className={inputClass()}
                  />
                </Field>
                <Field label="Referência" optional htmlFor="en-ref" className="md:col-span-3">
                  <input id="en-ref" value={form.documentNumber} onChange={(e) => set('documentNumber', e.target.value)} placeholder="NF, boleto, contrato..." className={inputClass()} />
                </Field>

                <Field label="Categoria" htmlFor="en-category" error={errors.categoryId} className="md:col-span-4">
                  {form.split ? (
                    <p id="en-category" className="h-10 px-3 flex items-center rounded border border-slate-200 bg-slate-50 text-sm text-slate-600">
                      Rateio em {form.split.lines.length} linhas (abaixo)
                    </p>
                  ) : (
                    <>
                      <SearchSelect
                        id="en-category"
                        value={form.categoryId}
                        onChange={(v) => set('categoryId', v)}
                        options={catOptions}
                        placeholder="Selecione uma categoria..."
                        error={errors.categoryId}
                      />
                      {currentCompany.splitsEnabled && (
                        <button
                          type="button"
                          onClick={() => set('split', startSplit(form.amount, form.categoryId, form.costCenterId))}
                          className="mt-1 text-xs text-nibo-blue hover:underline"
                        >
                          Ratear entre categorias{currentCompany.costCentersEnabled ? ' / centros de custo' : ''}
                        </button>
                      )}
                    </>
                  )}
                </Field>
                <Field label="Detalhamento" optional htmlFor="en-notes" className="md:col-span-5">
                  <input id="en-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass()} />
                </Field>
                <Field label={isInstallment ? 'Valor total' : 'Valor'} htmlFor="en-amount" error={errors.amount} className="md:col-span-3">
                  <MoneyInput
                    id="en-amount"
                    value={form.amount}
                    onChange={(v) => set('amount', v)}
                    allowNegative={false}
                    error={errors.amount}
                    disabled={locked}
                    prefix={<Arrow className={`w-4 h-4 ${arrowColor}`} />}
                  />
                </Field>
              </div>
              {form.split && (
                <SplitEditor
                  draft={form.split}
                  onChange={(d) => set('split', d)}
                  total={form.amount}
                  nature={nature}
                  costCenters={costCenters}
                  onRemove={() => {
                    const main = splitLines.filter((l) => sign(l.categoryId) > 0).sort((a, b) => b.amount - a.amount)[0];
                    setForm((f) => ({ ...f, split: null, categoryId: main?.categoryId ?? f.categoryId, costCenterId: main?.costCenterId ?? f.costCenterId }));
                    setErrors((e) => ({ ...e, split: undefined }));
                  }}
                  error={submitted ? currentSplitError : null}
                />
              )}
              {!form.split && currentCompany.costCentersEnabled && costCenters.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 -mt-1">
                  <Field label="Centro de custo" optional htmlFor="en-cc" className="md:col-span-4">
                    <select id="en-cc" value={form.costCenterId} onChange={(e) => set('costCenterId', e.target.value)} className={`${inputClass()} ${form.costCenterId ? '' : 'text-slate-400'}`}>
                      <option value="">Nenhum</option>
                      {costCenters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
              {locked && <p className="text-xs text-slate-500 -mt-2">Valores travados porque já há baixa. Estorne as baixas para alterá-los.</p>}

              {/* Opções */}
              <div className="space-y-3">
                <Toggle checked={form.detailed} onChange={(v) => set('detailed', v)} label="Valores detalhados" disabled={locked}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field label="Juros / multa" htmlFor="en-interest">
                      <MoneyInput id="en-interest" value={form.interestFine} onChange={(v) => set('interestFine', v)} allowNegative={false} />
                    </Field>
                    <Field label="Desconto" htmlFor="en-discount" error={errors.discount}>
                      <MoneyInput id="en-discount" value={form.discount} onChange={(v) => set('discount', v)} allowNegative={false} error={errors.discount} />
                    </Field>
                    <div className="self-end text-sm text-slate-600 pb-2.5">
                      Total: <strong className="text-slate-800">R$ {money(total)}</strong>
                    </div>
                  </div>
                </Toggle>

                {config.direction === 'PAYABLE' && currentCompany.bankScheduleEnabled && mode !== 'now' && entry?.status !== 'PAID' && (
                  <Toggle checked={form.scheduledAtBank} onChange={(v) => set('scheduledAtBank', v)} label="Programado no banco" />
                )}

                {mode === 'schedule' && (
                  <Toggle checked={form.recurring} onChange={(v) => set('recurring', v)} label="Recorrência ou Parcelamento">
                    <div className="space-y-4">
                      <div className="flex gap-6" role="radiogroup">
                        {(
                          [
                            ['INSTALLMENT', 'Parcelamento', 'Divide o valor total em parcelas'],
                            ['RECURRING', 'Recorrência', 'Repete o mesmo valor (aluguel, mensalidade...)'],
                          ] as const
                        ).map(([value, label, hint]) => (
                          <label key={value} className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="recurrenceType"
                              checked={form.recurrenceType === value}
                              onChange={() => setForm((f) => ({ ...f, recurrenceType: value, endless: value === 'INSTALLMENT' ? false : f.endless }))}
                              className="mt-1 accent-nibo-blue"
                            />
                            <span>
                              <span className="block text-sm text-slate-800">{label}</span>
                              <span className="block text-xs text-slate-500">{hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                        <Field label="Frequência" htmlFor="en-freq">
                          <div className="relative">
                            <select id="en-freq" value={form.frequency} onChange={(e) => set('frequency', e.target.value)} className={`${inputClass()} appearance-none pr-9`}>
                              {FREQUENCIES.map((f) => (
                                <option key={f.value} value={f.value}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 border-x-[5px] border-x-transparent border-t-[6px] border-t-slate-500" />
                          </div>
                        </Field>
                        <Field label={isInstallment ? 'Nº de parcelas' : 'Nº de ocorrências'} htmlFor="en-occ" error={errors.occurrences}>
                          <input
                            id="en-occ"
                            type="number"
                            min={2}
                            max={360}
                            value={form.endless ? '' : form.occurrences}
                            disabled={form.endless}
                            onChange={(e) => set('occurrences', Number(e.target.value))}
                            className={`${inputClass(errors.occurrences)} disabled:bg-slate-100`}
                          />
                        </Field>
                        {form.recurrenceType === 'RECURRING' ? (
                          <label className="flex items-center gap-2 text-sm text-slate-700 pb-2.5 cursor-pointer">
                            <input type="checkbox" checked={form.endless} onChange={(e) => set('endless', e.target.checked)} className="accent-nibo-blue" />
                            Sem data de término
                          </label>
                        ) : (
                          <p className="text-sm text-slate-600 pb-2.5">{installmentPreview()}</p>
                        )}
                      </div>
                    </div>
                  </Toggle>
                )}
              </div>

              {/* Edição: origem e baixas */}
              {isEdit && entry && (
                <div className="space-y-4">
                  {entry.recurrence && (
                    <p className="text-sm text-slate-600">
                      {entry.recurrence.type === 'INSTALLMENT' ? 'Parcela' : 'Ocorrência'} {entry.installmentNumber}
                      {entry.installmentTotal ? ` de ${entry.installmentTotal}` : ''} · {frequencyLabel(entry.recurrence.frequency)}
                      {entry.recurrence.type === 'RECURRING' && !entry.installmentTotal ? ' · sem data de término' : ''}. Alterações valem só para este lançamento.
                    </p>
                  )}
                  {entry.status === 'LOST' && (
                    <div className="flex items-center justify-between px-4 py-3 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900">
                      Marcado como perda.
                      <button
                        type="button"
                        onClick={() => run(() => api.post(`${base}/${entry.id}/reopen`), 'Lançamento reaberto')}
                        className="text-nibo-blue hover:underline"
                      >
                        Desfazer perda
                      </button>
                    </div>
                  )}
                  {entry.status === 'PENDING' && entry.openAmount > 0 && (
                    <div className="rounded-md border border-slate-200 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-slate-700">
                          Em aberto: <strong>R$ {money(entry.openAmount)}</strong>. Já aconteceu?
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSearchingStatement(true)}
                            className="h-9 px-3 rounded border border-nibo-blue text-nibo-blue text-sm hover:bg-nibo-blueLight flex items-center gap-1.5"
                          >
                            <Search className="w-4 h-4" /> Buscar no extrato
                          </button>
                          <button
                            type="button"
                            onClick={() => setSettleForm((f) => (f ? null : { bankAccountId: accounts.length === 1 ? accounts[0].id : '', date: todayIso(), amount: entry.openAmount }))}
                            className="h-9 px-3 rounded border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
                          >
                            Registrar {config.noun}
                          </button>
                        </div>
                      </div>
                      {settleForm && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                          <Field label="Conta" htmlFor="en-settle-acc" className="sm:col-span-2">
                            <select
                              id="en-settle-acc"
                              value={settleForm.bankAccountId}
                              onChange={(e) => setSettleForm({ ...settleForm, bankAccountId: e.target.value })}
                              className={inputClass()}
                            >
                              <option value="">Selecione uma conta</option>
                              {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Data" htmlFor="en-settle-dt">
                            <input
                              id="en-settle-dt"
                              type="date"
                              value={settleForm.date}
                              onChange={(e) => setSettleForm({ ...settleForm, date: e.target.value })}
                              className={inputClass()}
                            />
                          </Field>
                          <Field label="Valor" htmlFor="en-settle-amt">
                            <MoneyInput id="en-settle-amt" value={settleForm.amount} onChange={(v) => setSettleForm({ ...settleForm, amount: v })} allowNegative={false} />
                          </Field>
                          <p className="sm:col-span-3 text-xs text-slate-500">
                            Use para o que foi {config.direction === 'RECEIVABLE' ? 'recebido' : 'pago'} fora do extrato (dinheiro, outra conta). Se a linha já está no extrato, use "Buscar no extrato" para não duplicar.
                          </p>
                          <button
                            type="button"
                            disabled={!settleForm.bankAccountId || settleForm.amount <= 0 || saving}
                            onClick={() =>
                              run(
                                () =>
                                  api.post(`${base}/settle`, {
                                    bankAccountId: settleForm.bankAccountId,
                                    items: [{ id: entry.id, amount: settleForm.amount, date: settleForm.date }],
                                  }),
                                'Baixa registrada',
                              ).then(() => setSettleForm(null))
                            }
                            className="h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium disabled:opacity-50"
                          >
                            {config.verb}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <h3 className="text-sm font-medium text-slate-800 mb-2">Baixas</h3>
                    {entry.settlements.length === 0 ? (
                      <p className="text-sm text-slate-500">Nenhuma baixa registrada.</p>
                    ) : (
                      <ul className="divide-y divide-slate-100 border border-slate-200 rounded">
                        {entry.settlements.map((s) => (
                          <li key={s.id} className="px-4 py-2.5 flex items-center justify-between text-sm">
                            <span>
                              {brDate(s.date)} · {s.bankAccount.name}
                              {s.statementDescription && <span className="text-slate-500"> · {s.statementDescription}</span>}
                              {s.matchedWithStatement && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs text-emerald-700" title="Conciliado com a linha do extrato bancário">
                                  <Link2 className="w-3 h-3" /> extrato
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-3">
                              <strong>R$ {money(s.amount)}</strong>
                              <button
                                type="button"
                                onClick={() => reverse(s.id, s.matchedWithStatement)}
                                className="text-xs text-nibo-blue hover:underline flex items-center gap-1"
                              >
                                <RotateCcw className="w-3 h-3" /> Estornar
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-6 h-[76px] flex items-center justify-between gap-6 border-t border-slate-200 shrink-0">
          <div>
            <p className="text-sm font-medium text-slate-700">{mode === 'now' ? config.totalSettled : config.totalToSettle}</p>
            <p className="text-xl font-medium text-slate-800">{money(total)}</p>
          </div>
          <div className="flex items-center gap-6">
            {isEdit && entry && entry.settledAmount === 0 && (
              <button type="button" onClick={remove} disabled={saving} className="text-sm text-rose-600 hover:underline flex items-center gap-1">
                <Trash2 className="w-4 h-4" /> Excluir
              </button>
            )}
            {!isEdit && !statementTx && (
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={keepCreating} onChange={(e) => setKeepCreating(e.target.checked)} className="w-4 h-4 accent-nibo-blue" />
                {mode === 'now' ? config.continueCreating : 'Continuar agendando'}
              </label>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || (isEdit && !entry)}
              className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? 'Salvar' : mode === 'now' ? config.verb : 'Agendar'}
            </button>
          </div>
        </div>
      </div>
      {searchingStatement && entry && (
        <StatementSearchDialog
          direction={config.direction}
          entry={{ id: entry.id, description: entry.displayDescription, openAmount: entry.openAmount, dueDate: entry.dueDate }}
          onClose={() => setSearchingStatement(false)}
          onMatched={() => {
            onChanged();
            loadEntry(entry.id);
          }}
        />
      )}
    </div>
  );
};
