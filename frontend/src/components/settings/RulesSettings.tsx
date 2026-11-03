import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, Play, ArrowUp, ArrowDown } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { categoryChoices } from '../../lib/categories';
import { contactOptions } from '../../lib/entries';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';
import { SearchSelect } from '../common/SearchSelect';

type MatchType = 'CONTAINS' | 'EXACT' | 'STARTS_WITH' | 'REGEX';

const MATCH_LABEL: Record<MatchType, string> = {
  CONTAINS: 'contém',
  EXACT: 'é igual a',
  STARTS_WITH: 'começa com',
  REGEX: 'corresponde à expressão',
};

interface Rule {
  id: string;
  name: string;
  matchType: MatchType;
  pattern: string;
  targetCategoryId: string;
  targetContactId: string | null;
  autoReconcile: boolean;
  priority: number;
  isActive: boolean;
  timesApplied: number;
  targetCategory: { id: string; name: string };
}

type FormState = Pick<Rule, 'name' | 'matchType' | 'pattern' | 'targetCategoryId' | 'autoReconcile' | 'priority'> & { id?: string; targetContactId: string };

/** Mesma lógica do backend (services/rules.ts) para pré-visualizar a regra */
function matches(form: Pick<Rule, 'matchType' | 'pattern'>, description: string) {
  const text = description.toUpperCase();
  const pattern = form.pattern.toUpperCase();
  if (!form.pattern) return false;
  switch (form.matchType) {
    case 'CONTAINS':
      return text.includes(pattern);
    case 'EXACT':
      return text.trim() === pattern.trim();
    case 'STARTS_WITH':
      return text.startsWith(pattern);
    case 'REGEX':
      try {
        return new RegExp(form.pattern, 'i').test(description);
      } catch {
        return false;
      }
  }
}

export const RulesSettings: React.FC = () => {
  const { currentCompany, categories, contacts, transactions, notify, refreshLedger } = useCompany();
  const base = `/companies/${currentCompany.id}/rules`;
  const [list, setList] = useState<Rule[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.get<Rule[]>(base));
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }, [base, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const catOptions = useMemo(
    () => categoryChoices(categories).map((o) => ({ value: o.value, label: `${o.type === 'INCOME' ? '↑' : '↓'} ${o.label}`, group: o.group })),
    [categories],
  );
  const contOptions = useMemo(() => contactOptions(contacts, 'PAYABLE'), [contacts]);

  const preview = useMemo(() => {
    if (!form?.pattern) return null;
    const hits = transactions.filter((t) => t.reconciliationStatus !== 'IGNORED' && matches(form, t.description));
    return { total: hits.length, pending: hits.filter((t) => t.reconciliationStatus === 'PENDING').length, sample: hits.slice(0, 3).map((t) => t.description) };
  }, [form, transactions]);

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return setFormError('Informe o nome da regra');
    if (!form.pattern.trim()) return setFormError('Informe o texto a procurar na descrição do extrato');
    if (!form.targetCategoryId) return setFormError('Selecione a categoria');
    if (form.matchType === 'REGEX') {
      try {
        new RegExp(form.pattern);
      } catch {
        return setFormError('Expressão regular inválida');
      }
    }
    setBusy(true);
    try {
      const body = { ...form, id: undefined, targetContactId: form.targetContactId || null };
      if (form.id) await api.patch(`${base}/${form.id}`, body);
      else await api.post(base, body);
      notify(form.id ? 'Regra atualizada' : 'Regra criada');
      setForm(null);
      load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (r: Rule) => {
    setList((l) => l?.map((x) => (x.id === r.id ? { ...x, isActive: !x.isActive } : x)) ?? null);
    try {
      await api.patch(`${base}/${r.id}`, { isActive: !r.isActive });
    } catch (err) {
      notify(errorMessage(err), 'error');
      load();
    }
  };

  const applyToPending = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ matched: number; scanned: number }>(`${base}/apply`);
      notify(res.matched ? `${res.matched} de ${res.scanned} linhas pendentes classificadas` : `Nenhuma das ${res.scanned} linhas pendentes casou com as regras`);
      load();
      refreshLedger();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Rule) => {
    setBusy(true);
    try {
      await api.delete(`${base}/${r.id}`);
      notify('Regra excluída');
      setRemoving(null);
      load();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const category = (id: string) => categories.find((c) => c.id === id);

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1 className="text-xl font-medium text-slate-700">Regras de conciliação</h1>
        <div className="flex items-center gap-3">
          <button onClick={applyToPending} disabled={busy || !list?.length} className="h-9 px-4 rounded border border-nibo-blue text-nibo-blue text-sm hover:bg-nibo-blueLight flex items-center gap-1.5 disabled:opacity-50">
            <Play className="w-4 h-4" /> Aplicar às linhas pendentes
          </button>
          <button
            onClick={() => (setFormError(null), setForm({ name: '', matchType: 'CONTAINS', pattern: '', targetCategoryId: '', targetContactId: '', autoReconcile: false, priority: 0 }))}
            className="flex items-center gap-1.5 px-4 h-9 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> Nova regra
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Na importação do extrato, a primeira regra ativa (maior prioridade) cuja condição casa com a descrição define a categoria e o contato da linha.
      </p>

      <div className="border border-slate-200 rounded overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3 font-medium">Regra</th>
              <th className="px-4 py-3 font-medium">Quando a descrição</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Ação</th>
              <th className="px-4 py-3 font-medium text-right" title="Maior número é avaliado primeiro">
                Prioridade
              </th>
              <th className="px-4 py-3 font-medium text-right">Aplicada</th>
              <th className="px-4 py-3 font-medium">Ativa</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {!list && (
              <tr>
                <td colSpan={8} className="px-4 py-4 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando...
                </td>
              </tr>
            )}
            {list?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-slate-500">
                  Nenhuma regra. Crie regras para categorizar automaticamente tarifas, impostos, fornecedores recorrentes etc.
                </td>
              </tr>
            )}
            {list?.map((r) => {
              const cat = category(r.targetCategoryId);
              return (
                <tr key={r.id} className={`border-t border-slate-100 ${r.isActive ? '' : 'text-slate-400'}`}>
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2.5">
                    {MATCH_LABEL[r.matchType]} <code className="px-1.5 py-0.5 rounded bg-slate-100 text-xs">{r.pattern}</code>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1">
                      {cat?.type === 'INCOME' ? <ArrowUp className="w-3.5 h-3.5 text-emerald-600" /> : <ArrowDown className="w-3.5 h-3.5 text-rose-600" />}
                      {r.targetCategory.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{r.autoReconcile ? 'Concilia automaticamente' : 'Sugere'}</td>
                  <td className="px-4 py-2.5 text-right">{r.priority}</td>
                  <td className="px-4 py-2.5 text-right">{r.timesApplied}×</td>
                  <td className="px-4 py-2.5">
                    <input type="checkbox" checked={r.isActive} onChange={() => toggleActive(r)} aria-label={`Regra ${r.name} ativa`} className="w-4 h-4 accent-nibo-blue" />
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() =>
                        (setFormError(null),
                        setForm({
                          id: r.id,
                          name: r.name,
                          matchType: r.matchType,
                          pattern: r.pattern,
                          targetCategoryId: r.targetCategoryId,
                          targetContactId: r.targetContactId ?? '',
                          autoReconcile: r.autoReconcile,
                          priority: r.priority,
                        }))
                      }
                      aria-label={`Editar ${r.name}`}
                      className="p-1.5 rounded text-nibo-blue hover:bg-nibo-blueLight"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setRemoving(r)} aria-label={`Excluir ${r.name}`} className="p-1.5 rounded text-nibo-blue hover:bg-rose-50 hover:text-rose-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal
          title={form.id ? 'Editar regra' : 'Nova regra'}
          onClose={() => setForm(null)}
          busy={busy}
          width="max-w-2xl"
          footer={
            <>
              <LinkButton onClick={() => setForm(null)}>Cancelar</LinkButton>
              <PrimaryButton onClick={save} disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-4">
            {formError && <p className="text-sm text-rose-600" role="alert">{formError}</p>}
            <div>
              <label htmlFor="rl-name" className="block text-sm font-medium text-slate-800 mb-1.5">
                Nome da regra
              </label>
              <input id="rl-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Tarifas do Itaú" className={fieldClass()} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="rl-type" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Quando a descrição
                </label>
                <select id="rl-type" value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value as MatchType })} className={fieldClass()}>
                  {(Object.keys(MATCH_LABEL) as MatchType[]).map((m) => (
                    <option key={m} value={m}>
                      {MATCH_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="rl-pattern" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Texto
                </label>
                <input
                  id="rl-pattern"
                  value={form.pattern}
                  onChange={(e) => setForm({ ...form, pattern: e.target.value })}
                  placeholder={form.matchType === 'REGEX' ? 'Ex.: TARIFA|TAR PACOTE' : 'Ex.: TARIFA'}
                  className={`${fieldClass()} font-mono`}
                />
              </div>
            </div>
            {preview && (
              <p className="text-xs text-slate-600 px-3 py-2 rounded bg-slate-50 border border-slate-200">
                No extrato atual, <strong>{preview.total}</strong> linha(s) casam ({preview.pending} pendentes)
                {preview.sample.length > 0 && <span className="text-slate-500"> — ex.: {preview.sample.join(' · ')}</span>}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="rl-cat" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Categoria
                </label>
                <SearchSelect id="rl-cat" value={form.targetCategoryId} onChange={(v) => setForm({ ...form, targetCategoryId: v })} options={catOptions} placeholder="Selecione uma categoria..." />
              </div>
              <div>
                <label htmlFor="rl-contact" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Contato <span className="italic font-normal text-xs text-slate-400">(opcional)</span>
                </label>
                <SearchSelect id="rl-contact" value={form.targetContactId} onChange={(v) => setForm({ ...form, targetContactId: v })} options={contOptions} placeholder="Selecione um contato..." clearable />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div>
                <label htmlFor="rl-prio" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Prioridade
                </label>
                <input id="rl-prio" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })} className={fieldClass()} />
              </div>
              <label className="sm:col-span-2 flex items-start gap-2 text-sm text-slate-700 cursor-pointer pb-2">
                <input type="checkbox" checked={form.autoReconcile} onChange={(e) => setForm({ ...form, autoReconcile: e.target.checked })} className="mt-0.5 w-4 h-4 accent-nibo-blue" />
                <span>
                  Conciliar automaticamente
                  <span className="block text-xs text-slate-500">Desmarcado: a linha chega como "Sugerido" para você confirmar.</span>
                </span>
              </label>
            </div>
          </div>
        </Modal>
      )}

      {removing && (
        <Modal
          title="Excluir regra"
          onClose={() => setRemoving(null)}
          busy={busy}
          footer={
            <>
              <LinkButton onClick={() => setRemoving(null)}>Cancelar</LinkButton>
              <PrimaryButton className="bg-rose-600 hover:bg-rose-700" disabled={busy} onClick={() => remove(removing)}>
                Excluir
              </PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-slate-700">Excluir a regra "{removing.name}"? As linhas já classificadas por ela não mudam.</p>
        </Modal>
      )}
    </div>
  );
};
