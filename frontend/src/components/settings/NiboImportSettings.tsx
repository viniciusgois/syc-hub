import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Loader2, RotateCcw, UploadCloud, XCircle } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { ACCOUNT_TYPE_LABELS } from '../../lib/accounts';
import { api, errorMessage } from '../../lib/api';
import { SECTION_LABEL, SECTION_ORDER, categoryChoices } from '../../lib/categories';
import { money } from '../../lib/entries';
import { NiboFile, NiboTotals, readNiboFile } from '../../lib/niboImport';
import { AccountType, DRESection } from '../../types';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';
import { MoneyInput } from '../common/MoneyInput';
import { SearchSelect } from '../common/SearchSelect';
import { NiboChartImport } from './NiboChartImport';
import { NiboTransfersImport } from './NiboTransfersImport';

interface ReviewItem {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  lines: number[];
}

interface Preview {
  rows: number;
  counts: { receivables: number; payables: number; settled: number; open: number };
  totals: NiboTotals;
  accounts: { name: string; rows: number; firstDate: string | null; received: number; paid: number; suggestedType: AccountType; existingId: string | null }[];
  categories: { key: string; name: string; type: 'INCOME' | 'EXPENSE'; rows: number; total: number; unclassified: boolean; existingId: string | null; suggestedName: string | null; suggestedSection: DRESection }[];
  costCenters: { total: number; new: number };
  contacts: { total: number; new: number };
  review: ReviewItem[];
}

interface ImportRecord {
  id: string;
  source: 'NIBO' | 'NIBO_TRANSFERS';
  fileName: string;
  status: 'PROCESSED' | 'ROLLED_BACK';
  createdAt: string;
  summary: { rows: number; totals: NiboTotals; review: ReviewItem[]; counts: Preview['counts'] };
}

type AccountChoice = { mode: 'create'; type: AccountType; initialBalance: number; initialBalanceDate: string } | { mode: 'existing'; bankAccountId: string };
type CategoryChoice = { mode: 'create'; section: DRESection; fix: boolean } | { mode: 'existing'; categoryId: string };

const ACCOUNT_TYPES: AccountType[] = ['CHECKING', 'SAVINGS', 'INVESTMENT', 'CASH', 'CREDIT_CARD', 'PAYMENT_GATEWAY', 'OTHER'];
const TOTAL_LABELS: [keyof NiboTotals, string][] = [
  ['received', 'Recebido'],
  ['toReceive', 'A receber'],
  ['paid', 'Pago'],
  ['toPay', 'A pagar'],
];
const brDate = (v: string) => v.split('-').reverse().join('/');
/** Dia anterior (o saldo inicial vale "no início" do primeiro dia com movimento) */
const dayBefore = (v: string) => {
  const d = new Date(`${v}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

const ReviewList: React.FC<{ items: ReviewItem[] }> = ({ items }) => {
  if (!items.length) return <p className="text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Nada para revisar.</p>;
  return (
    <ul className="space-y-2">
      {items.map((r) => {
        const Icon = r.level === 'error' ? XCircle : r.level === 'warning' ? AlertTriangle : Info;
        const color = r.level === 'error' ? 'text-rose-600' : r.level === 'warning' ? 'text-amber-600' : 'text-slate-500';
        const lines = r.lines.filter((l) => l > 0);
        return (
          <li key={r.code} className="flex items-start gap-2 text-sm text-slate-700">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
            <span>
              {r.message}
              {lines.length > 0 && (
                <span className="block text-xs text-slate-500 mt-0.5">
                  {lines.length} linha(s) da planilha: {lines.slice(0, 15).join(', ')}
                  {lines.length > 15 && '…'}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

/** Configurações › Importar do NIBO: migra o histórico pelo relatório "Unificado por lançamento" (Excel) */
export const NiboImportSettings: React.FC = () => {
  const { currentCompany, accounts, categories, notify, refresh } = useCompany();
  const base = `/companies/${currentCompany.id}/nibo-imports`;
  const [file, setFile] = useState<(NiboFile & { fileName: string }) | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accountMap, setAccountMap] = useState<Record<string, AccountChoice>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, CategoryChoice>>({});
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: ImportRecord['summary']; created: Record<string, number> } | null>(null);
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [undoing, setUndoing] = useState<ImportRecord | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(() => {
    api.get<ImportRecord[]>(base).then(setHistory).catch(() => setHistory([]));
  }, [base]);
  useEffect(loadHistory, [loadHistory]);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    setResult(null);
  };

  const open = async (f: File) => {
    reset();
    if (!/\.xlsx?$/i.test(f.name)) return setError('Envie o relatório em Excel (.xlsx ou .xls).');
    setBusy('reading');
    try {
      const parsed = await readNiboFile(f);
      if (!parsed.rows.length) throw new Error('Nenhum lançamento encontrado na planilha.');
      const p = await api.post<Preview>(`${base}/preview`, { fileName: f.name, rows: parsed.rows });
      setFile({ ...parsed, fileName: f.name });
      setPreview(p);
      setAccountMap(
        Object.fromEntries(
          p.accounts.map((a) => [
            a.name,
            a.existingId
              ? { mode: 'existing', bankAccountId: a.existingId }
              : { mode: 'create', type: a.suggestedType, initialBalance: 0, initialBalanceDate: a.firstDate ? dayBefore(a.firstDate) : new Date().toISOString().slice(0, 10) },
          ]),
        ),
      );
      setCategoryMap(Object.fromEntries(p.categories.map((c) => [c.key, c.existingId ? { mode: 'existing', categoryId: c.existingId } : { mode: 'create', section: c.suggestedSection, fix: !!c.suggestedName }])));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!file || !preview) return;
    const accountsBody = Object.fromEntries(
      Object.entries(accountMap).map(([name, c]) => [
        name,
        c.mode === 'existing' ? { bankAccountId: c.bankAccountId } : { create: { type: c.type, initialBalance: c.initialBalance, initialBalanceDate: c.initialBalanceDate } },
      ]),
    );
    if (Object.values(accountMap).some((c) => c.mode === 'existing' && !c.bankAccountId)) return setError('Escolha a conta existente em todas as linhas marcadas como "Usar conta existente".');
    if (Object.values(categoryMap).some((c) => c.mode === 'existing' && !c.categoryId)) return setError('Escolha a categoria existente em todas as linhas marcadas como "Usar existente".');
        const categoriesBody = Object.fromEntries(
      Object.entries(categoryMap).map(([key, c]) => {
        const fixed = c.mode === 'create' && c.fix ? preview.categories.find((x) => x.key === key)?.suggestedName : null;
        return [key, c.mode === 'existing' ? { categoryId: c.categoryId } : { create: { section: c.section, ...(fixed && { name: fixed }) } }];
      }),
    );
    setBusy('importing');
    setError(null);
    try {
      const res = await api.post<{ summary: ImportRecord['summary']; created: Record<string, number> }>(base, {
        fileName: file.fileName,
        rows: file.rows,
        mapping: { accounts: accountsBody, categories: categoriesBody },
      });
      setResult(res);
      setPreview(null);
      notify(`${res.summary.rows} lançamentos importados do Nibo`);
      await refresh();
      loadHistory();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (rec: ImportRecord) => {
    setBusy('importing');
    try {
      const res = await api.post<{ removed: number }>(`${base}/${rec.id}/rollback`);
      notify(`Importação desfeita: ${res.removed} ${rec.source === 'NIBO_TRANSFERS' ? 'transferências removidas' : 'lançamentos removidos'}`);
      setUndoing(null);
      setResult(null);
      await refresh();
      loadHistory();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const catOptions = useMemo(
    () => ({
      INCOME: categoryChoices(categories, 'INCOME').map((o) => ({ value: o.value, label: o.label, group: o.group })),
      EXPENSE: categoryChoices(categories, 'EXPENSE').map((o) => ({ value: o.value, label: o.label, group: o.group })),
    }),
    [categories],
  );

  const totalsMatch = (k: keyof NiboTotals) => {
    const expected = file?.reportTotals[k];
    if (expected === undefined || !preview) return null;
    return Math.abs(expected - preview.totals[k]) < 0.01;
  };
  const mismatch = TOTAL_LABELS.some(([k]) => totalsMatch(k) === false);

  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-xl font-medium text-slate-700">Importar do NIBO</h1>
          <p className="text-sm text-slate-600 mt-1">
            Traz o histórico da empresa pelo relatório <strong>Unificado por lançamento</strong> do Nibo. No Nibo: <em>Relatórios › Unificado por lançamento</em>, escolha o
            período inteiro e exporte em <strong>Excel</strong>. Contas, categorias, centros de custo, contatos e lançamentos são criados aqui, já categorizados.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            {error}
          </p>
        )}

        {!preview && !result && <NiboChartImport />}

        {/* 2. Lançamentos */}
        {!preview && !result && <h2 className="text-base font-medium text-slate-800 -mb-3">2. Lançamentos (Excel do relatório "Unificado por lançamento")</h2>}
        {!preview && !result && (
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) open(f);
            }}
            className={`border-2 border-dashed rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer ${dragging ? 'border-nibo-blue bg-nibo-blueLight' : 'border-slate-300 hover:border-nibo-blue bg-slate-50'}`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) open(f);
              }}
            />
            {busy === 'reading' ? <Loader2 className="w-8 h-8 text-nibo-blue animate-spin" /> : <UploadCloud className="w-8 h-8 text-nibo-blue" />}
            <p className="text-sm font-medium text-slate-800">{busy === 'reading' ? 'Lendo a planilha...' : 'Arraste o Excel do relatório aqui ou clique para escolher'}</p>
            <p className="text-xs text-slate-500">Nada é gravado antes de você conferir a prévia.</p>
          </div>
        )}

        {!preview && !result && <NiboTransfersImport onImported={loadHistory} />}

        {/* 2. Prévia */}
        {preview && file && (
          <>
            <section className="border border-slate-200 rounded p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-medium text-slate-800 flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" /> {file.fileName}
                  {file.companyName && <span className="text-sm font-normal text-slate-500">· {file.companyName}</span>}
                </h2>
                <LinkButton onClick={reset}>Trocar arquivo</LinkButton>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="rounded bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Lançamentos</p>
                  <p className="text-xl font-medium">{preview.rows}</p>
                  <p className="text-xs text-slate-500">
                    {preview.counts.settled} baixados · {preview.counts.open} em aberto
                  </p>
                </div>
                {TOTAL_LABELS.map(([k, label]) => {
                  const ok = totalsMatch(k);
                  return (
                    <div key={k} className={`rounded p-3 ${ok === false ? 'bg-rose-50 border border-rose-200' : 'bg-slate-50'}`}>
                      <p className="text-xs text-slate-500">{label}</p>
                      <p className="text-xl font-medium">{money(preview.totals[k])}</p>
                      <p className={`text-xs flex items-center gap-1 ${ok === null ? 'text-slate-400' : ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {ok === null ? 'sem total no arquivo' : ok ? <><CheckCircle2 className="w-3.5 h-3.5" /> confere com o relatório</> : `relatório: ${money(file.reportTotals[k]!)}`}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-slate-500">
                {preview.contacts.new} contato(s) novo(s) de {preview.contacts.total} · {preview.costCenters.new} centro(s) de custo novo(s) de {preview.costCenters.total}
                {file.skipped.length > 0 && ` · ${file.skipped.length} linha(s) ignorada(s): ${file.skipped.slice(0, 5).map((s) => `${s.line} (${s.reason})`).join(', ')}`}
              </p>
              {mismatch && (
                <p className="text-sm text-rose-700 flex items-center gap-2">
                  <XCircle className="w-4 h-4" /> Algum total não bate com o cabeçalho do relatório. Confira se exportou o período inteiro e todas as contas antes de importar.
                </p>
              )}
            </section>

            <section className="border border-slate-200 rounded p-5">
              <h2 className="text-base font-medium text-slate-800 mb-1">Contas</h2>
              <p className="text-xs text-slate-500 mb-3">O relatório não traz o saldo inicial: informe o saldo de cada conta no fim do dia anterior ao primeiro movimento.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-600 bg-slate-100">
                    <tr>
                      <th className="px-3 py-2 font-medium">Conta no Nibo</th>
                      <th className="px-3 py-2 font-medium">Movimento</th>
                      <th className="px-3 py-2 font-medium">No SYC Hub</th>
                      <th className="px-3 py-2 font-medium">Saldo inicial</th>
                      <th className="px-3 py-2 font-medium">Saldo em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.accounts.map((a) => {
                      const c = accountMap[a.name];
                      const set = (next: AccountChoice) => setAccountMap((m) => ({ ...m, [a.name]: next }));
                      return (
                        <tr key={a.name}>
                          <td className="px-3 py-2">
                            <span className="font-medium">{a.name}</span>
                            <span className="block text-xs text-slate-500">
                              {a.rows} lançamentos{a.firstDate && ` · desde ${brDate(a.firstDate)}`}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            <span className="block text-emerald-700">+ {money(a.received)}</span>
                            <span className="block text-rose-600">− {money(a.paid)}</span>
                          </td>
                          <td className="px-3 py-2 w-72">
                            <select
                              aria-label={`Conta ${a.name}`}
                              value={c.mode === 'existing' ? c.bankAccountId : `new:${c.type}`}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v.startsWith('new:')) set({ mode: 'create', type: v.slice(4) as AccountType, initialBalance: c.mode === 'create' ? c.initialBalance : 0, initialBalanceDate: c.mode === 'create' ? c.initialBalanceDate : a.firstDate ? dayBefore(a.firstDate) : '' });
                                else set({ mode: 'existing', bankAccountId: v });
                              }}
                              className={fieldClass()}
                            >
                              <optgroup label="Criar conta nova">
                                {ACCOUNT_TYPES.map((t) => (
                                  <option key={t} value={`new:${t}`}>
                                    Nova · {ACCOUNT_TYPE_LABELS[t]}
                                  </option>
                                ))}
                              </optgroup>
                              {accounts.length > 0 && (
                                <optgroup label="Usar conta existente">
                                  {accounts.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      {acc.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </td>
                          <td className="px-3 py-2 w-44">
                            {c.mode === 'create' ? (
                              <MoneyInput aria-label={`Saldo inicial ${a.name}`} value={c.initialBalance} onChange={(v) => set({ ...c, initialBalance: v })} />
                            ) : (
                              <span className="text-xs text-slate-500">mantém o da conta</span>
                            )}
                          </td>
                          <td className="px-3 py-2 w-44">
                            {c.mode === 'create' && (
                              <input type="date" aria-label={`Data do saldo ${a.name}`} value={c.initialBalanceDate} onChange={(e) => set({ ...c, initialBalanceDate: e.target.value })} className={fieldClass()} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="border border-slate-200 rounded p-5">
              <h2 className="text-base font-medium text-slate-800 mb-1">Categorias</h2>
              <p className="text-xs text-slate-500 mb-3">
                Categorias com o mesmo nome já usam a existente. As novas são criadas na seção do Painel que você escolher (dá para reorganizar depois em Configurações › Categorias).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-600 bg-slate-100">
                    <tr>
                      <th className="px-3 py-2 font-medium">Categoria no Nibo</th>
                      <th className="px-3 py-2 font-medium text-right">Lançamentos</th>
                      <th className="px-3 py-2 font-medium text-right">Total</th>
                      <th className="px-3 py-2 font-medium">No SYC Hub</th>
                      <th className="px-3 py-2 font-medium">Onde</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.categories.map((cat) => {
                      const c = categoryMap[cat.key];
                      const set = (next: CategoryChoice) => setCategoryMap((m) => ({ ...m, [cat.key]: next }));
                      return (
                        <tr key={cat.key} className={cat.unclassified ? 'bg-amber-50/60' : ''}>
                          <td className="px-3 py-2">
                            <span className={`mr-1 ${cat.type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}`}>{cat.type === 'INCOME' ? '↑' : '↓'}</span>
                            {cat.name}
                            {cat.suggestedName && c.mode === 'create' && (
                              <label className="flex items-center gap-1.5 mt-1 text-xs text-amber-800 cursor-pointer">
                                <input type="checkbox" checked={c.fix} onChange={(e) => set({ ...c, fix: e.target.checked })} className="w-3.5 h-3.5 accent-nibo-blue" />
                                corrigir para <strong>{cat.suggestedName}</strong>
                              </label>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">{cat.rows}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{money(cat.total)}</td>
                          <td className="px-3 py-2 w-48">
                            <select
                              aria-label={`Ação ${cat.name}`}
                              value={c.mode}
                              onChange={(e) => set(e.target.value === 'create' ? { mode: 'create', section: cat.suggestedSection, fix: !!cat.suggestedName } : { mode: 'existing', categoryId: cat.existingId ?? '' })}
                              className={fieldClass()}
                            >
                              <option value="create">Criar nova</option>
                              <option value="existing">Usar existente</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 w-80">
                            {c.mode === 'create' ? (
                              <select aria-label={`Seção ${cat.name}`} value={c.section} onChange={(e) => set({ ...c, section: e.target.value as DRESection })} className={fieldClass()}>
                                {SECTION_ORDER.map((s) => (
                                  <option key={s} value={s}>
                                    {SECTION_LABEL[s]}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <SearchSelect value={c.categoryId} onChange={(v) => set({ mode: 'existing', categoryId: v })} options={catOptions[cat.type]} placeholder="Escolha a categoria..." size="sm" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="border border-slate-200 rounded p-5">
              <h2 className="text-base font-medium text-slate-800 mb-3">O que revisar</h2>
              <ReviewList items={preview.review} />
            </section>

            <div className="flex items-center justify-end gap-5 pb-6">
              <LinkButton onClick={reset} disabled={!!busy}>
                Cancelar
              </LinkButton>
              <PrimaryButton onClick={confirm} disabled={!!busy}>
                {busy === 'importing' && <Loader2 className="w-4 h-4 animate-spin" />}
                Importar {preview.rows} lançamentos
              </PrimaryButton>
            </div>
          </>
        )}

        {/* 3. Resultado */}
        {result && (
          <section className="border border-emerald-200 bg-emerald-50/40 rounded p-5 space-y-4">
            <h2 className="text-base font-medium text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" /> Importação concluída
            </h2>
            <p className="text-sm text-slate-700">
              {result.created.receivables} recebimentos e {result.created.payables} pagamentos · {result.created.accounts} conta(s), {result.created.categories} categoria(s),{' '}
              {result.created.costCenters} centro(s) de custo e {result.created.contacts} contato(s) criados.
            </p>
            <div>
              <h3 className="text-sm font-medium text-slate-800 mb-2">O que revisar</h3>
              <ReviewList items={result.summary.review} />
            </div>
            <LinkButton onClick={reset}>Importar outro arquivo</LinkButton>
          </section>
        )}

        {/* Histórico */}
        {history.length > 0 && (
          <section>
            <h2 className="text-base font-medium text-slate-800 mb-2">Importações feitas</h2>
            <ul className="border border-slate-200 rounded divide-y divide-slate-100">
              {history.map((h) => (
                <li key={h.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium">{h.fileName}</span>
                    <span className="text-slate-500">
                      {' '}
                      · {new Date(h.createdAt).toLocaleString('pt-BR')} · {h.summary.rows} {h.source === 'NIBO_TRANSFERS' ? 'transferências' : 'lançamentos'}
                    </span>
                  </span>
                  {h.status === 'PROCESSED' ? (
                    <button type="button" onClick={() => setUndoing(h)} className="text-sm text-rose-600 hover:underline flex items-center gap-1">
                      <RotateCcw className="w-4 h-4" /> Desfazer importação
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">desfeita</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {undoing && (
        <Modal
          title="Desfazer importação"
          onClose={() => setUndoing(null)}
          busy={!!busy}
          footer={
            <>
              <LinkButton onClick={() => setUndoing(null)} disabled={!!busy}>
                Cancelar
              </LinkButton>
              <button
                type="button"
                onClick={() => rollback(undoing)}
                disabled={!!busy}
                className="px-5 h-10 rounded bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Desfazer
              </button>
            </>
          }
        >
          {undoing.source === 'NIBO_TRANSFERS' ? (
            <p className="text-sm text-slate-700">
              Remove as {undoing.summary.rows} transferências de <strong>{undoing.fileName}</strong> das duas contas e recalcula os saldos.
            </p>
          ) : (
            <p className="text-sm text-slate-700">
              Remove os {undoing.summary.rows} lançamentos de <strong>{undoing.fileName}</strong> e as baixas deles. Contas, categorias, centros de custo e contatos criados pela
              importação também são removidos, se nada mais estiver usando.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
};
