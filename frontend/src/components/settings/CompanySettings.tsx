import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Pencil, Download, RefreshCcw, Trash2, ImagePlus, Loader2, X } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { MASKS, applyMask, formatDocument, formatPhone, onlyDigits } from '../../lib/documents';
import { Company } from '../../types';
import { CreateCompanyModal } from '../companies/CreateCompanyModal';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';

const TAX_REGIME_LABEL: Record<string, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
  MEI: 'MEI',
};
const CONTACT_TYPE_LABEL: Record<string, string> = { CUSTOMER: 'Cliente', SUPPLIER: 'Fornecedor', EMPLOYEE: 'Funcionário', PARTNER: 'Sócio', OTHER: 'Outro' };
const LOGO_SIZE = 100;

/** Reduz a imagem para 100x100 (centralizada, fundo branco) e devolve como data URL PNG */
function resizeLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = LOGO_SIZE;
      canvas.height = LOGO_SIZE;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, LOGO_SIZE, LOGO_SIZE);
      const scale = Math.min(LOGO_SIZE / img.width, LOGO_SIZE / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (LOGO_SIZE - w) / 2, (LOGO_SIZE - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem'));
    };
    img.src = url;
  });
}

const Info: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className="text-sm font-medium text-slate-800">{label}</p>
    <div className="text-sm text-slate-600 mt-0.5">{children || '-'}</div>
  </div>
);

export const CompanySettings: React.FC = () => {
  const { currentCompany: c, updateCompany, removeCompany, notify, refresh } = useCompany();
  const [editing, setEditing] = useState(false);
  const [danger, setDanger] = useState<'clear' | 'delete' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [dangerError, setDangerError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isPJ = c.personType !== 'NATURAL';

  const uploadLogo = async (file: File) => {
    if (!/^image\/(png|jpe?g|bmp|webp)$/.test(file.type)) {
      notify('Envie uma imagem .jpg, .png ou .bmp', 'error');
      return;
    }
    try {
      updateCompany(await api.patch<Company>(`/companies/${c.id}`, { logoUrl: await resizeLogo(file) }));
      notify('Logo atualizada');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const removeLogo = async () => {
    try {
      updateCompany(await api.patch<Company>(`/companies/${c.id}`, { logoUrl: null }));
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const exportContacts = async () => {
    try {
      const list = await api.get<Record<string, unknown>[]>(`/companies/${c.id}/contacts?archived=true`);
      const rows = list.map((x) => ({
        Tipo: CONTACT_TYPE_LABEL[String(x.type)] ?? x.type,
        Nome: x.name,
        'Nome fantasia': x.tradeName ?? '',
        Documento: x.personType === 'FOREIGN' ? x.document ?? '' : formatDocument(String(x.document ?? '')),
        'E-mail': x.email ?? '',
        Telefone: x.phone ? formatPhone(String(x.phone)) : '',
        Celular: x.mobile ? formatPhone(String(x.mobile)) : '',
        Cidade: x.city ?? '',
        UF: x.state ?? '',
        Situação: x.isActive ? 'Ativo' : 'Arquivado',
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Contatos');
      XLSX.writeFile(wb, `Contatos_${c.tradeName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_')}.xlsx`);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const runDanger = async () => {
    if (onlyDigits(confirm) !== c.cnpj) {
      setDangerError(`Digite ${isPJ ? 'o CNPJ' : 'o CPF'} ${formatDocument(c.cnpj)} para confirmar`);
      return;
    }
    setBusy(true);
    setDangerError(null);
    try {
      if (danger === 'clear') {
        const r = await api.post<{ transactions: number; receivables: number; payables: number }>(`/companies/${c.id}/clear-data`, { confirm });
        notify(`Dados limpos: ${r.transactions} lançamentos, ${r.receivables} a receber e ${r.payables} a pagar removidos`);
        setDanger(null);
        refresh();
      } else {
        await api.delete(`/companies/${c.id}`, { confirm });
        notify(`Empresa ${c.legalName} excluída`);
        removeCompany(c.id);
      }
    } catch (err) {
      setDangerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const street = [c.address, c.addressNumber].filter(Boolean).join(', ');
  const cityLine = [c.district, [c.city, c.state].filter(Boolean).join(' - ')].filter(Boolean).join(', ');

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <div className="flex flex-col-reverse lg:flex-row gap-8">
        <div className="flex-1 space-y-5">
          <h1 className="text-xl font-medium text-slate-700 uppercase flex items-center gap-2">
            {c.legalName}
            <button onClick={() => setEditing(true)} aria-label="Editar dados da empresa" className="p-1.5 rounded text-nibo-blue hover:bg-nibo-blueLight">
              <Pencil className="w-4 h-4" />
            </button>
          </h1>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl">
            <Info label={isPJ ? 'CNPJ' : 'CPF'}>{formatDocument(c.cnpj)}</Info>
            <Info label={isPJ ? 'Razão Social' : 'Nome'}>{c.legalName}</Info>
            {isPJ && <Info label="Nome fantasia">{c.tradeName !== c.legalName ? c.tradeName : ''}</Info>}
            <Info label="Regime tributário">{TAX_REGIME_LABEL[c.taxRegime] ?? c.taxRegime}</Info>
            <Info label="Ramo de atividade">{c.segment}</Info>
            <Info label="CNAE">{c.cnae ? `${applyMask(c.cnae, '9999-9/99')} ${c.cnaeDescription ?? ''}` : ''}</Info>
            <Info label="Inscrição Estadual / Municipal">{[c.stateReg, c.cityReg].filter(Boolean).join(' / ')}</Info>
            <Info label="Contato">{[c.email, c.phone ? formatPhone(c.phone) : null].filter(Boolean).join(' · ')}</Info>
          </div>
          <div>
            <h2 className="text-base font-medium text-slate-800 mb-1">Endereço da empresa</h2>
            {street || cityLine || c.postalCode ? (
              <address className="not-italic text-sm text-slate-600 leading-6 uppercase">
                {street && <span className="block">{street}{c.addressComplement ? ` - ${c.addressComplement}` : ''}</span>}
                {cityLine && <span className="block">{cityLine}</span>}
                {c.postalCode && <span className="block">CEP {applyMask(c.postalCode, MASKS.cep)}</span>}
              </address>
            ) : (
              <p className="text-sm text-slate-400">Endereço não informado.</p>
            )}
          </div>
        </div>

        {/* Logo */}
        <div className="lg:w-64 flex flex-col items-start lg:items-center">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative w-[100px] h-[100px] rounded-md border border-slate-200 bg-white flex items-center justify-center overflow-hidden hover:border-nibo-blue group"
            aria-label={c.logoUrl ? 'Trocar logo' : 'Enviar logo'}
          >
            {c.logoUrl ? (
              <img src={c.logoUrl} alt={`Logo ${c.tradeName}`} className="w-full h-full object-contain" />
            ) : (
              <ImagePlus className="w-7 h-7 text-slate-300 group-hover:text-nibo-blue" />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".jpg,.jpeg,.png,.bmp,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadLogo(f);
              e.target.value = '';
            }}
          />
          <p className="text-xs text-slate-500 mt-1.5 lg:text-center">
            Tamanho: 100px / 100px
            <br />( .jpg, .jpeg, .png e .bmp )
          </p>
          {c.logoUrl && (
            <button onClick={removeLogo} className="mt-1 text-xs text-nibo-blue hover:underline flex items-center gap-1">
              <X className="w-3 h-3" /> Remover logo
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 pt-5 border-t border-slate-200 space-y-3">
        <button onClick={exportContacts} className="flex items-center gap-2 text-sm text-nibo-blue hover:underline">
          <Download className="w-4 h-4" /> Exportar contatos
        </button>
        <button onClick={() => (setConfirm(''), setDangerError(null), setDanger('clear'))} className="flex items-center gap-2 text-sm text-nibo-blue hover:underline">
          <RefreshCcw className="w-4 h-4" /> Limpar dados da empresa
        </button>
        <button onClick={() => (setConfirm(''), setDangerError(null), setDanger('delete'))} className="flex items-center gap-2 text-sm text-nibo-blue hover:underline">
          <Trash2 className="w-4 h-4" /> Excluir a empresa
        </button>
      </div>

      <CreateCompanyModal
        isOpen={editing}
        company={c}
        onClose={() => setEditing(false)}
        onCreated={(updated) => {
          updateCompany(updated);
          notify('Dados da empresa atualizados');
        }}
      />

      {danger && (
        <Modal
          title={danger === 'clear' ? 'Limpar dados da empresa' : 'Excluir a empresa'}
          onClose={() => setDanger(null)}
          busy={busy}
          footer={
            <>
              <LinkButton onClick={() => setDanger(null)}>Cancelar</LinkButton>
              <PrimaryButton className="bg-rose-600 hover:bg-rose-700" onClick={runDanger} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {danger === 'clear' ? 'Limpar dados' : 'Excluir empresa'}
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-4 text-sm text-slate-700">
            {danger === 'clear' ? (
              <p>
                Apaga <strong>todos os lançamentos do extrato, importações, contas a pagar/receber e recorrências</strong> de {c.legalName}. Os saldos das contas voltam
                ao saldo inicial. Empresa, contas bancárias, plano de contas, contatos, centros de custo e regras são mantidos.
              </p>
            ) : (
              <p>
                Exclui <strong>{c.legalName}</strong> e <strong>todos os seus dados</strong> (contas, lançamentos, contatos, plano de contas...). Esta ação não pode ser
                desfeita.
              </p>
            )}
            <div>
              <label htmlFor="danger-confirm" className="block font-medium text-slate-800 mb-1.5">
                Para confirmar, digite {isPJ ? 'o CNPJ' : 'o CPF'} {formatDocument(c.cnpj)}
              </label>
              <input
                id="danger-confirm"
                autoFocus
                value={confirm}
                onChange={(e) => (setConfirm(e.target.value), setDangerError(null))}
                inputMode="numeric"
                className={`${fieldClass(dangerError ?? undefined)} font-mono`}
              />
              {dangerError && <p className="text-xs text-rose-600 mt-1">{dangerError}</p>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
