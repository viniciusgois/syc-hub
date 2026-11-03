import React, { useEffect, useState } from 'react';
import { X, Search, Loader2, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { MASKS, applyMask, formatDocument, isValidCNPJ, isValidCPF, onlyDigits } from '../../lib/documents';
import { Company, CompanyInput, PersonType, TaxRegime } from '../../types';

// ----------------------------------------------------------------------------
// Constantes
// ----------------------------------------------------------------------------

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

const TAX_REGIMES: { value: TaxRegime; label: string }[] = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real' },
  { value: 'MEI', label: 'MEI' },
];

const SEGMENTS = [
  'Agronegócio',
  'Alimentação',
  'Comércio',
  'Construção',
  'Educação',
  'Indústria',
  'Saúde',
  'Serviços',
  'Tecnologia',
  'Transporte e Logística',
  'Outros',
];

const CNAE_MASK = '9999-9/99';

type Tab = 'dados' | 'socios' | 'contatos' | 'grupos';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dados', label: 'Dados cadastrais' },
  { id: 'socios', label: 'Sócios' },
  { id: 'contatos', label: 'Contatos' },
  { id: 'grupos', label: 'Grupos de clientes' },
];

interface Partner {
  name: string;
  document: string;
  role: string;
}

interface CnpjLookup extends Partial<CompanyInput> {
  partners: { name: string; role: string | null }[];
}

type FormState = Record<
  | 'cnpj' | 'legalName' | 'tradeName' | 'code' | 'cei' | 'stateReg' | 'cityReg' | 'taxRegime'
  | 'postalCode' | 'address' | 'addressNumber' | 'addressComplement' | 'state' | 'cityIbgeCode' | 'city'
  | 'district' | 'segment' | 'cnae' | 'cnaeDescription' | 'email' | 'phone',
  string
>;

const EMPTY_FORM: FormState = {
  cnpj: '', legalName: '', tradeName: '', code: '', cei: '', stateReg: '', cityReg: '', taxRegime: '',
  postalCode: '', address: '', addressNumber: '', addressComplement: '', state: '', cityIbgeCode: '', city: '',
  district: '', segment: '', cnae: '', cnaeDescription: '', email: '', phone: '',
};

// ----------------------------------------------------------------------------
// Componentes de formulário (padrão visual Nibo)
// ----------------------------------------------------------------------------

const inputClass = (error?: string, disabled?: boolean) =>
  `w-full h-11 px-3.5 rounded border text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors ${
    error
      ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
      : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
  } ${disabled ? 'bg-slate-100 cursor-not-allowed' : 'bg-white'}`;

const Field: React.FC<{
  label: string;
  optional?: boolean;
  error?: string;
  className?: string;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, optional, error, className = '', htmlFor, children }) => (
  <div className={`flex flex-col gap-1.5 min-w-0 ${className}`}>
    <label htmlFor={htmlFor} className="text-sm font-medium text-slate-800">
      {label} {optional && <span className="italic font-normal text-slate-400">(opcional)</span>}
    </label>
    {children}
    {error && <span className="text-xs text-rose-600">{error}</span>}
  </div>
);

const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string; placeholder?: string }
> = ({ error, placeholder = 'Selecione...', children, value, ...props }) => (
  <div className="relative">
    <select
      {...props}
      value={value}
      className={`${inputClass(error, props.disabled)} appearance-none pr-9 ${value ? '' : 'text-slate-400'}`}
    >
      <option value="">{placeholder}</option>
      {children}
    </select>
    <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 border-x-[5px] border-x-transparent border-t-[6px] border-t-slate-500" />
  </div>
);

// ----------------------------------------------------------------------------
// Modal
// ----------------------------------------------------------------------------

interface CreateCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Chamado ao concluir (ou fechar) depois que a empresa já foi criada — ou ao salvar a edição */
  onCreated: (company: Company) => void;
  /** Empresa existente: abre em modo edição (dados cadastrais e contatos) */
  company?: Company | null;
}

const formFromCompany = (c: Company): FormState => ({
  ...EMPTY_FORM,
  cnpj: formatDocument(c.cnpj),
  legalName: c.legalName,
  tradeName: c.tradeName === c.legalName ? '' : c.tradeName,
  code: c.code ?? '',
  cei: c.cei ? applyMask(c.cei, MASKS.cei) : '',
  stateReg: c.stateReg ?? '',
  cityReg: c.cityReg ?? '',
  taxRegime: c.taxRegime ?? '',
  postalCode: c.postalCode ? applyMask(c.postalCode, MASKS.cep) : '',
  address: c.address ?? '',
  addressNumber: c.addressNumber ?? '',
  addressComplement: c.addressComplement ?? '',
  state: c.state ?? '',
  cityIbgeCode: c.cityIbgeCode ?? '',
  city: c.city ?? '',
  district: c.district ?? '',
  segment: c.segment ?? '',
  cnae: c.cnae ? applyMask(c.cnae, CNAE_MASK) : '',
  cnaeDescription: c.cnaeDescription ?? '',
  email: c.email ?? '',
  phone: c.phone ?? '',
});

export const CreateCompanyModal: React.FC<CreateCompanyModalProps> = ({ isOpen, onClose, onCreated, company }) => {
  const editMode = !!company;
  const [tab, setTab] = useState<Tab>('dados');
  const [personType, setPersonType] = useState<PersonType>('LEGAL');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; message: string } | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [created, setCreated] = useState<Company | null>(null);
  const [saving, setSaving] = useState(false);
  const [lookingUp, setLookingUp] = useState<'cnpj' | 'cep' | null>(null);
  const [municipios, setMunicipios] = useState<{ id: string; name: string }[]>([]);
  const [loadingMunicipios, setLoadingMunicipios] = useState(false);

  const isPJ = personType === 'LEGAL';

  // Municípios da UF selecionada (IBGE)
  useEffect(() => {
    if (!form.state) {
      setMunicipios([]);
      return;
    }
    let cancelled = false;
    setLoadingMunicipios(true);
    api
      .get<{ id: string; name: string }[]>(`/lookup/municipios/${form.state}`)
      .then((list) => !cancelled && setMunicipios(list))
      .catch(() => !cancelled && setMunicipios([]))
      .finally(() => !cancelled && setLoadingMunicipios(false));
    return () => {
      cancelled = true;
    };
  }, [form.state]);

  // Modo edição: carrega os dados da empresa ao abrir
  useEffect(() => {
    if (!isOpen || !company) return;
    setTab('dados');
    setPersonType(company.personType === 'NATURAL' ? 'NATURAL' : 'LEGAL');
    setForm(formFromCompany(company));
    setErrors({});
    setBanner(null);
    setCreated(company);
  }, [isOpen, company]);

  // Ao carregar a lista, casa o município vindo do CNPJ/CEP (pelo código IBGE)
  useEffect(() => {
    if (!form.cityIbgeCode || !municipios.length) return;
    const match = municipios.find((m) => m.id === form.cityIbgeCode);
    if (match && match.name !== form.city) setForm((f) => ({ ...f, city: match.name }));
  }, [municipios, form.cityIbgeCode, form.city]);

  if (!isOpen) return null;

  const set = (field: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const fillFrom = (data: Partial<Record<keyof FormState, string | null | undefined>>) => {
    const filled = (Object.keys(data) as (keyof FormState)[]).filter((key) => key in EMPTY_FORM && data[key]);
    setForm((f) => {
      const next = { ...f };
      for (const key of filled) next[key] = data[key] as string;
      return next;
    });
    // Campos preenchidos pela consulta deixam de ter erro
    setErrors((e) => {
      const next = { ...e };
      for (const key of filled) delete next[key];
      return next;
    });
  };

  const reset = () => {
    setTab('dados');
    setPersonType('LEGAL');
    setForm(EMPTY_FORM);
    setErrors({});
    setBanner(null);
    setPartners([]);
    setCreated(null);
  };

  const close = () => {
    // Na criação, a empresa já existe após a 1ª etapa: fechar também a seleciona. Na edição, fechar descarta.
    if (created && !editMode) onCreated(created);
    reset();
    onClose();
  };

  // --------------------------------------------------------------------------
  // Consultas
  // --------------------------------------------------------------------------

  const lookupCnpj = async () => {
    if (!isValidCNPJ(form.cnpj)) {
      setErrors((e) => ({ ...e, cnpj: 'Informe um CNPJ válido para consultar' }));
      return;
    }
    setLookingUp('cnpj');
    setBanner(null);
    try {
      const data = await api.get<CnpjLookup>(`/lookup/cnpj/${onlyDigits(form.cnpj)}`);
      fillFrom({
        ...data,
        cnpj: undefined,
        postalCode: data.postalCode ? applyMask(data.postalCode, MASKS.cep) : undefined,
        cnae: data.cnae ? applyMask(data.cnae, CNAE_MASK) : undefined,
        phone: data.phone ?? undefined,
      });
      if (data.partners.length) {
        setPartners(data.partners.map((p) => ({ name: p.name, document: '', role: p.role ?? '' })));
      }
      setBanner({ kind: 'info', message: 'Dados preenchidos a partir da Receita Federal. Confira antes de salvar.' });
    } catch (err) {
      setBanner({ kind: 'error', message: `Consulta do CNPJ: ${errorMessage(err)}` });
    } finally {
      setLookingUp(null);
    }
  };

  const lookupCep = async (cep: string) => {
    setLookingUp('cep');
    try {
      const data = await api.get<Partial<FormState>>(`/lookup/cep/${onlyDigits(cep)}`);
      fillFrom({ ...data, postalCode: undefined });
    } catch {
      setErrors((e) => ({ ...e, postalCode: 'CEP não encontrado' }));
    } finally {
      setLookingUp(null);
    }
  };

  const handleCepChange = (value: string) => {
    const masked = applyMask(value, MASKS.cep);
    set('postalCode', masked);
    if (onlyDigits(masked).length === 8) lookupCep(masked);
  };

  // --------------------------------------------------------------------------
  // Etapa 1: dados cadastrais -> cria a empresa
  // --------------------------------------------------------------------------

  const validateDados = () => {
    const next: typeof errors = {};
    if (isPJ ? !isValidCNPJ(form.cnpj) : !isValidCPF(form.cnpj)) next.cnpj = isPJ ? 'CNPJ inválido' : 'CPF inválido';
    if (form.legalName.trim().length < 2) next.legalName = isPJ ? 'Informe a razão social' : 'Informe o nome';
    if (form.cei && onlyDigits(form.cei).length !== 12) next.cei = 'CEI deve ter 12 dígitos';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const companyPayload = (): CompanyInput => ({
    personType,
    cnpj: onlyDigits(form.cnpj),
    legalName: form.legalName.trim(),
    tradeName: form.tradeName.trim() || null,
    code: form.code,
    cei: form.cei,
    stateReg: form.stateReg,
    cityReg: form.cityReg,
    ...(form.taxRegime && { taxRegime: form.taxRegime as TaxRegime }),
    postalCode: form.postalCode,
    address: form.address,
    addressNumber: form.addressNumber,
    addressComplement: form.addressComplement,
    state: form.state || null,
    city: form.city,
    cityIbgeCode: form.cityIbgeCode,
    district: form.district,
    segment: form.segment,
    cnae: form.cnae,
    cnaeDescription: form.cnaeDescription,
  });

  const saveDados = async () => {
    if (!validateDados()) return;
    setSaving(true);
    setBanner(null);
    try {
      const company = created
        ? await api.patch<Company>(`/companies/${created.id}`, companyPayload())
        : await api.post<Company>('/companies', companyPayload());
      setCreated(company);
      setTab('socios');
    } catch (err) {
      const message = errorMessage(err);
      if (/duplicado/i.test(message)) setErrors((e) => ({ ...e, cnpj: `${isPJ ? 'CNPJ' : 'CPF'} já cadastrado` }));
      else setBanner({ kind: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------------------------------
  // Etapa 2: sócios -> contatos do tipo PARTNER da nova empresa
  // --------------------------------------------------------------------------

  const savePartners = async () => {
    if (!created) return;
    const valid = partners.filter((p) => p.name.trim());
    setSaving(true);
    setBanner(null);
    try {
      for (const p of valid) {
        await api.post(`/companies/${created.id}/contacts`, {
          type: 'PARTNER',
          name: p.name.trim(),
          // Sócio pode ser pessoa física (CPF) ou jurídica (CNPJ)
          personType: onlyDigits(p.document).length > 11 ? 'LEGAL' : 'NATURAL',
          ...(p.document && { document: p.document }),
          ...(p.role && { notes: p.role }),
        });
      }
      setPartners([]); // já gravados: evita duplicar se voltar para a aba
      setTab('contatos');
    } catch (err) {
      setBanner({ kind: 'error', message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------------------------------
  // Etapa 3: contatos (e-mail / telefone da empresa)
  // --------------------------------------------------------------------------

  const saveContatos = async () => {
    if (!created) return;
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setErrors((e) => ({ ...e, email: 'E-mail inválido' }));
      return;
    }
    setSaving(true);
    try {
      const company = await api.patch<Company>(`/companies/${created.id}`, {
        email: form.email.trim() || null,
        phone: form.phone,
      });
      onCreated(company);
      reset();
      onClose();
    } catch (err) {
      setBanner({ kind: 'error', message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  /** Edição: grava dados cadastrais e contatos de uma vez */
  const saveEdit = async () => {
    if (!created || !validateDados()) {
      setTab('dados');
      return;
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setErrors((e) => ({ ...e, email: 'E-mail inválido' }));
      setTab('contatos');
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const updated = await api.patch<Company>(`/companies/${created.id}`, { ...companyPayload(), email: form.email.trim() || null, phone: form.phone });
      onCreated(updated);
      onClose();
    } catch (err) {
      setBanner({ kind: 'error', message: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const primaryAction = editMode ? saveEdit : { dados: saveDados, socios: savePartners, contatos: saveContatos, grupos: saveContatos }[tab];
  const primaryLabel = editMode ? 'Salvar' : tab === 'contatos' ? 'Concluir' : 'Salvar e continuar';

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50" role="dialog" aria-modal="true" aria-labelledby="create-company-title">
      <div className="w-full max-w-5xl h-[94vh] max-h-[960px] bg-white rounded-md shadow-2xl flex flex-col overflow-hidden text-slate-800">
        {/* Cabeçalho */}
        <div className="px-7 py-5 flex items-center justify-between border-b border-slate-200">
          <h2 id="create-company-title" className="text-2xl font-medium text-slate-600">
            {editMode ? 'Editar empresa' : 'Criar empresa'}
          </h2>
          <button
            onClick={close}
            aria-label="Fechar"
            className="w-14 h-14 flex items-center justify-center rounded-lg border-2 border-nibo-blue/70 text-slate-500 hover:bg-slate-50"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Abas + conteúdo */}
        <div className="flex-1 min-h-0 bg-slate-100 px-5 pt-5 flex flex-col">
          <div className="flex flex-wrap" role="tablist">
            {TABS.filter((t) => !editMode || t.id === 'dados' || t.id === 'contatos').map((t) => {
              const enabled = t.id === 'dados' || (!!created && t.id !== 'grupos');
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  disabled={!enabled}
                  title={t.id === 'grupos' ? 'Em breve' : !enabled ? 'Salve os dados cadastrais primeiro' : undefined}
                  onClick={() => setTab(t.id)}
                  className={`px-7 py-3 text-base rounded-t-md transition-colors ${
                    active
                      ? 'bg-white text-slate-900 font-medium'
                      : enabled
                        ? 'text-nibo-blue hover:bg-white/60'
                        : 'text-sky-300 cursor-not-allowed'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto bg-white px-9 py-7">
            {banner && (
              <div
                className={`mb-6 flex items-start gap-2 px-4 py-3 rounded border text-sm ${
                  banner.kind === 'error' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-nibo-blueLight border-nibo-blueBorder text-slate-700'
                }`}
              >
                {banner.kind === 'error' ? (
                  <AlertCircle className="w-4 h-4 mt-0.5 text-rose-500 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-nibo-blue shrink-0" />
                )}
                <span>{banner.message}</span>
              </div>
            )}

            {tab === 'dados' && (
              <div className="space-y-6">
                {/* Tipo de pessoa */}
                <div className="flex items-center gap-8">
                  {(['LEGAL', 'NATURAL'] as PersonType[]).map((pt) => (
                    <label key={pt} className="flex items-center gap-2.5 cursor-pointer text-base text-slate-700">
                      <input
                        type="radio"
                        name="personType"
                        checked={personType === pt}
                        disabled={!!created}
                        onChange={() => {
                          setPersonType(pt);
                          setForm((f) => ({ ...f, cnpj: '' }));
                          setErrors({});
                        }}
                        className="w-5 h-5 accent-nibo-blue"
                      />
                      {pt === 'LEGAL' ? 'Pessoa Jurídica' : 'Pessoa Física'}
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-7 gap-y-5">
                  <Field label={isPJ ? 'CNPJ' : 'CPF'} error={errors.cnpj} className="md:col-span-3" htmlFor="cc-doc">
                    <div className="relative">
                      <input
                        id="cc-doc"
                        value={form.cnpj}
                        onChange={(e) => set('cnpj', applyMask(e.target.value, isPJ ? MASKS.cnpj : MASKS.cpf))}
                        onKeyDown={(e) => isPJ && e.key === 'Enter' && lookupCnpj()}
                        placeholder={isPJ ? '__.___.___/____-__' : '___.___.___-__'}
                        inputMode="numeric"
                        className={`${inputClass(errors.cnpj)} pr-10 font-mono`}
                      />
                      {isPJ && (
                        <button
                          type="button"
                          onClick={lookupCnpj}
                          disabled={lookingUp === 'cnpj'}
                          title="Buscar dados na Receita Federal"
                          aria-label="Buscar dados do CNPJ"
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-nibo-blue hover:bg-nibo-blueLight disabled:opacity-60"
                        >
                          {lookingUp === 'cnpj' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </Field>

                  <Field label={isPJ ? 'Razão Social' : 'Nome'} error={errors.legalName} className="md:col-span-6" htmlFor="cc-name">
                    <input id="cc-name" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} className={inputClass(errors.legalName)} />
                  </Field>

                  <Field label="Código" className="md:col-span-3" htmlFor="cc-code">
                    <input id="cc-code" value={form.code} onChange={(e) => set('code', e.target.value)} className={inputClass()} />
                  </Field>

                  <Field label="CEI" optional error={errors.cei} className="md:col-span-3" htmlFor="cc-cei">
                    <input
                      id="cc-cei"
                      value={form.cei}
                      onChange={(e) => set('cei', applyMask(e.target.value, MASKS.cei))}
                      placeholder="__.___._____/__"
                      inputMode="numeric"
                      className={`${inputClass(errors.cei)} font-mono`}
                    />
                  </Field>

                  <Field label="Inscrição Estadual" optional className="md:col-span-3" htmlFor="cc-ie">
                    <input id="cc-ie" value={form.stateReg} onChange={(e) => set('stateReg', e.target.value)} className={inputClass()} />
                  </Field>

                  <Field label="Inscrição Municipal" optional className="md:col-span-3" htmlFor="cc-im">
                    <input id="cc-im" value={form.cityReg} onChange={(e) => set('cityReg', e.target.value)} className={inputClass()} />
                  </Field>

                  <Field label="Regime tributário" optional className="md:col-span-3" htmlFor="cc-regime">
                    <Select id="cc-regime" value={form.taxRegime} onChange={(e) => set('taxRegime', e.target.value)}>
                      {TAX_REGIMES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                {/* Endereço */}
                <h3 className="text-xl font-medium text-slate-800 pt-3">Endereço</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-7 gap-y-5">
                  <Field label="CEP" error={errors.postalCode} className="md:col-span-3" htmlFor="cc-cep">
                    <div className="relative">
                      <input
                        id="cc-cep"
                        value={form.postalCode}
                        onChange={(e) => handleCepChange(e.target.value)}
                        placeholder="_____-___"
                        inputMode="numeric"
                        className={`${inputClass(errors.postalCode)} font-mono`}
                      />
                      {lookingUp === 'cep' && <Loader2 className="w-4 h-4 animate-spin text-nibo-blue absolute right-3 top-1/2 -translate-y-1/2" />}
                    </div>
                  </Field>
                  <div className="hidden md:block md:col-span-9" />

                  <Field label="Logradouro" className="md:col-span-6" htmlFor="cc-street">
                    <input id="cc-street" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Av, Rua..." className={inputClass()} />
                  </Field>
                  <Field label="Número" className="md:col-span-2" htmlFor="cc-number">
                    <input id="cc-number" value={form.addressNumber} onChange={(e) => set('addressNumber', e.target.value)} className={inputClass()} />
                  </Field>
                  <Field label="Complemento" className="md:col-span-4" htmlFor="cc-compl">
                    <input id="cc-compl" value={form.addressComplement} onChange={(e) => set('addressComplement', e.target.value)} className={inputClass()} />
                  </Field>

                  <Field label="UF" className="md:col-span-2" htmlFor="cc-uf">
                    <Select
                      id="cc-uf"
                      value={form.state}
                      onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, city: '', cityIbgeCode: '' }))}
                    >
                      {UFS.map((uf) => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Município" className="md:col-span-4" htmlFor="cc-city">
                    <Select
                      id="cc-city"
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
                  <Field label="Bairro" className="md:col-span-6" htmlFor="cc-district">
                    <input id="cc-district" value={form.district} onChange={(e) => set('district', e.target.value)} className={inputClass()} />
                  </Field>
                </div>

                {/* Atividade */}
                <h3 className="text-xl font-medium text-slate-800 pt-3">Atividade</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-7 gap-y-5">
                  <Field label="Ramo de atividade" className="md:col-span-4" htmlFor="cc-segment">
                    <Select id="cc-segment" value={form.segment} onChange={(e) => set('segment', e.target.value)}>
                      {SEGMENTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <h3 className="text-xl font-medium text-slate-800 pt-3">CNAE Federal</h3>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-x-7 gap-y-5 pb-2">
                  <Field label="Código" optional className="md:col-span-3" htmlFor="cc-cnae">
                    <input
                      id="cc-cnae"
                      value={form.cnae}
                      onChange={(e) => set('cnae', applyMask(e.target.value, CNAE_MASK))}
                      placeholder="____-_/__"
                      inputMode="numeric"
                      className={`${inputClass()} font-mono`}
                    />
                  </Field>
                  <Field label="Descrição" optional className="md:col-span-9" htmlFor="cc-cnae-desc">
                    <input id="cc-cnae-desc" value={form.cnaeDescription} onChange={(e) => set('cnaeDescription', e.target.value)} className={inputClass()} />
                  </Field>
                </div>
              </div>
            )}

            {tab === 'socios' && (
              <div className="space-y-5">
                <p className="text-sm text-slate-500">
                  Os sócios ficam cadastrados como contatos da empresa e podem ser usados em pró-labore e distribuição de lucros.
                </p>
                {partners.length === 0 && <p className="text-sm text-slate-400">Nenhum sócio adicionado.</p>}
                {partners.map((p, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-x-5 gap-y-3 items-end">
                    <Field label="Nome" className="md:col-span-5" htmlFor={`p-name-${i}`}>
                      <input
                        id={`p-name-${i}`}
                        value={p.name}
                        onChange={(e) => setPartners((ps) => ps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        className={inputClass()}
                      />
                    </Field>
                    <Field label="CPF / CNPJ" optional className="md:col-span-3" htmlFor={`p-doc-${i}`}>
                      <input
                        id={`p-doc-${i}`}
                        value={p.document}
                        onChange={(e) => {
                          const d = onlyDigits(e.target.value);
                          const value = applyMask(d, d.length > 11 ? MASKS.cnpj : MASKS.cpf);
                          setPartners((ps) => ps.map((x, j) => (j === i ? { ...x, document: value } : x)));
                        }}
                        inputMode="numeric"
                        className={`${inputClass()} font-mono`}
                      />
                    </Field>
                    <Field label="Qualificação" optional className="md:col-span-3" htmlFor={`p-role-${i}`}>
                      <input
                        id={`p-role-${i}`}
                        value={p.role}
                        onChange={(e) => setPartners((ps) => ps.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                        className={inputClass()}
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={() => setPartners((ps) => ps.filter((_, j) => j !== i))}
                      aria-label="Remover sócio"
                      className="md:col-span-1 h-11 flex items-center justify-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setPartners((ps) => [...ps, { name: '', document: '', role: '' }])}
                  className="flex items-center gap-1.5 text-sm font-medium text-nibo-blue hover:underline"
                >
                  <Plus className="w-4 h-4" /> Adicionar sócio
                </button>
              </div>
            )}

            {tab === 'contatos' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-x-7 gap-y-5">
                <Field label="E-mail" optional error={errors.email} className="md:col-span-6" htmlFor="cc-email">
                  <input id="cc-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass(errors.email)} />
                </Field>
                <Field label="Telefone" optional className="md:col-span-4" htmlFor="cc-phone">
                  <input id="cc-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" className={inputClass()} />
                </Field>
              </div>
            )}
          </div>
        </div>

        {/* Rodapé */}
        <div className="px-7 py-4 flex items-center justify-end gap-6 border-t border-slate-200 bg-white">
          {tab === 'socios' && (
            <button type="button" onClick={() => setTab('contatos')} className="text-base text-nibo-blue hover:underline">
              Pular
            </button>
          )}
          <button type="button" onClick={close} className="text-base text-nibo-blue hover:underline">
            {created && !editMode ? 'Fechar' : 'Cancelar'}
          </button>
          <button
            type="button"
            onClick={primaryAction}
            disabled={saving}
            className="px-6 h-12 rounded-md bg-nibo-blue hover:bg-nibo-blueHover text-white text-base font-medium flex items-center gap-2 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
