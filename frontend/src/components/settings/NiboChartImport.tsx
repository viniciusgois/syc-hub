import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Lock, UploadCloud } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { SECTION_LABEL, SECTION_ORDER } from '../../lib/categories';
import { ChartItem, readNiboChartPdf } from '../../lib/niboChart';
import { DRESection } from '../../types';
import { LinkButton, PrimaryButton } from '../common/Modal';

interface PlanItem extends ChartItem {
  key: string;
  suggestedName: string | null;
  existingId: string | null;
  action: 'create' | 'move' | 'keep' | 'system';
  uses: number;
}

interface Plan {
  groups: { key: string; section: DRESection; name: string; suggestedName: string | null; existingId: string | null }[];
  items: PlanItem[];
  remove: { id: string; name: string }[];
  keep: { id: string; name: string; uses: number }[];
  systemOutside: string[];
  counts: { create: number; move: number; keep: number; corrections: number };
}

const ACTION: Record<PlanItem['action'], { label: string; className: string }> = {
  create: { label: 'nova', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  move: { label: 'muda de lugar', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  keep: { label: 'já existe', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  system: { label: 'do sistema', className: 'bg-slate-50 text-slate-500 border-slate-200' },
};

/** Passo 1 da migração: plano de contas do Nibo (PDF de Configurações › Categorias) */
export const NiboChartImport: React.FC = () => {
  const { currentCompany, notify, reloadCategories } = useCompany();
  const [items, setItems] = useState<ChartItem[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fix, setFix] = useState<Record<string, boolean>>({});
  const [removeUnmatched, setRemoveUnmatched] = useState(true);
  const [busy, setBusy] = useState<'reading' | 'applying' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; moved: number; renamed: number; removed: number; kept: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/companies/${currentCompany.id}/nibo-imports/chart`;

  const open = async (file: File) => {
    setError(null);
    setDone(null);
    setPlan(null);
    if (!/\.pdf$/i.test(file.name)) return setError('Envie o plano de contas em PDF.');
    setBusy('reading');
    try {
      const parsed = await readNiboChartPdf(file);
      if (!parsed.items.length) throw new Error('Não encontrei categorias neste PDF. Salve em PDF a tela Configurações › Categorias do Nibo, com todas as seções abertas.');
      const p = await api.post<Plan>(`${base}/preview`, { items: parsed.items });
      setItems(parsed.items);
      setPlan(p);
      setFix(Object.fromEntries([...p.items, ...p.groups].filter((i) => i.suggestedName).map((i) => [i.key, true])));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!plan || !items) return;
    const renames = Object.fromEntries([...plan.items, ...plan.groups].filter((i) => i.suggestedName && fix[i.key]).map((i) => [i.key, i.suggestedName!]));
    setBusy('applying');
    setError(null);
    try {
      const res = await api.post<NonNullable<typeof done>>(base, { items, renames, removeUnmatched });
      setDone(res);
      setPlan(null);
      await reloadCategories();
      notify('Plano de contas do Nibo aplicado');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const bySection = useMemo(() => {
    if (!plan) return [];
    return SECTION_ORDER.map((section) => {
      const rows: ({ kind: 'group'; group: Plan['groups'][number]; children: PlanItem[] } | { kind: 'item'; item: PlanItem })[] = [];
      for (const item of plan.items.filter((i) => i.section === section)) {
        if (!item.group) rows.push({ kind: 'item', item });
        else {
          const existing = rows.find((r) => r.kind === 'group' && r.group.name === item.group);
          if (existing && existing.kind === 'group') existing.children.push(item);
          else rows.push({ kind: 'group', group: plan.groups.find((g) => g.section === section && g.name === item.group)!, children: [item] });
        }
      }
      return { section, rows };
    }).filter((s) => s.rows.length);
  }, [plan]);

  const correction = (key: string, suggestedName: string | null) =>
    suggestedName && (
      <label className="flex items-center gap-1.5 text-xs text-amber-800 cursor-pointer">
        <input type="checkbox" checked={!!fix[key]} onChange={(e) => setFix((f) => ({ ...f, [key]: e.target.checked }))} className="w-3.5 h-3.5 accent-nibo-blue" />
        corrigir para <strong>{suggestedName}</strong>
      </label>
    );

  const itemRow = (i: PlanItem, child = false) => (
    <li key={i.key} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 ${child ? 'pl-8' : 'pl-3'}`}>
      <span className={i.type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}>{i.type === 'INCOME' ? '↑' : '↓'}</span>
      <span className="text-sm text-slate-800">{i.name}</span>
      {i.locked && <Lock className="w-3 h-3 text-slate-400" aria-label="Categoria do sistema no Nibo" />}
      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${ACTION[i.action].className}`}>{ACTION[i.action].label}</span>
      {i.uses > 0 && <span className="text-xs text-slate-500">{i.uses} lançamento(s)</span>}
      {correction(i.key, i.suggestedName)}
    </li>
  );

  return (
    <section className="border border-slate-200 rounded p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-slate-800">1. Plano de contas (PDF)</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            No Nibo: <em>Configurações › Categorias</em>, imprima a página e salve como PDF. Os subgrupos, a ordem e a seção de cada categoria ficam iguais aos do Nibo.
            Faça isto antes de importar os lançamentos.
          </p>
        </div>
        {!plan && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!!busy}
            className="h-10 px-4 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight flex items-center gap-2 disabled:opacity-50"
          >
            {busy === 'reading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            Enviar PDF do plano de contas
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) open(f);
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {done && (
        <p className="text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> Plano aplicado: {done.created} criada(s), {done.moved} movida(s), {done.renamed} nome(s) corrigido(s), {done.removed} removida(s)
          {done.kept > 0 && `, ${done.kept} mantida(s) por ter lançamentos`}. Agora importe os lançamentos no passo 2.
        </p>
      )}

      {plan && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-slate-100">
              <FileText className="inline w-3.5 h-3.5 mr-1" />
              {plan.items.length} categorias · {plan.groups.length} subgrupos
            </span>
            <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800">{plan.counts.create} a criar</span>
            <span className="px-2 py-1 rounded bg-blue-50 text-blue-800">{plan.counts.move} mudam de lugar</span>
            <span className="px-2 py-1 rounded bg-slate-100">{plan.counts.keep} já existem</span>
            {plan.counts.corrections > 0 && <span className="px-2 py-1 rounded bg-amber-50 text-amber-800">{plan.counts.corrections} correção(ões) de português</span>}
          </div>

          <div className="max-h-[480px] overflow-y-auto border border-slate-200 rounded divide-y divide-slate-100">
            {bySection.map(({ section, rows }) => (
              <div key={section} className="py-2">
                <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{SECTION_LABEL[section]}</p>
                <ul>
                  {rows.map((r) =>
                    r.kind === 'item' ? (
                      itemRow(r.item)
                    ) : (
                      <li key={r.group.key}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 pl-3">
                          <span className="text-sm font-medium text-slate-800">{r.group.name}</span>
                          <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${r.group.existingId ? ACTION.keep.className : ACTION.create.className}`}>
                            {r.group.existingId ? 'subgrupo existente' : 'subgrupo novo'}
                          </span>
                          {correction(r.group.key, r.group.suggestedName)}
                        </div>
                        <ul>{r.children.map((c) => itemRow(c, true))}</ul>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>

          {plan.remove.length > 0 && (
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={removeUnmatched} onChange={(e) => setRemoveUnmatched(e.target.checked)} className="mt-0.5 w-4 h-4 accent-nibo-blue" />
              <span>
                Remover desta empresa as {plan.remove.length} categoria(s) que não estão no plano do Nibo e não têm lançamentos
                <span className="block text-xs text-slate-500">{plan.remove.map((r) => r.name).join(', ')}</span>
              </span>
            </label>
          )}
          {plan.keep.length > 0 && (
            <p className="text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Ficam porque têm lançamentos (não estão no plano do Nibo): {plan.keep.map((k) => `${k.name} (${k.uses})`).join(', ')}. Mova os lançamentos e exclua depois em
                Configurações › Categorias, se quiser.
              </span>
            </p>
          )}
          {plan.systemOutside.length > 0 && (
            <p className="text-xs text-slate-500">Categorias do sistema do SYC Hub que continuam (usadas em juros, multas e descontos): {plan.systemOutside.join(', ')}.</p>
          )}

          <div className="flex items-center justify-end gap-5">
            <LinkButton onClick={() => setPlan(null)} disabled={!!busy}>
              Cancelar
            </LinkButton>
            <PrimaryButton onClick={apply} disabled={!!busy}>
              {busy === 'applying' && <Loader2 className="w-4 h-4 animate-spin" />}
              Aplicar plano de contas
            </PrimaryButton>
          </div>
        </>
      )}
    </section>
  );
};
