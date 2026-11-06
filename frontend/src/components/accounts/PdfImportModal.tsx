import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, Loader2, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { useCompany, ImportResult } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/entries';
import { fieldClass } from '../common/Modal';
import { MoneyInput } from '../common/MoneyInput';

type DocumentType = 'BANK_STATEMENT' | 'CREDIT_CARD';

interface Extraction {
  documentType: DocumentType;
  fileHash: string;
  bankName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  invoiceTotal: number | null;
  dueDate: string | null;
  transactions: { date: string; description: string; amount: number }[];
  discarded: number;
}

interface DraftRow {
  key: number;
  include: boolean;
  date: string;
  description: string;
  amount: number;
}

const DOC_TYPES: { value: DocumentType; label: string; hint: string }[] = [
  { value: 'BANK_STATEMENT', label: 'Extrato de conta corrente', hint: 'Entradas e saídas da conta, com saldo.' },
  { value: 'CREDIT_CARD', label: 'Fatura de cartão de crédito', hint: 'Compras e estornos; o pagamento da fatura e o saldo anterior ficam de fora.' },
];

const brDate = (v: string | null) => (v ? v.split('-').reverse().join('/') : '');
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Importar extrato ou fatura em PDF: a IA (Claude) lê o PDF e devolve um rascunho para revisão.
 * Só depois de "Confirmar importação" as linhas são gravadas, pela mesma importação da planilha
 * (sem duplicar, com regras, palpites e desfazer), e vão para a Conciliação.
 */
export const PdfImportModal: React.FC<{ isOpen: boolean; onClose: () => void; defaultAccountId?: string }> = ({ isOpen, onClose, defaultAccountId }) => {
  const { currentCompany, accounts, importStatement, notify } = useCompany();
  const [accountId, setAccountId] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [useDueDate, setUseDueDate] = useState(false);
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ao abrir, começa do zero na conta pedida (ou na única conta)
  useEffect(() => {
    if (!isOpen) return;
    setAccountId(defaultAccountId ?? (accounts.length === 1 ? accounts[0].id : ''));
    setDocumentType('');
    setFile(null);
    setExtraction(null);
    setRows([]);
    setUseDueDate(false);
    setError(null);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const close = () => {
    if (!busy) onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onClose]);

  const read = async () => {
    if (!file || !documentType || !accountId) return;
    setBusy('reading');
    setError(null);
    try {
      const form = new FormData();
      form.append('documentType', documentType);
      form.append('file', file);
      const data = await api.upload<Extraction>(`/companies/${currentCompany.id}/imports/pdf/extract`, form);
      if (!data.transactions.length) throw new Error('A IA não encontrou transações neste PDF. Confira se é um extrato ou fatura e se escolheu o tipo certo.');
      setExtraction(data);
      setRows(data.transactions.map((t, key) => ({ key, include: true, ...t })));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const included = rows.filter((r) => r.include);
  const sum = round(included.reduce((s, r) => s + r.amount, 0));
  const income = round(included.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0));
  const expense = round(included.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0));
  const invalid = included.filter((r) => !r.date || !r.description.trim() || !r.amount);

  // Conferência com os totais do documento (o maior risco é a IA pular ou repetir uma linha)
  const check = useMemo(() => {
    if (!extraction) return null;
    if (extraction.documentType === 'BANK_STATEMENT' && extraction.openingBalance !== null && extraction.closingBalance !== null) {
      const expected = round(extraction.closingBalance - extraction.openingBalance);
      return { label: `saldo inicial ${money(extraction.openingBalance)} → saldo final ${money(extraction.closingBalance)}`, expected, got: sum, ok: Math.abs(expected - sum) < 0.01 };
    }
    if (extraction.documentType === 'CREDIT_CARD' && extraction.invoiceTotal !== null) {
      const got = round(-sum);
      return { label: `total da fatura ${money(extraction.invoiceTotal)}`, expected: extraction.invoiceTotal, got, ok: Math.abs(extraction.invoiceTotal - got) < 0.01 };
    }
    return null;
  }, [extraction, sum]);

  const update = (key: number, patch: Partial<DraftRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const confirm = async () => {
    if (!extraction || !file) return;
    if (invalid.length) return setError('Há linhas sem data, descrição ou valor. Corrija ou desmarque antes de importar.');
    const dueDate = extraction.documentType === 'CREDIT_CARD' && useDueDate ? extraction.dueDate : null;
    setBusy('importing');
    setError(null);
    try {
      const res = await importStatement({
        kind: 'ROWS',
        bankAccountId: accountId,
        fileName: file.name,
        fileType: 'PDF',
        fileHash: extraction.fileHash,
        rows: included.map((r) => ({ date: dueDate ?? r.date, description: r.description.trim(), amount: r.amount })),
      });
      setResult(res);
      notify(`${res.imported} lançamento(s) do PDF enviados para a Conciliação`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;
  const account = accounts.find((a) => a.id === accountId);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="pdf-import-title">
      <div className="absolute inset-0 bg-slate-900/50" onClick={close} />
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-white rounded-md shadow-2xl flex flex-col text-slate-800">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="pdf-import-title" className="text-lg font-medium text-slate-700 flex items-center gap-2">
            Importar extrato ou fatura em PDF
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> IA
            </span>
          </h2>
          <button onClick={close} disabled={!!busy} aria-label="Fechar" className="p-1.5 rounded text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {error}
            </p>
          )}

          {result ? (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <p className="text-base font-medium text-slate-800">{result.imported} lançamento(s) importado(s) para {account?.name}</p>
              <p className="text-sm text-slate-600">
                {result.skippedDuplicates > 0 && `${result.skippedDuplicates} já existiam e ficaram de fora. `}
                {(result.autoReconciled ?? 0) > 0 && `${result.autoReconciled} conciliado(s) automaticamente. `}
                Os demais estão na Conciliação para classificar.
              </p>
            </div>
          ) : !extraction ? (
            <>
              {/* 1. Conta, tipo e arquivo */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="pdf-account" className="block text-sm font-medium text-slate-800 mb-1.5">
                    Conta
                  </label>
                  <select id="pdf-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${fieldClass()} ${accountId ? '' : 'text-slate-400'}`}>
                    <option value="">Selecione a conta</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <fieldset>
                  <legend className="text-sm font-medium text-slate-800 mb-1.5">Tipo de documento</legend>
                  <div className="space-y-2">
                    {DOC_TYPES.map((t) => (
                      <label key={t.value} className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer ${documentType === t.value ? 'border-nibo-blue bg-nibo-blueLight' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="radio" name="pdf-doc-type" checked={documentType === t.value} onChange={() => setDocumentType(t.value)} className="mt-0.5 accent-nibo-blue" />
                        <span>
                          <span className="block text-sm text-slate-800">{t.label}</span>
                          <span className="block text-xs text-slate-500">{t.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div
                onClick={() => !busy && inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) setFile(f);
                }}
                className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-2 cursor-pointer border-slate-300 hover:border-nibo-blue bg-slate-50"
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) setFile(f);
                  }}
                />
                {file ? <FileText className="w-8 h-8 text-nibo-blue" /> : <UploadCloud className="w-8 h-8 text-nibo-blue" />}
                <p className="text-sm font-medium text-slate-800">{file ? file.name : 'Arraste o PDF aqui ou clique para escolher'}</p>
                <p className="text-xs text-slate-500">PDF de até 20 MB. Funciona com PDF escaneado.</p>
              </div>

              <p className="text-xs text-slate-500">
                O PDF é enviado à IA da Anthropic (Claude) só para leitura, e não é guardado. Nada é gravado antes de você revisar e confirmar.
              </p>
            </>
          ) : (
            <>
              {/* 2. Rascunho para revisão */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-slate-100">
                  {extraction.bankName ?? 'Documento'} {extraction.periodStart && `· ${brDate(extraction.periodStart)} a ${brDate(extraction.periodEnd)}`}
                </span>
                <span className="px-2 py-1 rounded bg-slate-100">
                  {included.length} de {rows.length} lançamentos
                </span>
                <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800">Entradas {money(income)}</span>
                <span className="px-2 py-1 rounded bg-rose-50 text-rose-700">Saídas {money(expense)}</span>
              </div>

              {check ? (
                <p className={`text-sm rounded px-3 py-2 border flex items-start gap-2 ${check.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                  {check.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
                  {check.ok ? (
                    <span>Confere com o documento ({check.label}).</span>
                  ) : (
                    <span>
                      Não confere com o documento ({check.label}): esperado {money(check.expected)}, lançamentos somam {money(check.got)} — diferença de{' '}
                      {money(round(check.expected - check.got))}. Pode faltar ou sobrar alguma linha: compare com o PDF antes de importar.
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm rounded px-3 py-2 border bg-amber-50 border-amber-200 text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> O documento não mostra {extraction.documentType === 'CREDIT_CARD' ? 'o total da fatura' : 'o saldo inicial e final'}: confira os
                  lançamentos com o PDF.
                </p>
              )}
              {extraction.discarded > 0 && <p className="text-xs text-slate-500">{extraction.discarded} linha(s) sem data ou valor foram descartadas pela leitura.</p>}

              {extraction.documentType === 'CREDIT_CARD' && extraction.dueDate && (
                <fieldset className="flex flex-wrap items-center gap-4 text-sm">
                  <legend className="sr-only">Data dos lançamentos</legend>
                  <span className="text-slate-700">Data dos lançamentos:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="pdf-date" checked={!useDueDate} onChange={() => setUseDueDate(false)} className="accent-nibo-blue" /> data da compra
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="pdf-date" checked={useDueDate} onChange={() => setUseDueDate(true)} className="accent-nibo-blue" /> vencimento da fatura ({brDate(extraction.dueDate)})
                  </label>
                </fieldset>
              )}

              <div className="border border-slate-200 rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-slate-700 text-left">
                    <tr>
                      <th className="px-3 py-2 w-10">
                        <input
                          type="checkbox"
                          aria-label="Marcar todas"
                          checked={rows.length > 0 && rows.every((r) => r.include)}
                          onChange={(e) => setRows((list) => list.map((r) => ({ ...r, include: e.target.checked })))}
                          className="w-4 h-4 accent-nibo-blue"
                        />
                      </th>
                      <th className="px-2 py-2 font-medium w-40">Data</th>
                      <th className="px-2 py-2 font-medium">Descrição</th>
                      <th className="px-2 py-2 font-medium text-right w-44">Valor</th>
                      <th className="w-10" aria-label="Remover" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.key} className={r.include ? '' : 'opacity-40'}>
                        <td className="px-3 py-1.5">
                          <input type="checkbox" aria-label={`Incluir ${r.description}`} checked={r.include} onChange={(e) => update(r.key, { include: e.target.checked })} className="w-4 h-4 accent-nibo-blue" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="date" aria-label="Data" value={r.date} disabled={!!useDueDate && extraction.documentType === 'CREDIT_CARD'} onChange={(e) => update(r.key, { date: e.target.value })} className="h-8 px-2 rounded border border-slate-300 text-sm w-full disabled:bg-slate-50" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input aria-label="Descrição" value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className="h-8 px-2 rounded border border-slate-300 text-sm w-full" />
                        </td>
                        <td className={`px-2 py-1.5 ${r.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                          <MoneyInput aria-label="Valor" value={r.amount} onChange={(v) => update(r.key, { amount: v })} className="h-8" />
                        </td>
                        <td className="pr-2">
                          <button type="button" onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))} aria-label="Remover linha" title="Remover linha" className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">Saídas com valor negativo (tecla "-" inverte o sinal). As linhas vão para a Conciliação de {account?.name}, onde são classificadas.</p>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-500">{busy === 'reading' && 'Lendo o PDF com IA... pode levar até 1 minuto.'}</span>
          <div className="flex items-center gap-5">
            {result ? (
              <button type="button" onClick={onClose} className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium">
                Concluir
              </button>
            ) : (
              <>
                <button type="button" onClick={extraction ? () => setExtraction(null) : close} disabled={!!busy} className="text-sm text-nibo-blue hover:underline disabled:opacity-50">
                  {extraction ? 'Voltar' : 'Cancelar'}
                </button>
                {extraction ? (
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={!!busy || included.length === 0}
                    className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                  >
                    {busy === 'importing' && <Loader2 className="w-4 h-4 animate-spin" />}
                    Confirmar importação ({included.length})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={read}
                    disabled={!!busy || !file || !documentType || !accountId}
                    className="px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                  >
                    {busy === 'reading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Ler PDF com IA
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
