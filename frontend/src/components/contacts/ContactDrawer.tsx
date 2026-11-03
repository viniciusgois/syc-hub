import React, { useEffect, useState } from 'react';
import { X, Building2, User, Globe, Loader2, AlertCircle } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { MASKS, applyMask, formatDocument, formatPhone, isValidCNPJ, isValidCPF, onlyDigits } from '../../lib/documents';
import { ContactSection, PIX_KEY_TYPES } from '../../lib/contacts';
import { ContactBankDetails, ContactDetails, PersonType } from '../../types';
import { BankSelect } from '../common/BankSelect';
import { findBank, useBanks } from '../common/useBanks';
import { UFS, useMunicipios } from '../common/useMunicipios';

// ----------------------------------------------------------------------------
// Estado do formulário
// ----------------------------------------------------------------------------

type Tab = 'contato' | 'endereco' | 'bancarios';

interface FormState {
  document: string;
  name: string;
  tradeName: string;
  cityReg: string;
  email: string;
  phone: string;
  mobile: string;
  contactPerson: string;
  website: string;
  postalCode: string;
  address: string;
  addressNumber: string;
  addressComplement: string;
  district: string;
  state: string;
  city: string;
  cityIbgeCode: string;
  country: string;
  bankCode: string;
  agency: string;
  accountNumber: string;
  accountDigit: string;
  accountType: '' | 'CHECKING' | 'SAVINGS';
  pixKeyType: '' | NonNullable<ContactBankDetails['pixKeyType']>;
  pixKey: string;
}

const EMPTY: FormState = {
  document: '', name: '', tradeName: '', cityReg: '', email: '', phone: '', mobile: '', contactPerson: '', website: '',
  postalCode: '', address: '', addressNumber: '', addressComplement: '', district: '', state: '', city: '', cityIbgeCode: '',
  country: '', bankCode: '', agency: '', accountNumber: '', accountDigit: '', accountType: '', pixKeyType: '', pixKey: '',
};

function formFrom(contact: ContactDetails): FormState {
  const bd = contact.bankDetails ?? {};
  const doc = contact.document ?? '';
  return {
    ...EMPTY,
    document: contact.personType === 'FOREIGN' ? doc : formatDocument(doc),
    name: contact.name,
    tradeName: contact.tradeName ?? '',
    cityReg: contact.cityReg ?? '',
    email: contact.email ?? '',
    phone: contact.phone ? formatPhone(contact.phone) : '',
    mobile: contact.mobile ? formatPhone(contact.mobile) : '',
    contactPerson: contact.contactPerson ?? '',
    website: contact.website ?? '',
    postalCode: contact.postalCode && contact.personType !== 'FOREIGN' ? applyMask(contact.postalCode, MASKS.cep) : (contact.postalCode ?? ''),
    address: contact.address ?? '',
    addressNumber: contact.addressNumber ?? '',
    addressComplement: contact.addressComplement ?? '',
    district: contact.district ?? '',
    state: contact.state ?? '',
    city: contact.city ?? '',
    cityIbgeCode: contact.cityIbgeCode ?? '',
    country: contact.country ?? '',
    bankCode: bd.bankCode ?? '',
    agency: bd.agency ?? '',
    accountNumber: bd.accountNumber ?? '',
    accountDigit: bd.accountDigit ?? '',
    accountType: bd.accountType ?? '',
    pixKeyType: bd.pixKeyType ?? '',
    pixKey: bd.pixKey ?? '',
  };
}

const PERSON_TYPES: { id: PersonType; label: string; icon: React.ElementType }[] = [
  { id: 'LEGAL', label: 'Pessoa Jurídica', icon: Building2 },
  { id: 'NATURAL', label: 'Pessoa Física', icon: User },
  { id: 'FOREIGN', label: 'Exterior', icon: Globe },
];

// ----------------------------------------------------------------------------
// Componentes de formulário
// ----------------------------------------------------------------------------

const inputClass = (error?: string, disabled?: boolean) =>
  `w-full h-10 px-3 rounded border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors ${
    error ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
  } ${disabled ? 'bg-slate-100 cursor-not-allowed' : 'bg-white'}`;

const Field: React.FC<{ label: string; hint?: string; htmlFor?: string; error?: string; className?: string; children: React.ReactNode }> = ({
  label,
  hint,
  htmlFor,
  error,
  className = '',
  children,
}) => (
  <div className={`min-w-0 ${className}`}>
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800 mb-1.5 whitespace-nowrap">
      {label} {hint && <span className="italic font-normal text-xs text-slate-400">({hint})</span>}
    </label>
    {children}
    {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
  </div>
);

const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }> = ({
  placeholder = 'Selecione...',
  value,
  children,
  ...props
}) => (
  <div className="relative">
    <select {...props} value={value} className={`${inputClass(undefined, props.disabled)} appearance-none pr-9 ${value ? '' : 'text-slate-400'}`}>
      <option value="">{placeholder}</option>
      {children}
    </select>
    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 border-x-[5px] border-x-transparent border-t-[6px] border-t-slate-500" />
  </div>
);

// ----------------------------------------------------------------------------
// Gaveta
// ----------------------------------------------------------------------------

interface ContactDrawerProps {
  isOpen: boolean;
  section: ContactSection;
  companyId: string;
  /** Contato em edição; ausente = cadastro novo */
  contact?: ContactDetails | null;
  onClose: () => void;
  onSaved: (contact: ContactDetails) => void;
}

export const ContactDrawer: React.FC<ContactDrawerProps> = ({ isOpen, section, companyId, contact, onClose, onSaved }) => {
  const [personType, setPersonType] = useState<PersonType>('LEGAL');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [tab, setTab] = useState<Tab>('contato');
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const { banks, error: banksError } = useBanks(isOpen && tab === 'bancarios');
  const { municipios, loading: loadingMunicipios } = useMunicipios(personType === 'FOREIGN' ? '' : form.state);

  // Ao abrir: carrega o contato em edição ou limpa o formulário
  useEffect(() => {
    if (!isOpen) return;
    setPersonType(contact?.personType ?? 'LEGAL');
    setForm(contact ? formFrom(contact) : EMPTY);
    setTab('contato');
    setErrors({});
    setBanner(null);
  }, [isOpen, contact]);

  // Município vindo do CNPJ/CEP: casa pelo código IBGE para exibir o nome com acentos
  useEffect(() => {
    if (!form.cityIbgeCode || !municipios.length) return;
    const match = municipios.find((m) => m.id === form.cityIbgeCode);
    if (match && match.name !== form.city) setForm((f) => ({ ...f, city: match.name }));
  }, [municipios, form.cityIbgeCode, form.city]);

  const close = () => {
    if (!saving) onClose();
  };

  // Esc fecha a gaveta
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;

  const isEdit = !!contact;
  const set = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const fill = (data: Partial<Record<keyof FormState, string | null | undefined>>) => {
    const keys = (Object.keys(data) as (keyof FormState)[]).filter((k) => k in EMPTY && data[k]);
    setForm((f) => {
      const next = { ...f };
      for (const k of keys) (next as Record<string, string>)[k] = data[k] as string;
      return next;
    });
    setErrors((e) => {
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  };

  const switchPersonType = (pt: PersonType) => {
    if (pt === personType) return;
    setPersonType(pt);
    setForm((f) => ({ ...f, document: '' }));
    setErrors({});
  };

  // --------------------------------------------------------------------------
  // Consultas
  // --------------------------------------------------------------------------

  const cnpjReady = personType === 'LEGAL' && isValidCNPJ(form.document);

  const lookupCnpj = async () => {
    if (!cnpjReady) return;
    setLookingUp(true);
    setBanner(null);
    try {
      const d = await api.get<Record<string, string | null>>(`/lookup/cnpj/${onlyDigits(form.document)}`);
      fill({
        name: d.legalName,
        tradeName: d.tradeName,
        email: d.email,
        phone: d.phone ? formatPhone(d.phone) : null,
        postalCode: d.postalCode ? applyMask(d.postalCode, MASKS.cep) : null,
        address: d.address,
        addressNumber: d.addressNumber,
        addressComplement: d.addressComplement,
        district: d.district,
        state: d.state,
        city: d.city,
        cityIbgeCode: d.cityIbgeCode,
      });
      setBanner({ kind: 'info', text: `Dados preenchidos a partir da Receita Federal${d.status ? ` (situação: ${d.status})` : ''}. Confira antes de salvar.` });
    } catch (err) {
      setBanner({ kind: 'error', text: `Consulta do CNPJ: ${errorMessage(err)}` });
    } finally {
      setLookingUp(false);
    }
  };

  const onCepChange = async (value: string) => {
    const masked = applyMask(value, MASKS.cep);
    set('postalCode', masked);
    if (onlyDigits(masked).length !== 8) return;
    try {
      const d = await api.get<Record<string, string | null>>(`/lookup/cep/${onlyDigits(masked)}`);
      fill({ address: d.address, district: d.district, state: d.state, city: d.city, cityIbgeCode: d.cityIbgeCode });
    } catch {
      setErrors((e) => ({ ...e, postalCode: 'CEP não encontrado' }));
    }
  };

  // --------------------------------------------------------------------------
  // Salvar
  // --------------------------------------------------------------------------

  const validate = () => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = personType === 'LEGAL' ? 'Informe a razão social' : 'Informe o nome';
    if (form.document && personType === 'LEGAL' && !isValidCNPJ(form.document)) next.document = 'CNPJ inválido';
    if (form.document && personType === 'NATURAL' && !isValidCPF(form.document)) next.document = 'CPF inválido';
    const badEmails = form.email
      .split(/[,;]/)
      .map((e) => e.trim())
      .filter((e) => e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (badEmails.length) next.email = `E-mail inválido: ${badEmails.join(', ')}`;
    setErrors(next);
    if (next.email) setTab('contato');
    return Object.keys(next).length === 0;
  };

  const payload = () => {
    const bank = findBank(banks, form.bankCode);
    const website = form.website.trim();
    const isForeign = personType === 'FOREIGN';
    const bankDetails: ContactBankDetails = {
      bankCode: form.bankCode ? form.bankCode.padStart(3, '0') : null,
      bankName: bank?.name ?? (form.bankCode ? (contact?.bankDetails?.bankName ?? null) : null),
      agency: form.agency || null,
      accountNumber: form.accountNumber || null,
      accountDigit: form.accountDigit || null,
      accountType: form.accountType || null,
      pixKeyType: form.pixKeyType || null,
      pixKey: form.pixKey || null,
    };
    return {
      type: section.type,
      personType,
      name: form.name,
      tradeName: personType === 'LEGAL' ? form.tradeName : null,
      document: isForeign ? form.document : onlyDigits(form.document) || null,
      cityReg: isForeign ? null : form.cityReg,
      email: form.email,
      phone: isForeign ? form.phone : onlyDigits(form.phone) || null,
      mobile: isForeign ? form.mobile : onlyDigits(form.mobile) || null,
      contactPerson: form.contactPerson,
      website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
      postalCode: isForeign ? form.postalCode : onlyDigits(form.postalCode) || null,
      address: form.address,
      addressNumber: form.addressNumber,
      addressComplement: form.addressComplement,
      district: form.district,
      city: form.city,
      cityIbgeCode: isForeign ? null : form.cityIbgeCode,
      state: form.state,
      country: isForeign ? form.country : null,
      bankDetails: Object.values(bankDetails).some(Boolean) ? bankDetails : null,
    };
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    setBanner(null);
    try {
      const base = `/companies/${companyId}/contacts`;
      const saved = isEdit
        ? await api.patch<ContactDetails>(`${base}/${contact!.id}`, payload())
        : await api.post<ContactDetails>(base, payload());
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && (err.details as { fields?: string[] })?.fields?.includes('document')) {
        setErrors((e) => ({ ...e, document: err.message }));
      } else {
        setBanner({ kind: 'error', text: errorMessage(err) });
      }
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const docLabel = personType === 'LEGAL' ? 'CNPJ' : personType === 'NATURAL' ? 'CPF' : 'Nº do documento';
  const nameLabel = personType === 'LEGAL' ? 'Razão Social' : 'Nome';
  const tabs: { id: Tab; label: string }[] = [
    { id: 'contato', label: 'Dados de contato' },
    { id: 'endereco', label: 'Endereço' },
    { id: 'bancarios', label: 'Dados bancários' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="contact-drawer-title">
      <div className="absolute inset-0 bg-slate-900/40" onClick={close} />

      <div className="relative w-full md:w-[min(1080px,62vw)] md:min-w-[760px] h-full bg-white shadow-2xl flex flex-col text-slate-800">
        {/* Cabeçalho */}
        <div className="px-6 h-[72px] flex items-center justify-between border-b border-slate-200 shrink-0">
          <h2 id="contact-drawer-title" className="text-xl font-medium text-slate-700">
            {isEdit ? section.editLabel : section.newLabel}
          </h2>
          <button onClick={close} aria-label="Fechar" className="p-1.5 rounded text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Identificação */}
          <div className="px-6 py-5 space-y-5">
            {banner && (
              <div
                role={banner.kind === 'error' ? 'alert' : 'status'}
                className={`flex items-start gap-2 px-3.5 py-2.5 rounded border text-sm ${
                  banner.kind === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-nibo-blueLight border-nibo-blueBorder text-slate-700'
                }`}
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                {banner.text}
              </div>
            )}

            <div>
              <p className="text-sm font-medium text-slate-800 mb-2">Tipo de {section.singular}</p>
              <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={`Tipo de ${section.singular}`}>
                {PERSON_TYPES.map(({ id, label, icon: Icon }) => {
                  const selected = personType === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => switchPersonType(id)}
                      className={`w-[150px] h-[90px] p-3.5 rounded-md border text-left flex flex-col justify-between transition-colors ${
                        selected ? 'bg-nibo-blueLight border-nibo-blueBorder' : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-6 h-6 text-nibo-blue" strokeWidth={1.7} />
                      <span className="text-sm text-slate-800">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-4 max-w-4xl">
              <Field
                label={docLabel}
                htmlFor="ct-doc"
                error={errors.document}
                className={personType === 'FOREIGN' ? 'md:col-span-4' : 'md:col-span-6'}
              >
                <div className="flex items-center gap-3">
                  <input
                    id="ct-doc"
                    value={form.document}
                    onChange={(e) =>
                      set(
                        'document',
                        personType === 'LEGAL'
                          ? applyMask(e.target.value, MASKS.cnpj)
                          : personType === 'NATURAL'
                            ? applyMask(e.target.value, MASKS.cpf)
                            : e.target.value.slice(0, 40),
                      )
                    }
                    onKeyDown={(e) => e.key === 'Enter' && lookupCnpj()}
                    placeholder={personType === 'LEGAL' ? '__.___.___/____-__' : personType === 'NATURAL' ? '___.___.___-__' : ''}
                    inputMode={personType === 'FOREIGN' ? 'text' : 'numeric'}
                    className={`${inputClass(errors.document)} ${personType === 'FOREIGN' ? '' : 'font-mono'}`}
                  />
                  {personType === 'LEGAL' && (
                    <button
                      type="button"
                      onClick={lookupCnpj}
                      disabled={!cnpjReady || lookingUp}
                      title={cnpjReady ? 'Buscar dados na Receita Federal' : 'Digite um CNPJ válido'}
                      className="text-sm text-nibo-blue hover:underline disabled:text-sky-300 disabled:no-underline disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
                    >
                      {lookingUp && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Buscar
                    </button>
                  )}
                </div>
              </Field>

              <Field
                label={nameLabel}
                htmlFor="ct-name"
                error={errors.name}
                className={personType === 'FOREIGN' ? 'md:col-span-6' : 'md:col-span-6'}
              >
                <input id="ct-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass(errors.name)} />
              </Field>

              {personType === 'LEGAL' && (
                <Field label="Nome fantasia" htmlFor="ct-trade" className="md:col-span-6">
                  <input id="ct-trade" value={form.tradeName} onChange={(e) => set('tradeName', e.target.value)} className={inputClass()} />
                </Field>
              )}
              {personType !== 'FOREIGN' && (
                <Field label="Inscrição Municipal" htmlFor="ct-im" className="md:col-span-4">
                  <input id="ct-im" value={form.cityReg} onChange={(e) => set('cityReg', e.target.value)} className={inputClass()} />
                </Field>
              )}
            </div>
          </div>

          {/* Abas */}
          <div className="bg-slate-100 px-6 pt-5 pb-6 min-h-[340px]">
            <div className="flex flex-wrap" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-5 py-2.5 text-sm rounded-t-md ${
                    tab === t.id ? 'bg-white text-slate-900 font-medium' : 'text-nibo-blue hover:bg-white/60'
                  }`}
                >
                  {t.label}
                  {t.id === 'contato' && errors.email && <span className="ml-1 text-rose-500">•</span>}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-b-md rounded-tr-md p-5" role="tabpanel">
              {tab === 'contato' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-4">
                  <Field label="E-mail(s) para envio" hint="separados por vírgula" htmlFor="ct-email" error={errors.email} className="md:col-span-6">
                    <input id="ct-email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass(errors.email)} />
                  </Field>
                  <Field label="Telefone" htmlFor="ct-phone" className="md:col-span-3">
                    <input
                      id="ct-phone"
                      value={form.phone}
                      onChange={(e) => set('phone', personType === 'FOREIGN' ? e.target.value : formatPhone(e.target.value))}
                      inputMode="tel"
                      className={inputClass()}
                    />
                  </Field>
                  <Field label="Celular" htmlFor="ct-mobile" className="md:col-span-3">
                    <input
                      id="ct-mobile"
                      value={form.mobile}
                      onChange={(e) => set('mobile', personType === 'FOREIGN' ? e.target.value : formatPhone(e.target.value))}
                      inputMode="tel"
                      className={inputClass()}
                    />
                  </Field>
                  <Field label="Pessoa de contato" htmlFor="ct-person" className="md:col-span-6">
                    <input id="ct-person" value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="Website" htmlFor="ct-site" className="md:col-span-6">
                    <input id="ct-site" value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" className={inputClass()} />
                  </Field>
                </div>
              )}

              {tab === 'endereco' && personType !== 'FOREIGN' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-4">
                  <Field label="CEP" htmlFor="ct-cep" error={errors.postalCode} className="md:col-span-3">
                    <input
                      id="ct-cep"
                      value={form.postalCode}
                      onChange={(e) => onCepChange(e.target.value)}
                      placeholder="_____-___"
                      inputMode="numeric"
                      className={`${inputClass(errors.postalCode)} font-mono`}
                    />
                  </Field>
                  <div className="hidden md:block md:col-span-9" />
                  <Field label="Logradouro" htmlFor="ct-street" className="md:col-span-6">
                    <input id="ct-street" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Av, Rua..." className={inputClass()} />
                  </Field>
                  <Field label="Número" htmlFor="ct-number" className="md:col-span-2">
                    <input id="ct-number" value={form.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="Complemento" htmlFor="ct-compl" className="md:col-span-4">
                    <input id="ct-compl" value={form.addressComplement} onChange={(e) => set('addressComplement', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="UF" htmlFor="ct-uf" className="md:col-span-2">
                    <Select id="ct-uf" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, city: '', cityIbgeCode: '' }))}>
                      {UFS.map((uf) => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Município" htmlFor="ct-city" className="md:col-span-4">
                    <Select
                      id="ct-city"
                      value={form.cityIbgeCode}
                      disabled={!form.state || loadingMunicipios}
                      placeholder={loadingMunicipios ? 'Carregando...' : form.state ? 'Selecione...' : ''}
                      onChange={(e) => {
                        const m = municipios.find((x) => x.id === e.target.value);
                        setForm((f) => ({ ...f, cityIbgeCode: e.target.value, city: m?.name ?? '' }));
                      }}
                    >
                      {municipios.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Bairro" htmlFor="ct-district" className="md:col-span-6">
                    <input id="ct-district" value={form.district} onChange={(e) => set('district', e.target.value)} className={inputClass()} />
                  </Field>
                </div>
              )}

              {tab === 'endereco' && personType === 'FOREIGN' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-4">
                  <Field label="País" htmlFor="ct-country" className="md:col-span-4">
                    <input id="ct-country" value={form.country} onChange={(e) => set('country', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="Endereço" htmlFor="ct-street" className="md:col-span-8">
                    <input id="ct-street" value={form.address} onChange={(e) => set('address', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="Cidade" htmlFor="ct-city-free" className="md:col-span-4">
                    <input id="ct-city-free" value={form.city} onChange={(e) => set('city', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="Estado / Província" htmlFor="ct-state-free" className="md:col-span-4">
                    <input id="ct-state-free" value={form.state} onChange={(e) => set('state', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="Código postal" htmlFor="ct-zip-free" className="md:col-span-4">
                    <input id="ct-zip-free" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} className={inputClass()} />
                  </Field>
                </div>
              )}

              {tab === 'bancarios' && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-4">
                  <Field label="Banco" htmlFor="ct-bank" className="md:col-span-5">
                    <BankSelect
                      id="ct-bank"
                      banks={banks}
                      loadError={banksError}
                      value={findBank(banks, form.bankCode)}
                      onChange={(b) => set('bankCode', b.code)}
                      placeholder="Selecione um banco"
                    />
                  </Field>
                  <Field label="Agência" htmlFor="ct-agency" className="md:col-span-3">
                    <input
                      id="ct-agency"
                      value={form.agency}
                      onChange={(e) => set('agency', e.target.value.replace(/[^\d-]/g, '').slice(0, 8))}
                      inputMode="numeric"
                      className={inputClass()}
                    />
                  </Field>
                  <Field label="Conta" htmlFor="ct-account" className="md:col-span-4">
                    <div className="flex gap-2">
                      <input
                        id="ct-account"
                        value={form.accountNumber}
                        onChange={(e) => set('accountNumber', e.target.value.replace(/\D/g, '').slice(0, 14))}
                        inputMode="numeric"
                        className={inputClass()}
                      />
                      <input
                        value={form.accountDigit}
                        onChange={(e) => set('accountDigit', e.target.value.replace(/[^\dxX]/g, '').slice(0, 2).toUpperCase())}
                        aria-label="Dígito da conta"
                        className="w-12 shrink-0 h-10 px-1 text-center rounded border border-slate-300 text-sm focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight"
                      />
                    </div>
                  </Field>
                  <Field label="Tipo de conta" htmlFor="ct-acc-type" className="md:col-span-4">
                    <Select id="ct-acc-type" value={form.accountType} onChange={(e) => set('accountType', e.target.value as FormState['accountType'])}>
                      <option value="CHECKING">Conta corrente</option>
                      <option value="SAVINGS">Poupança</option>
                    </Select>
                  </Field>
                  <div className="hidden md:block md:col-span-8" />
                  <Field label="Tipo de chave Pix" htmlFor="ct-pix-type" className="md:col-span-4">
                    <Select
                      id="ct-pix-type"
                      value={form.pixKeyType}
                      onChange={(e) => {
                        const type = e.target.value as FormState['pixKeyType'];
                        set('pixKeyType', type);
                        // Sugere o próprio documento como chave quando o tipo bate
                        if (!form.pixKey && ((type === 'CNPJ' && personType === 'LEGAL') || (type === 'CPF' && personType === 'NATURAL'))) {
                          set('pixKey', form.document);
                        }
                      }}
                    >
                      {PIX_KEY_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Chave Pix" htmlFor="ct-pix" className="md:col-span-8">
                    <input id="ct-pix" value={form.pixKey} onChange={(e) => set('pixKey', e.target.value)} className={inputClass()} />
                  </Field>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="px-6 h-[76px] flex items-center justify-end gap-6 border-t border-slate-200 shrink-0">
          <button type="button" onClick={close} className="text-sm text-nibo-blue hover:underline">
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
};
