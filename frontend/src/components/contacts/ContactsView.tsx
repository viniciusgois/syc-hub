import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Printer, Pencil, ChevronDown, ChevronUp, Archive, ArchiveRestore, Trash2, Loader2, Star, Users } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { formatDocument, formatPhone, applyMask, MASKS } from '../../lib/documents';
import { ContactSection, PIX_KEY_TYPES } from '../../lib/contacts';
import { ContactDetails } from '../../types';
import { ContactDrawer } from './ContactDrawer';

// ----------------------------------------------------------------------------
// Tipos da API
// ----------------------------------------------------------------------------

interface Annotation {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; name: string } | null;
}

interface ContactFull extends ContactDetails {
  moved12m: number;
  upcoming: { id: string; kind: 'RECEIVABLE' | 'PAYABLE'; description: string; documentNumber: string | null; dueDate: string; amount: number }[];
  recentTransactions: {
    id: string;
    date: string;
    description: string;
    customDescription: string | null;
    checknum: string | null;
    type: 'CREDIT' | 'DEBIT';
    amount: number;
    bankAccount: { name: string };
  }[];
  annotations: Annotation[];
}

type SortKey = 'name' | 'openAmount' | 'overdueAmount';

const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y.slice(2)}`;
};
const normalize = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Documento para exibição (exterior fica como digitado) */
const displayDocument = (c: Pick<ContactDetails, 'document' | 'personType'>) =>
  c.document ? (c.personType === 'FOREIGN' ? c.document : formatDocument(c.document)) : '';

const SortHeader: React.FC<{
  k: SortKey;
  label: string;
  sort: { key: SortKey; dir: 1 | -1 };
  onToggle: (k: SortKey) => void;
  className?: string;
}> = ({ k, label, sort, onToggle, className = '' }) => (
  <button
    type="button"
    onClick={() => onToggle(k)}
    className={`flex items-center gap-1 text-xs font-medium ${sort.key === k ? 'text-nibo-blue' : 'text-slate-700'} ${className}`}
  >
    {sort.key === k && sort.dir === -1 ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
    {label}
  </button>
);

// ----------------------------------------------------------------------------
// Tela
// ----------------------------------------------------------------------------

export const ContactsView: React.FC<{ section: ContactSection }> = ({ section }) => {
  const { currentCompany, reloadContacts, notify } = useCompany();
  const base = `/companies/${currentCompany.id}/contacts`;

  const [list, setList] = useState<ContactDetails[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContactFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; editing: ContactDetails | null }>({ open: false, editing: null });

  const loadList = useCallback(async () => {
    try {
      setListError(null);
      const data = await api.get<ContactDetails[]>(`${base}?type=${section.type}${showArchived ? '&archived=true' : ''}`);
      setList(data);
      setSelectedId((current) => (current && data.some((c) => c.id === current) ? current : (data[0]?.id ?? null)));
    } catch (err) {
      setListError(errorMessage(err));
    }
  }, [base, section.type, showArchived]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        setDetail(await api.get<ContactFull>(`${base}/${id}`));
      } catch (err) {
        notify(errorMessage(err), 'error');
      } finally {
        setDetailLoading(false);
      }
    },
    [base, notify],
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const visible = useMemo(() => {
    const term = normalize(search.trim());
    const digits = search.replace(/\D/g, '');
    const filtered = (list ?? []).filter(
      (c) =>
        !term ||
        normalize(c.name).includes(term) ||
        (c.tradeName && normalize(c.tradeName).includes(term)) ||
        (digits && c.document?.includes(digits)),
    );
    return [...filtered].sort((a, b) =>
      sort.key === 'name' ? a.name.localeCompare(b.name, 'pt-BR') * sort.dir : (a[sort.key] - b[sort.key]) * sort.dir,
    );
  }, [list, search, sort]);

  const totals = useMemo(
    () => visible.reduce((t, c) => ({ open: t.open + c.openAmount, overdue: t.overdue + c.overdueAmount }), { open: 0, overdue: 0 }),
    [visible],
  );

  const toggleSort = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }));

  const afterSave = async (saved: ContactDetails) => {
    const wasEdit = !!drawer.editing;
    setDrawer({ open: false, editing: null });
    notify(wasEdit ? 'Cadastro atualizado' : `${section.singular.charAt(0).toUpperCase()}${section.singular.slice(1)} ${saved.name} cadastrado`);
    await loadList();
    setSelectedId(saved.id);
    loadDetail(saved.id);
    reloadContacts();
  };

  const setArchived = async (archived: boolean) => {
    if (!detail) return;
    try {
      if (archived) await api.delete(`${base}/${detail.id}`);
      else await api.patch(`${base}/${detail.id}`, { isActive: true });
      notify(archived ? `${detail.name} arquivado` : `${detail.name} reativado`);
      await loadList();
      loadDetail(detail.id);
      reloadContacts();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-nibo-bg text-slate-800">
      {/* Cabeçalho */}
      <div className="px-6 py-4 flex items-center justify-between bg-white border-b border-slate-200 shrink-0">
        <h1 className="text-xl font-medium text-slate-800">{section.title}</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => window.print()} title="Imprimir" aria-label="Imprimir" className="p-2 rounded text-slate-500 hover:bg-slate-100">
            <Printer className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDrawer({ open: true, editing: null })}
            className="flex items-center gap-1.5 px-4 h-9 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {section.newLabel}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Lista */}
        <aside className="lg:w-[360px] shrink-0 bg-white border-r border-slate-200 flex flex-col min-h-[320px]">
          <div className="p-4 flex items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar pelo nome..."
              aria-label={`Buscar ${section.title.toLowerCase()}`}
              className="flex-1 h-9 px-4 rounded-full bg-slate-100 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-nibo-blueLight"
            />
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer whitespace-nowrap">
              <span className="relative inline-flex">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="peer sr-only" />
                <span className="w-8 h-4 rounded-full bg-slate-300 peer-checked:bg-nibo-blue transition-colors" />
                <span className="absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
              </span>
              Ver arquivados
            </label>
          </div>

          <div className="px-4 py-2 grid grid-cols-[1fr_80px_72px] gap-2 border-b border-slate-200">
            <SortHeader k="name" label="Nome" sort={sort} onToggle={toggleSort} />
            <SortHeader k="openAmount" label="Em aberto" sort={sort} onToggle={toggleSort} className="justify-end" />
            <SortHeader k="overdueAmount" label="Vencido" sort={sort} onToggle={toggleSort} className="justify-end" />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto" role="listbox" aria-label={section.title}>
            {!list && !listError && (
              <p className="p-4 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
              </p>
            )}
            {listError && <p className="p-4 text-sm text-rose-600">{listError}</p>}
            {list && visible.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                {search ? 'Nenhum resultado para a busca.' : `Nenhum ${section.singular} cadastrado.`}
              </div>
            )}
            {visible.map((c) => {
              const selected = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full px-4 py-2.5 grid grid-cols-[1fr_80px_72px] gap-2 items-start text-left border-b border-slate-100 ${
                    selected ? 'bg-nibo-blueLight' : 'hover:bg-slate-50'
                  } ${c.isActive ? '' : 'opacity-60'}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm text-nibo-blue uppercase break-words">{c.name}</span>
                    {c.document && <span className="block text-xs text-slate-500 mt-0.5">{displayDocument(c)}</span>}
                    {!c.isActive && <span className="text-[10px] font-semibold text-slate-500">ARQUIVADO</span>}
                  </span>
                  <span className="text-sm text-right text-slate-800">{money(c.openAmount)}</span>
                  <span className="text-sm text-right text-rose-600">{money(c.overdueAmount)}</span>
                </button>
              );
            })}
          </div>

          <div className="px-4 py-3 grid grid-cols-[1fr_80px_72px] gap-2 bg-slate-100 text-sm font-medium border-t border-slate-200">
            <span>Total</span>
            <span className="text-right">{money(totals.open)}</span>
            <span className="text-right">{money(totals.overdue)}</span>
          </div>
        </aside>

        {/* Detalhe */}
        <section className="flex-1 min-w-0 overflow-y-auto p-5">
          {!detail && detailLoading && (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
            </p>
          )}
          {!detail && !detailLoading && list && list.length > 0 && <p className="text-sm text-slate-500">Selecione um {section.singular}.</p>}
          {!detail && list?.length === 0 && (
            <div className="max-w-md mx-auto mt-16 text-center">
              <p className="text-base font-medium text-slate-700">Cadastre seu primeiro {section.singular}</p>
              <p className="text-sm text-slate-500 mt-1">Os {section.title.toLowerCase()} aparecem nos lançamentos e na conciliação do extrato.</p>
              <button
                onClick={() => setDrawer({ open: true, editing: null })}
                className="mt-4 inline-flex items-center gap-1.5 px-4 h-9 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium"
              >
                <Plus className="w-4 h-4" /> {section.newLabel}
              </button>
            </div>
          )}
          {detail && (
            <ContactDetailPanel
              detail={detail}
              section={section}
              loading={detailLoading}
              onEdit={() => setDrawer({ open: true, editing: detail })}
              onArchive={setArchived}
              onNotesChanged={() => loadDetail(detail.id)}
              base={base}
            />
          )}
        </section>
      </div>

      <ContactDrawer
        isOpen={drawer.open}
        section={section}
        companyId={currentCompany.id}
        contact={drawer.editing}
        onClose={() => setDrawer({ open: false, editing: null })}
        onSaved={afterSave}
      />
    </div>
  );
};

// ----------------------------------------------------------------------------
// Painel de detalhe
// ----------------------------------------------------------------------------

const Card: React.FC<{ title?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  title,
  action,
  className = '',
  children,
}) => (
  <div className={`bg-white rounded-md border border-slate-200/80 ${className}`}>
    {title && (
      <div className="px-5 pt-4 pb-2.5 flex items-center justify-between border-b border-slate-100">
        <h3 className="text-base font-medium text-slate-800">{title}</h3>
        {action}
      </div>
    )}
    {children}
  </div>
);

const Info: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0">
    <p className="text-sm font-medium text-slate-700">{label}</p>
    <p className="text-sm text-slate-600 mt-0.5 break-words">{value || '-'}</p>
  </div>
);

const ContactDetailPanel: React.FC<{
  detail: ContactFull;
  section: ContactSection;
  loading: boolean;
  base: string;
  onEdit: () => void;
  onArchive: (archived: boolean) => void;
  onNotesChanged: () => void;
}> = ({ detail, section, loading, base, onEdit, onArchive, onNotesChanged }) => {
  const { notify } = useCompany();
  const [expanded, setExpanded] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const phones = [detail.phone, detail.mobile].filter(Boolean).map((p) => (detail.personType === 'FOREIGN' ? p : formatPhone(p!)));
  const bd = detail.bankDetails;
  const address =
    [
      [detail.address, detail.addressNumber].filter(Boolean).join(', '),
      detail.addressComplement,
      detail.district,
      [detail.city, detail.state].filter(Boolean).join(' - '),
      detail.postalCode ? (detail.personType === 'FOREIGN' ? detail.postalCode : applyMask(detail.postalCode, MASKS.cep)) : null,
      detail.country,
    ]
      .filter(Boolean)
      .join(' · ') || null;

  const saveNote = async () => {
    if (!noteDraft?.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`${base}/${detail.id}/notes`, { text: noteDraft });
      setNoteDraft(null);
      onNotesChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm('Excluir esta anotação?')) return;
    try {
      await api.delete(`${base}/${detail.id}/notes/${id}`);
      onNotesChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div className={`grid grid-cols-1 xl:grid-cols-[1fr_200px] gap-4 ${loading ? 'opacity-70' : ''}`}>
      {/* Coluna principal */}
      <div className="space-y-4 min-w-0">
        <Card>
          <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-medium text-slate-700 uppercase break-words">{detail.name}</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {displayDocument(detail) || '-'}
                {!detail.isActive && <span className="ml-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">ARQUIVADO</span>}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onArchive(detail.isActive)}
                title={detail.isActive ? 'Arquivar' : 'Reativar'}
                aria-label={detail.isActive ? 'Arquivar' : 'Reativar'}
                className="p-2 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                {detail.isActive ? <Archive className="w-4 h-4" /> : <ArchiveRestore className="w-4 h-4" />}
              </button>
              <button onClick={onEdit} title="Editar" aria-label="Editar" className="p-2 rounded text-nibo-blue hover:bg-nibo-blueLight">
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-slate-100 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
            <div className="px-5 py-3">
              <Info label="E-mail" value={detail.email} />
            </div>
            <div className="px-5 py-3">
              <Info label="Telefone" value={phones.join(' / ')} />
            </div>
            <div className="px-5 py-3">
              <Info label="Contato" value={detail.contactPerson} />
            </div>
          </div>
          {expanded && (
            <div className="px-5 py-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {detail.personType === 'LEGAL' && <Info label="Nome fantasia" value={detail.tradeName} />}
              {detail.personType !== 'FOREIGN' && <Info label="Inscrição Municipal" value={detail.cityReg} />}
              <Info
                label="Website"
                value={
                  detail.website && (
                    <a href={detail.website} target="_blank" rel="noreferrer" className="text-nibo-blue hover:underline">
                      {detail.website}
                    </a>
                  )
                }
              />
              <Info label="Endereço" value={address} />
              <Info
                label="Dados bancários"
                value={
                  bd &&
                  [
                    bd.bankName,
                    bd.agency && `ag ${bd.agency}`,
                    bd.accountNumber && `cc ${bd.accountNumber}${bd.accountDigit ? `-${bd.accountDigit}` : ''}`,
                    bd.accountType && (bd.accountType === 'SAVINGS' ? 'Poupança' : 'Conta corrente'),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                }
              />
              <Info
                label="Chave Pix"
                value={bd?.pixKey && `${PIX_KEY_TYPES.find((t) => t.value === bd.pixKeyType)?.label ?? 'Chave'}: ${bd.pixKey}`}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="w-full py-2 border-t border-slate-100 text-sm text-nibo-blue hover:bg-slate-50 flex items-center justify-center gap-1"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {expanded ? 'Menos informações' : 'Mais informações'}
          </button>
        </Card>

        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
          <Card
            title="Anotações"
            action={
              noteDraft === null && (
                <button onClick={() => setNoteDraft('')} className="text-sm text-nibo-blue hover:underline flex items-center gap-1 whitespace-nowrap">
                  <Plus className="w-3.5 h-3.5" /> Nova anotação
                </button>
              )
            }
          >
            <div className="px-5 py-3 space-y-3">
              {noteDraft !== null && (
                <div>
                  <textarea
                    autoFocus
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    aria-label="Nova anotação"
                    className="w-full px-3 py-2 rounded border border-slate-300 text-sm focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight"
                  />
                  <div className="flex justify-end gap-4 mt-2">
                    <button onClick={() => setNoteDraft(null)} className="text-sm text-nibo-blue hover:underline">
                      Cancelar
                    </button>
                    <button
                      onClick={saveNote}
                      disabled={savingNote || !noteDraft.trim()}
                      className="px-3 h-8 rounded bg-nibo-blue text-white text-sm disabled:opacity-50"
                    >
                      Salvar
                    </button>
                  </div>
                </div>
              )}
              {detail.annotations.length === 0 && noteDraft === null && <p className="text-sm text-slate-500">Nenhuma anotação</p>}
              {detail.annotations.map((n) => (
                <div key={n.id} className="group">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{n.text}</p>
                  <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                    {n.author?.name ?? 'Usuário'} · {new Date(n.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    <button
                      onClick={() => deleteNote(n.id)}
                      aria-label="Excluir anotação"
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-400 hover:text-rose-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Arquivos">
            <p className="px-5 py-3 text-sm text-slate-500">Envio de arquivos em breve.</p>
          </Card>
        </div>

        <Card title={section.upcomingTitle}>
          {detail.upcoming.length === 0 ? (
            <p className="px-5 py-3 text-sm text-slate-500">Nenhum lançamento</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {detail.upcoming.map((u) => (
                <li key={u.id} className="px-5 py-2.5 flex items-center justify-between text-sm">
                  <span>
                    <span className="text-slate-500 mr-3">{shortDate(u.dueDate)}</span>
                    {u.description}
                  </span>
                  <span className="font-medium">{money(u.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={section.recentTitle}>
          {detail.recentTransactions.length === 0 ? (
            <p className="px-5 py-3 text-sm text-slate-500">Nenhuma movimentação vinculada a este {section.singular}.</p>
          ) : (
            <div className="px-5 py-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="w-6" />
                    <th className="text-left font-medium px-2 py-2">Descrição</th>
                    <th className="text-left font-medium px-2 py-2">Ref.</th>
                    <th className="text-left font-medium px-2 py-2">Data</th>
                    <th className="text-left font-medium px-2 py-2 hidden 2xl:table-cell">Conta</th>
                    <th className="text-right font-medium px-2 py-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentTransactions.map((t) => (
                    <tr key={t.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2">
                        <Star className="w-3.5 h-3.5 text-slate-300" />
                      </td>
                      <td className="px-2 py-2 text-nibo-blue">{t.customDescription || t.description}</td>
                      <td className="px-2 py-2 text-slate-500">{t.checknum ?? ''}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{shortDate(t.date)}</td>
                      <td className="px-2 py-2 text-slate-600 hidden 2xl:table-cell">{t.bankAccount.name}</td>
                      <td className={`px-2 py-2 text-right whitespace-nowrap ${t.type === 'DEBIT' ? 'text-rose-600' : 'text-slate-800'}`}>
                        {t.type === 'DEBIT' ? '-' : ''}
                        {money(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Coluna de totais */}
      <div className="space-y-3">
        <Card>
          <div className="px-5 py-3">
            <p className="text-sm text-slate-700">Em aberto</p>
            <p className="text-xl text-right text-slate-800 mt-1">{money(detail.openAmount)}</p>
          </div>
        </Card>
        <Card>
          <div className="px-5 py-3">
            <p className="text-sm text-slate-700">Vencido</p>
            <p className="text-xl text-right text-rose-600 mt-1">{money(detail.overdueAmount)}</p>
          </div>
        </Card>
        <Card>
          <div className="px-5 py-3">
            <p className="text-sm text-slate-700">
              Movimentado <span className="text-xs text-slate-400 ml-1">12 meses</span>
            </p>
            <p className="text-xl text-right text-slate-800 mt-1">{money(detail.moved12m)}</p>
          </div>
        </Card>
      </div>
    </div>
  );
};
