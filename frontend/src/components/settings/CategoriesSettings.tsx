import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { ArrowUp, ArrowDown, Lock, Pencil, Trash2, Plus, ChevronDown, Download, GripVertical, Loader2 } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { SECTION_LABEL, SECTION_ORDER } from '../../lib/categories';
import { Category, DRESection } from '../../types';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';

type FormState = { id?: string; isGroup: boolean; name: string; type: 'INCOME' | 'EXPENSE'; section: DRESection; parentId: string };

export const CategoriesSettings: React.FC = () => {
  const { currentCompany, notify, reloadCategories } = useCompany();
  const base = `/companies/${currentCompany.id}/categories`;
  const [list, setList] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [drag, setDrag] = useState<{ id: string; level: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setList(await api.get<Category[]>(base));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const changed = async () => {
    await load();
    reloadCategories();
  };

  const categories = (list ?? []).filter((c) => c.section);
  const sorted = (items: Category[]) => [...items].sort((a, b) => a.orderIndex - b.orderIndex || a.name.localeCompare(b.name, 'pt-BR'));
  const rootsOf = (section: DRESection) => sorted(categories.filter((c) => c.section === section && !c.parentId));
  const childrenOf = (groupId: string) => sorted(categories.filter((c) => c.parentId === groupId));
  const groupsOf = (section: DRESection) => sorted(categories.filter((c) => c.section === section && c.isGroup));

  // ---------------------------------------------------------------------------
  // Formulário (nova categoria / subgrupo / edição)
  // ---------------------------------------------------------------------------

  const openNew = (isGroup: boolean) => {
    setMenuOpen(false);
    setFormError(null);
    setForm({ isGroup, name: '', type: 'EXPENSE', section: 'OPERATING_EXPENSES', parentId: '' });
  };

  const openEdit = (c: Category) => {
    setFormError(null);
    setForm({ id: c.id, isGroup: c.isGroup, name: c.name, type: c.type === 'INCOME' ? 'INCOME' : 'EXPENSE', section: c.section!, parentId: c.parentId ?? '' });
  };

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setFormError('Informe o nome');
      return;
    }
    setSaving(true);
    try {
      const body = form.isGroup
        ? { name: form.name, section: form.section }
        : { name: form.name, type: form.type, section: form.section, parentId: form.parentId || null };
      if (form.id) await api.patch(`${base}/${form.id}`, body);
      else await api.post(base, { ...body, isGroup: form.isGroup });
      notify(form.id ? 'Alterações salvas' : form.isGroup ? 'Subgrupo criado' : 'Categoria criada');
      setForm(null);
      changed();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Category) => {
    setSaving(true);
    try {
      const res = await api.delete<{ archived?: boolean; movedChildren?: boolean }>(`${base}/${c.id}`);
      notify(
        res?.archived
          ? `"${c.name}" está em uso: foi arquivada (some das listas e mantém o histórico)`
          : res?.movedChildren
            ? `Subgrupo excluído; as categorias voltaram para a seção`
            : `"${c.name}" excluída`,
      );
      setConfirmDelete(null);
      changed();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Arrastar para reordenar (somente dentro do mesmo nível)
  // ---------------------------------------------------------------------------

  const levelOf = (c: Category) => `${c.section}|${c.parentId ?? ''}`;

  const onDrop = async (target: Category) => {
    setDropTarget(null);
    if (!drag || drag.id === target.id || drag.level !== levelOf(target)) return;
    const siblings = target.parentId ? childrenOf(target.parentId) : rootsOf(target.section!);
    const ids = siblings.map((s) => s.id).filter((id) => id !== drag.id);
    ids.splice(ids.indexOf(target.id), 0, drag.id);
    // Atualiza na tela antes da resposta para o arrasto parecer imediato
    setList((prev) => prev?.map((c) => (ids.includes(c.id) ? { ...c, orderIndex: ids.indexOf(c.id) } : c)) ?? null);
    try {
      await api.post(`${base}/reorder`, { ids });
      reloadCategories();
    } catch (err) {
      notify(errorMessage(err), 'error');
      load();
    }
  };

  const exportXlsx = () => {
    const rows: string[][] = [['Seção', 'Subgrupo', 'Categoria', 'Tipo', 'Sistema']];
    for (const section of SECTION_ORDER) {
      for (const root of rootsOf(section)) {
        if (root.isGroup) {
          const kids = childrenOf(root.id);
          if (!kids.length) rows.push([SECTION_LABEL[section], root.name, '', '', '']);
          for (const k of kids) rows.push([SECTION_LABEL[section], root.name, k.name, k.type === 'INCOME' ? 'Entrada' : 'Saída', k.isSystem ? 'Sim' : '']);
        } else {
          rows.push([SECTION_LABEL[section], '', root.name, root.type === 'INCOME' ? 'Entrada' : 'Saída', root.isSystem ? 'Sim' : '']);
        }
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Categorias');
    XLSX.writeFile(wb, `Plano_de_contas_${currentCompany.tradeName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '_')}.xlsx`);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const renderRow = (c: Category, child = false, last = false) => (
    <div
      key={c.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        setDrag({ id: c.id, level: levelOf(c) });
      }}
      onDragEnd={() => {
        setDrag(null);
        setDropTarget(null);
      }}
      onDragOver={(e) => {
        if (drag && drag.level === levelOf(c) && drag.id !== c.id) {
          e.preventDefault();
          setDropTarget(c.id);
        }
      }}
      onDragLeave={() => setDropTarget((t) => (t === c.id ? null : t))}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(c);
      }}
      className={`group flex items-center gap-2 border-b border-slate-100 ${c.isGroup ? 'bg-slate-50 h-12' : 'h-12'} ${
        dropTarget === c.id ? 'border-t-2 border-t-nibo-blue' : ''
      } ${drag?.id === c.id ? 'opacity-40' : ''}`}
    >
      <span className="w-6 flex justify-center text-slate-300 cursor-grab" title="Arraste para reordenar">
        <GripVertical className="w-4 h-4" />
      </span>
      {child && (
        <span className="relative w-6 self-stretch" aria-hidden>
          <span className={`absolute left-2 top-0 w-px bg-slate-300 ${last ? 'h-1/2' : 'h-full'}`} />
          <span className="absolute left-2 top-1/2 w-3 h-px bg-slate-300" />
        </span>
      )}
      <span className="flex-1 min-w-0 flex items-center gap-2 text-sm">
        {!c.isGroup &&
          (c.type === 'INCOME' ? (
            <ArrowUp className="w-4 h-4 text-emerald-600 shrink-0" aria-label="Entrada" />
          ) : (
            <ArrowDown className="w-4 h-4 text-rose-600 shrink-0" aria-label="Saída" />
          ))}
        <span className={`truncate ${c.isGroup ? 'font-medium text-slate-800' : 'text-slate-700'}`}>{c.name}</span>
        {c.isSystem && (
          <span title="Categoria do sistema (juros, multas, descontos): não pode ser alterada">
            <Lock className="w-3.5 h-3.5 text-slate-300" />
          </span>
        )}
      </span>
      {!c.isSystem && (
        <span className="flex items-center gap-1 pr-3">
          <button onClick={() => openEdit(c)} aria-label={`Editar ${c.name}`} className="p-1.5 rounded text-nibo-blue hover:bg-nibo-blueLight">
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => setConfirmDelete(c)} aria-label={`Excluir ${c.name}`} className="p-1.5 rounded text-nibo-blue hover:bg-rose-50 hover:text-rose-600">
            <Trash2 className="w-4 h-4" />
          </button>
        </span>
      )}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-800 px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-medium text-slate-700">Categorias</h1>
        <div className="flex items-center gap-3">
          <button onClick={exportXlsx} disabled={!list} aria-label="Exportar plano de contas" title="Exportar plano de contas (Excel)" className="p-2 rounded text-slate-500 hover:bg-slate-100">
            <Download className="w-4 h-4" />
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex items-center gap-1.5 px-4 h-9 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> Adicionar <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded shadow-lg py-1 z-20">
                <button role="menuitem" onClick={() => openNew(false)} className="w-full text-left px-4 py-2.5 text-sm text-nibo-blue hover:bg-slate-50">
                  Nova categoria
                </button>
                <button role="menuitem" onClick={() => openNew(true)} className="w-full text-left px-4 py-2.5 text-sm text-nibo-blue hover:bg-slate-50">
                  Novo subgrupo
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!list && !error && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </p>
      )}

      {list && (
        <div className="border border-slate-200 rounded">
          {SECTION_ORDER.map((section) => {
            const roots = rootsOf(section);
            return (
              <section key={section} aria-label={SECTION_LABEL[section]}>
                <h2 className="px-5 py-3 bg-slate-100 text-sm font-medium text-slate-600 uppercase tracking-wide">{SECTION_LABEL[section]}</h2>
                {roots.length === 0 && <p className="px-5 py-3 text-sm text-slate-400 border-b border-slate-100">Grupo vazio</p>}
                {roots.map((root) => {
                  const kids = root.isGroup ? childrenOf(root.id) : [];
                  return (
                    <React.Fragment key={root.id}>
                      {renderRow(root)}
                      {root.isGroup && kids.length === 0 && <p className="pl-16 py-3 text-sm text-slate-400 border-b border-slate-100">Subgrupo vazio</p>}
                      {kids.map((k, i) => renderRow(k, true, i === kids.length - 1))}
                    </React.Fragment>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}

      {form && (
        <Modal
          title={form.id ? (form.isGroup ? 'Editar subgrupo' : 'Editar categoria') : form.isGroup ? 'Novo subgrupo' : 'Nova categoria'}
          onClose={() => setForm(null)}
          busy={saving}
          footer={
            <>
              <LinkButton onClick={() => setForm(null)}>Cancelar</LinkButton>
              <PrimaryButton onClick={save} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Salvar
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-4">
            {formError && <p className="text-sm text-rose-600" role="alert">{formError}</p>}
            <div>
              <label htmlFor="cat-name" className="block text-sm font-medium text-slate-800 mb-1.5">
                Nome
              </label>
              <input
                id="cat-name"
                autoFocus
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                className={fieldClass()}
              />
            </div>
            {!form.isGroup && (
              <fieldset>
                <legend className="block text-sm font-medium text-slate-800 mb-1.5">Tipo</legend>
                <div className="flex gap-6">
                  {(
                    [
                      ['INCOME', 'Entrada', ArrowUp, 'text-emerald-600'],
                      ['EXPENSE', 'Saída', ArrowDown, 'text-rose-600'],
                    ] as const
                  ).map(([value, label, Icon, color]) => (
                    <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" name="cat-type" checked={form.type === value} onChange={() => setForm({ ...form, type: value })} className="accent-nibo-blue" />
                      <Icon className={`w-4 h-4 ${color}`} /> {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div>
              <label htmlFor="cat-section" className="block text-sm font-medium text-slate-800 mb-1.5">
                Grupo da DRE
              </label>
              <select
                id="cat-section"
                value={form.section}
                onChange={(e) => setForm({ ...form, section: e.target.value as DRESection, parentId: '' })}
                className={fieldClass()}
              >
                {SECTION_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {SECTION_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            {!form.isGroup && (
              <div>
                <label htmlFor="cat-parent" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Subgrupo <span className="italic font-normal text-xs text-slate-400">(opcional)</span>
                </label>
                <select id="cat-parent" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className={fieldClass()}>
                  <option value="">Nenhum (direto no grupo)</option>
                  {groupsOf(form.section).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.isGroup && <p className="text-xs text-slate-500">Subgrupos organizam categorias dentro do grupo da DRE (ex.: Despesas administrativas, Despesas com pessoal).</p>}
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title={confirmDelete.isGroup ? 'Excluir subgrupo' : 'Excluir categoria'}
          onClose={() => setConfirmDelete(null)}
          busy={saving}
          footer={
            <>
              <LinkButton onClick={() => setConfirmDelete(null)}>Cancelar</LinkButton>
              <PrimaryButton onClick={() => remove(confirmDelete)} disabled={saving} className="bg-rose-600 hover:bg-rose-700">
                Excluir
              </PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            {confirmDelete.isGroup
              ? `Excluir o subgrupo "${confirmDelete.name}"? As categorias dele não são apagadas: voltam para o grupo "${SECTION_LABEL[confirmDelete.section!]}".`
              : (confirmDelete.usageCount ?? 0) > 0
                ? `"${confirmDelete.name}" já foi usada em ${confirmDelete.usageCount} lançamento(s). Ela será arquivada: some das listas, mas o histórico e a DRE dos períodos anteriores continuam corretos.`
                : `Excluir a categoria "${confirmDelete.name}"?`}
          </p>
        </Modal>
      )}
    </div>
  );
};
