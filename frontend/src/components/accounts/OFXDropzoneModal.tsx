import React, { useState, useRef, useEffect } from 'react';
import { useCompany, ImportRequest, ImportResult } from '../../context/CompanyContext';
import { SAMPLE_OFX_ITAU } from '../../utils/sampleOfx';
import { errorMessage } from '../../lib/api';
import { accountDetails } from '../../lib/accounts';
import * as XLSX from 'xlsx';
import {
  UploadCloud,
  X,
  FileText,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownLeft,
  Sparkles,
  Landmark,
  AlertCircle,
  Loader2,
} from 'lucide-react';

interface OFXDropzoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAccountId?: string;
  onAddAccount: () => void;
  /** Menu "Importar" da Conciliação: só OFX ou só planilha (sem = aceita os dois) */
  kind?: ImportKind;
}

export type ImportKind = 'OFX' | 'SHEET';

/** Planilha modelo: Data | Descrição | Valor (negativo = saída) */
function downloadSheetTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Data', 'Descrição', 'Valor'],
    ['01/10/2026', 'PIX RECEBIDO - CLIENTE EXEMPLO', 1500],
    ['02/10/2026', 'TARIFA BANCARIA', -45.9],
  ]);
  sheet['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 12 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Extrato');
  XLSX.writeFile(book, 'modelo_extrato_sychub.xlsx');
}

const formatBRL = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Converte a célula de data da planilha (Date, serial do Excel, dd/mm/aaaa ou aaaa-mm-dd) em aaaa-mm-dd */
function toIsoDate(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  if (typeof raw === 'number') {
    const parsed = XLSX.SSF.parse_date_code(raw);
    return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}` : null;
  }
  const text = String(raw ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/** "1.234,56" | "-1234.56" | 1234.56 -> número */
function toAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  let v = String(raw ?? '').replace(/[R$\s]/g, '');
  if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
  const n = Number(v);
  return v && Number.isFinite(n) ? n : null;
}

export const OFXDropzoneModal: React.FC<OFXDropzoneModalProps> = ({
  isOpen,
  onClose,
  defaultAccountId,
  onAddAccount,
  kind,
}) => {
  const { accounts, currentCompany, previewImport, importStatement, notify } = useCompany();

  const [selectedAccountId, setSelectedAccountId] = useState<string>(defaultAccountId || (accounts[0]?.id ?? ''));
  const [isDragging, setIsDragging] = useState(false);
  const [source, setSource] = useState<
    | { fileName: string; fileType: 'OFX' | 'XLSX' | 'CSV'; payload: { kind: 'OFX'; content: string } | Extract<ImportRequest, { kind: 'ROWS' }>['rows'] }
    | null
  >(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ao abrir, aponta para a conta pedida (ou a primeira da empresa)
  useEffect(() => {
    if (isOpen) setSelectedAccountId(defaultAccountId || (accounts[0]?.id ?? ''));
  }, [isOpen, defaultAccountId, accounts]);

  const buildRequest = (): ImportRequest | null => {
    if (!source || !selectedAccountId) return null;
    const base = { bankAccountId: selectedAccountId, fileName: source.fileName };
    return Array.isArray(source.payload)
      ? { ...base, kind: 'ROWS', fileType: source.fileType === 'CSV' ? 'CSV' : 'XLSX', rows: source.payload }
      : { ...base, ...source.payload };
  };

  // Prévia calculada no backend (regras + duplicidade dependem da conta escolhida)
  useEffect(() => {
    const req = buildRequest();
    if (!req) return;
    let cancelled = false;
    setIsProcessing(true);
    setError(null);
    previewImport(req)
      .then((result) => !cancelled && setPreview(result))
      .catch((err) => {
        if (cancelled) return;
        setPreview(null);
        setError(errorMessage(err));
      })
      .finally(() => !cancelled && setIsProcessing(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, selectedAccountId]);

  if (!isOpen) return null;

  const resetFile = () => {
    setSource(null);
    setPreview(null);
    setError(null);
  };

  const handleClose = () => {
    resetFile();
    setImportSuccessMessage(null);
    onClose();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    setPreview(null);
    setError(null);

    if (ext === 'ofx') {
      setSource({ fileName: file.name, fileType: 'OFX', payload: { kind: 'OFX', content: await file.text() } });
      return;
    }

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      // Layout esperado: Data | Descrição | Valor (negativo = saída), com cabeçalho na 1ª linha
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });

      const rows: { date: string; description: string; amount: number }[] = [];
      let invalid = 0;
      for (const row of data.slice(1)) {
        if (!row || row.every((c) => c === undefined || c === '')) continue;
        const date = toIsoDate(row[0]);
        const amount = toAmount(row[2]);
        if (!date || amount === null || amount === 0) {
          invalid++;
          continue;
        }
        rows.push({ date, description: String(row[1] ?? '').trim() || 'Lançamento Planilha', amount });
      }

      if (!rows.length) {
        setSource(null);
        setError('Nenhuma linha válida encontrada. Use as colunas: Data | Descrição | Valor.');
        return;
      }
      if (invalid) notify(`${invalid} linha(s) da planilha foram ignoradas por data ou valor inválido`, 'error');
      setSource({ fileName: file.name, fileType: ext === 'csv' ? 'CSV' : 'XLSX', payload: rows });
      return;
    }

    setError('Formato não suportado. Envie um arquivo .OFX, .XLSX ou .CSV.');
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await processFile(e.target.files[0]);
      e.target.value = ''; // permite selecionar o mesmo arquivo de novo
    }
  };

  const handleLoadSampleOFX = () => {
    setSource({ fileName: 'extrato_itau_outubro_2026.ofx', fileType: 'OFX', payload: { kind: 'OFX', content: SAMPLE_OFX_ITAU } });
  };

  const handleConfirmImport = async () => {
    const req = buildRequest();
    if (!req || !preview?.imported) return;
    setIsImporting(true);
    try {
      const result = await importStatement(req);
      const skipped = result.skippedDuplicates ? ` (${result.skippedDuplicates} já existiam e foram ignoradas)` : '';
      setImportSuccessMessage(`${result.imported} transações importadas com sucesso${skipped}!`);
      setTimeout(handleClose, 1800);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsImporting(false);
    }
  };

  const lines = preview?.preview ?? [];
  const fileName = source?.fileName;
  const fileType = source?.fileType;
  const totalCredits = preview?.totalIncome ?? 0;
  const totalDebits = preview?.totalExpense ?? 0;
  const suggestedCount = (preview?.suggested ?? 0) + (preview?.autoReconciled ?? 0);
  const importableCount = preview?.imported ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-800">
        {/* Header do Modal */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded bg-blue-50 text-blue-600 flex items-center justify-center">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                {kind === 'OFX' ? 'Importar extrato em OFX' : kind === 'SHEET' ? 'Importar extrato em planilha' : 'Importação de Extratos Bancários'}
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {kind === 'OFX' ? 'OFX' : kind === 'SHEET' ? 'XLSX / CSV' : 'OFX / XLSX'}
                </span>
              </h2>
              <p className="text-xs text-slate-500">
                Empresa destino:{' '}
                <span className="text-slate-800 font-semibold">{currentCompany.legalName}</span>
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            aria-label="Fechar"
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 overflow-y-auto space-y-5">
          {importSuccessMessage ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center animate-bounce">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">{importSuccessMessage}</h3>
              <p className="text-xs text-slate-500">
                O extrato já está disponível na mesa de conciliação.
              </p>
            </div>
          ) : (
            <>
              {/* Seletor de Conta Bancária Destino */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center space-x-1.5">
                  <Landmark className="w-3.5 h-3.5 text-blue-600" />
                  <span>Conta Bancária de Destino</span>
                </label>
                {accounts.length === 0 && (
                  <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800">
                    Esta empresa ainda não tem contas bancárias cadastradas.{' '}
                    <button type="button" onClick={onAddAccount} className="font-semibold underline hover:text-amber-900">
                      Cadastrar conta
                    </button>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {accounts.map((acc) => {
                    const isSelected = selectedAccountId === acc.id;
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => setSelectedAccountId(acc.id)}
                        className={`p-3 rounded-lg border text-left transition-all relative ${
                          isSelected
                            ? 'bg-blue-50/70 border-blue-500 ring-1 ring-blue-500/30'
                            : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: acc.color }}
                          />
                          <span className="text-[10px] font-mono text-slate-400">
                            {accountDetails(acc)}
                          </span>
                        </div>
                        <p className="text-xs font-bold mt-1.5 truncate text-slate-800">{acc.name}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Saldo: <span className="text-slate-800 font-semibold font-mono">R$ {formatBRL(acc.currentBalance)}</span>
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Área Dropzone de Upload */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                    : 'border-slate-300 hover:border-blue-400 bg-slate-50 hover:bg-blue-50/30'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={kind === 'OFX' ? '.ofx' : kind === 'SHEET' ? '.xlsx,.xls,.csv' : '.ofx,.xlsx,.xls,.csv'}
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                  <UploadCloud className="w-6 h-6" />
                </div>

                <p className="text-sm font-bold text-slate-800 text-center">
                  Arraste e solte o arquivo do extrato aqui
                </p>
                {kind === 'SHEET' ? (
                  <p className="text-xs text-slate-500 mt-1 text-center">
                    Planilha <strong className="text-slate-700">.XLSX / .CSV</strong> com as colunas <strong className="text-slate-700">Data | Descrição | Valor</strong> (saídas com valor negativo) e
                    cabeçalho na 1ª linha.{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadSheetTemplate();
                      }}
                      className="text-blue-600 font-semibold hover:underline"
                    >
                      Baixar modelo
                    </button>
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1 text-center">
                    Formatos aceitos: <strong className="text-slate-700">.OFX</strong> (padrão de bancos brasileiros)
                    {kind !== 'OFX' && (
                      <>
                        {' '}ou <strong className="text-slate-700">.XLSX / .CSV</strong>
                      </>
                    )}
                  </p>
                )}

                {kind !== 'SHEET' && <div className="mt-4 flex items-center space-x-2">
                  <span className="text-[11px] text-slate-400">ou</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadSampleOFX();
                    }}
                    className="px-3 py-1.5 rounded text-xs font-semibold bg-white hover:bg-blue-50 border border-blue-200 text-blue-600 transition-colors flex items-center space-x-1.5 shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    <span>Carregar Exemplo OFX (Itaú 5 Lançamentos)</span>
                  </button>
                </div>}
              </div>

              {error && (
                <div role="alert" className="px-3.5 py-2.5 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {isProcessing && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                  Analisando extrato...
                </div>
              )}

              {preview?.warnings.map((w) => (
                <div key={w} className="px-3.5 py-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-800">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}

              {/* Preview dos Lançamentos (calculado pela API) */}
              {lines.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="flex items-center space-x-2.5">
                      <FileText className="w-5 h-5 text-blue-600" />
                      <div>
                        <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          {fileName}
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">
                            {fileType}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {lines.length} transações no arquivo
                          {preview && preview.skippedDuplicates > 0 && ` · ${preview.skippedDuplicates} já importadas`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 text-xs font-mono">
                      <div className="flex items-center space-x-1 text-emerald-600">
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                        <span>+R$ {formatBRL(totalCredits)}</span>
                      </div>
                      <div className="flex items-center space-x-1 text-rose-600">
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        <span>-R$ {formatBRL(totalDebits)}</span>
                      </div>
                    </div>
                  </div>

                  {suggestedCount > 0 && (
                    <div className="px-3.5 py-2.5 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between text-xs text-blue-900">
                      <div className="flex items-center space-x-2">
                        <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
                        <span>
                          <strong>{suggestedCount} transações</strong> serão pré-categorizadas pelas regras de conciliação da empresa.
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="border border-slate-200 rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] sticky top-0 border-b border-slate-200">
                        <tr>
                          <th className="p-2.5">Data</th>
                          <th className="p-2.5">Descrição</th>
                          <th className="p-2.5">FITID</th>
                          <th className="p-2.5 text-right">Valor</th>
                          <th className="p-2.5">Sugestão</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white font-mono">
                        {lines.map((item, idx) => (
                          <tr key={idx} className={item.duplicate ? 'bg-slate-50 opacity-60' : 'hover:bg-slate-50'}>
                            <td className="p-2.5 text-slate-700 whitespace-nowrap">{formatDate(item.date)}</td>
                            <td className="p-2.5 text-slate-800 font-sans font-medium">{item.description}</td>
                            <td className="p-2.5 text-slate-400 text-[11px]">{item.fitid}</td>
                            <td
                              className={`p-2.5 text-right font-bold whitespace-nowrap ${
                                item.type === 'CREDIT' ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {item.type === 'CREDIT' ? '+' : '-'} R$ {formatBRL(item.amount)}
                            </td>
                            <td className="p-2.5 font-sans">
                              {item.duplicate ? (
                                <span className="text-[10px] font-semibold text-slate-500">Já importada</span>
                              ) : item.matchedSettlement ? (
                                <span
                                  title="Esta linha concilia uma baixa já registrada em Recebimentos/Pagamentos (não será duplicada)"
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
                                >
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Baixa: {item.matchedSettlement}
                                </span>
                              ) : item.entryMatch ? (
                                <span
                                  title="Conta em aberto com o mesmo valor e data próxima. Confirme a conciliação no extrato após importar."
                                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
                                >
                                  Provável: {item.entryMatch}
                                </span>
                              ) : item.ruleName ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                  <Sparkles className="w-2.5 h-2.5 text-blue-500" />
                                  {item.ruleName}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">Pendente manual</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-xs text-slate-500">
            <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
            <span>FITIDs repetidos são ignorados para prevenir duplicidade de lançamentos.</span>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 border border-slate-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={importableCount === 0 || isProcessing || isImporting}
              onClick={handleConfirmImport}
              className="px-4 py-2 rounded text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isImporting ? 'Importando...' : `Confirmar e Importar ${importableCount} Lançamentos`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
