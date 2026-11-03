import React, { useEffect, useState } from 'react';
import { X, Landmark, CreditCard, Wallet, Grip, Loader2, AlertCircle } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { errorMessage } from '../../lib/api';
import { accountColor } from '../../lib/accounts';
import { BankSelect } from '../common/BankSelect';
import { MoneyInput } from '../common/MoneyInput';
import { Bank, useBanks } from '../common/useBanks';
import { AccountType, PersonType } from '../../types';

// ----------------------------------------------------------------------------
// Tipos de conta (etapa 1)
// ----------------------------------------------------------------------------

type AccountKind = 'BANK' | 'CREDIT_CARD' | 'CASH' | 'OTHER';

const KINDS: { id: AccountKind; title: string; description: string; icon: React.ElementType }[] = [
  {
    id: 'BANK',
    title: 'Conta bancária',
    description: 'Conta corrente para importar extratos e conciliar lançamentos.',
    icon: Landmark,
  },
  {
    id: 'CREDIT_CARD',
    title: 'Cartão de crédito',
    description: 'Lançamentos e conciliação das faturas do cartão.',
    icon: CreditCard,
  },
  {
    id: 'CASH',
    title: 'Caixinha',
    description: 'Conta interna para controle de valores que estão fora do banco.',
    icon: Wallet,
  },
  {
    id: 'OTHER',
    title: 'Outras contas',
    description: 'Poupança, investimentos, maquininhas e outros controles financeiros.',
    icon: Grip,
  },
];

const OTHER_TYPES: { value: AccountType; label: string }[] = [
  { value: 'SAVINGS', label: 'Poupança' },
  { value: 'INVESTMENT', label: 'Investimento' },
  { value: 'PAYMENT_GATEWAY', label: 'Maquininha / Gateway de pagamento' },
  { value: 'OTHER', label: 'Outra' },
];

const NAME_PLACEHOLDER: Record<AccountKind, string> = {
  BANK: 'Ex.: Conta corrente, Itaú Operacional',
  CREDIT_CARD: 'Ex.: Cartão Corporativo Nubank',
  CASH: 'Ex.: Caixinha, Caixa da loja',
  OTHER: 'Ex.: Maquininha Sispag, Reserva XP',
};


const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const inputClass = (error?: string, width = 'w-full') =>
  `${width} h-10 px-3 rounded border text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 transition-colors ${
    error ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
  }`;

const Label: React.FC<{ htmlFor?: string; optional?: boolean; children: React.ReactNode }> = ({ htmlFor, optional, children }) => (
  <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800 mb-1.5 whitespace-nowrap">
    {children} {optional && <span className="italic font-normal text-slate-400 text-xs">(opcional)</span>}
  </label>
);

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="text-xs text-rose-600 mt-1">{message}</p> : null;


// ----------------------------------------------------------------------------
// Gaveta "Nova conta"
// ----------------------------------------------------------------------------

interface NewAccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FormState {
  bank: Bank | null;
  otherType: AccountType | '';
  agency: string;
  accountNumber: string;
  accountDigit: string;
  startDate: string;
  initialBalance: number;
  holderType: PersonType;
  name: string;
}

const emptyForm = (): FormState => ({
  bank: null,
  otherType: '',
  agency: '',
  accountNumber: '',
  accountDigit: '',
  startDate: todayIso(),
  initialBalance: 0,
  holderType: 'LEGAL',
  name: '',
});

export const NewAccountDrawer: React.FC<NewAccountDrawerProps> = ({ isOpen, onClose }) => {
  const { accounts, createBankAccount, notify } = useCompany();
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<AccountKind | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [nameTouched, setNameTouched] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { banks, error: banksError } = useBanks(isOpen);

  const close = () => {
    setStep(1);
    setKind(null);
    setForm(emptyForm());
    setNameTouched(false);
    setErrors({});
    setSaveError(null);
    onClose();
  };

  // Esc fecha a gaveta
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;


  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const chooseBank = (bank: Bank) => {
    set('bank', bank);
    // Sugere o nome da conta pelo banco enquanto o usuário não digitou um nome
    if (!nameTouched) set('name', kind === 'CREDIT_CARD' ? `Cartão ${bank.name}` : bank.name);
  };

  const showBankFields = kind === 'BANK' || kind === 'CREDIT_CARD' || kind === 'OTHER';
  const showAgencyFields = kind === 'BANK' || kind === 'OTHER';

  const resolvedType = (): AccountType =>
    kind === 'BANK' ? 'CHECKING' : kind === 'CREDIT_CARD' ? 'CREDIT_CARD' : kind === 'CASH' ? 'CASH' : (form.otherType as AccountType);

  const validate = () => {
    const next: typeof errors = {};
    if (kind === 'BANK' && !form.bank) next.bank = 'Selecione o banco';
    if (kind === 'OTHER' && !form.otherType) next.otherType = 'Selecione o tipo';
    if (!form.startDate) next.startDate = 'Informe a data de início';
    else if (form.startDate > todayIso()) next.startDate = 'A data não pode ser futura';
    if (!form.name.trim()) next.name = 'Informe um nome para a conta';
    else if (accounts.some((a) => a.name.trim().toLowerCase() === form.name.trim().toLowerCase())) {
      next.name = 'Já existe uma conta com esse nome';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!kind || !validate()) return;
    setSaving(true);
    setSaveError(null);
    const type = resolvedType();
    try {
      const account = await createBankAccount({
        name: form.name.trim(),
        type,
        bankCode: showBankFields && form.bank ? form.bank.code.padStart(3, '0') : null,
        bankName: showBankFields && form.bank ? form.bank.name : null,
        agency: showAgencyFields ? form.agency.trim() || null : null,
        accountNumber: showAgencyFields ? form.accountNumber.trim() || null : null,
        accountDigit: showAgencyFields ? form.accountDigit.trim() || null : null,
        initialBalance: form.initialBalance,
        initialBalanceDate: form.startDate,
        holderType: form.holderType,
        color: accountColor(type, form.bank?.code),
        isDefault: accounts.length === 0,
      });
      notify(`Conta ${account.name} criada`);
      close();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    { n: 1 as const, label: '1. Tipo de conta' },
    { n: 2 as const, label: '2. Dados da conta' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="new-account-title">
      <div className="absolute inset-0 bg-slate-900/40" onClick={close} />

      <div className="relative w-full md:w-[min(1080px,62vw)] md:min-w-[760px] h-full bg-white shadow-2xl flex flex-col text-slate-800 animate-in slide-in-from-right duration-200">
        {/* Cabeçalho */}
        <div className="px-6 h-[72px] flex items-center justify-between border-b border-slate-200 shrink-0">
          <h2 id="new-account-title" className="text-xl font-medium text-slate-700">
            Nova conta
          </h2>
          <button onClick={close} aria-label="Fechar" className="p-1.5 rounded text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* Etapas */}
          <nav className="md:w-56 shrink-0 md:border-r border-b md:border-b-0 border-slate-200 p-4 flex md:flex-col gap-1" aria-label="Etapas">
            {steps.map((s) => {
              const active = step === s.n;
              const reachable = s.n === 1 || !!kind;
              return (
                <button
                  key={s.n}
                  type="button"
                  disabled={!reachable}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => setStep(s.n)}
                  className={`text-left px-4 py-2 rounded text-sm transition-colors ${
                    active ? 'bg-slate-100 text-slate-800' : reachable ? 'text-slate-500 hover:bg-slate-50' : 'text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Conteúdo */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-8 py-6">
            {step === 1 && (
              <>
                <h3 className="text-base font-medium text-slate-800 mb-5">Escolha um tipo de conta para começar</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" role="radiogroup" aria-label="Tipo de conta">
                  {KINDS.map((k) => {
                    const Icon = k.icon;
                    const selected = kind === k.id;
                    return (
                      <button
                        key={k.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setKind(k.id)}
                        onDoubleClick={() => {
                          setKind(k.id);
                          setStep(2);
                        }}
                        className={`text-left p-4 rounded-md border transition-colors ${
                          selected
                            ? 'bg-nibo-blueLight border-nibo-blue ring-1 ring-nibo-blue'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <Icon className="w-7 h-7 text-nibo-blue mb-3" strokeWidth={1.6} />
                        <p className="text-sm font-medium text-slate-800">{k.title}</p>
                        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{k.description}</p>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {step === 2 && kind && (
              <>
                <h3 className="text-base font-medium text-slate-800">Dados da conta</h3>
                <p className="text-sm text-slate-600 mt-1 mb-6">Preencha com os dados da sua conta</p>

                {saveError && (
                  <div role="alert" className="mb-5 flex items-start gap-2 px-3.5 py-2.5 rounded border border-rose-200 bg-rose-50 text-sm text-rose-800">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    {saveError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-5 max-w-3xl">
                  {kind === 'OTHER' && (
                    <div className="md:col-span-6">
                      <Label htmlFor="na-other-type">Tipo</Label>
                      <div className="relative">
                        <select
                          id="na-other-type"
                          value={form.otherType}
                          onChange={(e) => set('otherType', e.target.value as AccountType)}
                          className={`${inputClass(errors.otherType)} appearance-none pr-9 ${form.otherType ? '' : 'text-slate-400'}`}
                        >
                          <option value="">Selecione...</option>
                          {OTHER_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 border-x-[5px] border-x-transparent border-t-[6px] border-t-slate-500" />
                      </div>
                      <FieldError message={errors.otherType} />
                    </div>
                  )}
                  {kind === 'OTHER' && <div className="hidden md:block md:col-span-6" />}

                  {showBankFields && (
                    <div className={showAgencyFields ? 'md:col-span-5' : 'md:col-span-7'}>
                      <Label htmlFor="na-bank" optional={kind !== 'BANK'}>
                        {kind === 'CREDIT_CARD' ? 'Banco emissor' : kind === 'OTHER' ? 'Instituição' : 'Banco'}
                      </Label>
                      <BankSelect
                        id="na-bank"
                        banks={banks}
                        loadError={banksError}
                        value={form.bank}
                        onChange={chooseBank}
                        error={errors.bank}
                        placeholder={kind === 'BANK' ? 'Selecione um banco' : 'Selecione...'}
                      />
                      <FieldError message={errors.bank} />
                    </div>
                  )}

                  {showAgencyFields && (
                    <>
                      <div className="md:col-span-3">
                        <Label htmlFor="na-agency" optional>
                          Agência
                        </Label>
                        <input
                          id="na-agency"
                          value={form.agency}
                          onChange={(e) => set('agency', e.target.value.replace(/[^\d-]/g, '').slice(0, 8))}
                          inputMode="numeric"
                          className={inputClass()}
                        />
                      </div>
                      <div className="md:col-span-4">
                        <Label htmlFor="na-account" optional>
                          Conta
                        </Label>
                        <div className="flex gap-2">
                          <input
                            id="na-account"
                            value={form.accountNumber}
                            onChange={(e) => set('accountNumber', e.target.value.replace(/[^\d]/g, '').slice(0, 14))}
                            inputMode="numeric"
                            className={inputClass()}
                          />
                          <input
                            value={form.accountDigit}
                            onChange={(e) => set('accountDigit', e.target.value.replace(/[^\dxX]/g, '').slice(0, 2).toUpperCase())}
                            aria-label="Dígito da conta"
                            className={`${inputClass(undefined, 'w-12')} text-center px-1 shrink-0`}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="md:col-span-3">
                    <Label htmlFor="na-start">Início do controle</Label>
                    <input
                      id="na-start"
                      type="date"
                      value={form.startDate}
                      max={todayIso()}
                      onChange={(e) => set('startDate', e.target.value)}
                      className={inputClass(errors.startDate)}
                    />
                    <FieldError message={errors.startDate} />
                  </div>

                  <div className="md:col-span-3">
                    <Label htmlFor="na-balance">{kind === 'CREDIT_CARD' ? 'Fatura em aberto no dia' : 'Saldo inicial do dia'}</Label>
                    <MoneyInput id="na-balance" value={form.initialBalance} onChange={(v) => set('initialBalance', v)} />
                  </div>

                  {kind !== 'CASH' && (
                    <fieldset className="md:col-span-6">
                      <legend className="block text-sm font-medium text-slate-800 mb-1.5">Titularidade</legend>
                      <div className="h-10 flex items-center gap-6">
                        {(['LEGAL', 'NATURAL'] as PersonType[]).map((h) => (
                          <label key={h} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                            <input
                              type="radio"
                              name="holderType"
                              checked={form.holderType === h}
                              onChange={() => set('holderType', h)}
                              className="w-4 h-4 accent-nibo-blue"
                            />
                            {h === 'LEGAL' ? 'Pessoa jurídica' : 'Pessoa física'}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {kind === 'CASH' && <div className="hidden md:block md:col-span-6" />}

                  <div className="md:col-span-8">
                    <Label htmlFor="na-name">Como você quer chamar essa conta?</Label>
                    <input
                      id="na-name"
                      value={form.name}
                      onChange={(e) => {
                        setNameTouched(true);
                        set('name', e.target.value);
                      }}
                      placeholder={NAME_PLACEHOLDER[kind]}
                      maxLength={60}
                      className={inputClass(errors.name)}
                    />
                    <FieldError message={errors.name} />
                  </div>
                </div>

                {form.initialBalance !== 0 && (
                  <p className="mt-5 text-xs text-slate-500 max-w-3xl">
                    O saldo inicial vale para o começo do dia {form.startDate.split('-').reverse().join('/')}. Lançamentos de extrato a partir
                    dessa data são somados a ele.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Rodapé */}
        <div className="px-6 h-[76px] flex items-center justify-end gap-6 border-t border-slate-200 shrink-0">
          {step === 1 ? (
            <>
              <button type="button" onClick={close} className="text-sm text-nibo-blue hover:underline">
                Cancelar
              </button>
              <button
                type="button"
                disabled={!kind}
                onClick={() => setStep(2)}
                className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Próximo
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setStep(1)} className="text-sm text-nibo-blue hover:underline">
                Anterior
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
