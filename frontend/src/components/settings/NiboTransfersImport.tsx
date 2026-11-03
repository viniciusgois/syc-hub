import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, UploadCloud } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { money } from '../../lib/entries';
import { NiboTransfersFile, readNiboTransfersFile } from '../../lib/niboTransfers';
import { LinkButton, PrimaryButton, fieldClass } from '../common/Modal';

interface Preview {
  count: number;
  toCreate: number;
  skipped: number;
  total: number;
  accounts: { name: string; accountId: string | null }[];
  effect: { name: string; in: number; out: number; net: number }[];
  availableAccounts: { id: string; name: string }[];
}

/** Passo 3 da migração: transferências entre contas (relatório "Transferências" do Nibo, em Excel) */
export const NiboTransfersImport: React.FC<{ onImported: () => void }> = ({ onImported }) => {
  const { currentCompany, notify, refreshLedger } = useCompany();
  const [file, setFile] = useState<(NiboTransfersFile & { fileName: string }) | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/companies/${currentCompany.id}/nibo-imports/transfers`;

  const loadPreview = async (f: NiboTransfersFile & { fileName: string }, map: Record<string, string>) => {
    const p = await api.post<Preview>(`${base}/preview`, { fileName: f.fileName, transfers: f.transfers, accountMap: map });
    setPreview(p);
  };

  const open = async (f: File) => {
    setError(null);
    setDone(null);
    setPreview(null);
    if (!/\.xlsx?$/i.test(f.name)) return setError('Envie o relatório de transferências em Excel (.xlsx).');
    setBusy('reading');
    try {
      const parsed = { ...(await readNiboTransfersFile(f)), fileName: f.name };
      if (!parsed.transfers.length) throw new Error('Nenhuma transferência encontrada na planilha.');
      setFile(parsed);
      setAccountMap({});
      await loadPreview(parsed, {});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const chooseAccount = async (name: string, id: string) => {
    if (!file) return;
    const next = { ...accountMap, [name]: id };
    setAccountMap(next);
    try {
      await loadPreview(file, next);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const confirm = async () => {
    if (!file || !preview) return;
    setBusy('importing');
    setError(null);
    try {
      const res = await api.post<{ created: { transfers: number } }>(base, { fileName: file.fileName, transfers: file.transfers, accountMap });
      setDone(res.created.transfers);
      setPreview(null);
      setFile(null);
      await refreshLedger();
      notify(`${res.created.transfers} transferências importadas do Nibo`);
      onImported();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const missing = preview?.accounts.filter((a) => !a.accountId) ?? [];

  return (
    <section className="border border-slate-200 rounded p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-slate-800">3. Transferências entre contas (Excel)</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            No Nibo: <em>Relatórios › Transferências</em>, do período inteiro, exportado em Excel. Faça depois dos lançamentos: as contas são as que o passo 2 criou.
            As transferências não entram no resultado (Painel), só no saldo das contas.
          </p>
        </div>
        {!preview && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!!busy}
            className="h-10 px-4 rounded border border-nibo-blue text-nibo-blue text-sm font-medium hover:bg-nibo-blueLight flex items-center gap-2 disabled:opacity-50"
          >
            {busy === 'reading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            Enviar Excel de transferências
          </button>
        )}
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
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      {done !== null && (
        <p className="text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {done} transferência(s) importada(s). Confira os saldos em Contas &amp; Extratos.
        </p>
      )}

      {preview && file && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 rounded bg-slate-100">
              {preview.count} transferências · R$ {money(preview.total)}
            </span>
            <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800">{preview.toCreate} a importar</span>
            {preview.skipped > 0 && <span className="px-2 py-1 rounded bg-slate-100">{preview.skipped} já existem no SYC Hub (ficam de fora)</span>}
          </div>

          {missing.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Contas do Nibo sem conta correspondente no SYC Hub: escolha qual usar.
              </p>
              {missing.map((a) => (
                <div key={a.name} className="flex items-center gap-3">
                  <span className="text-sm w-56 truncate">{a.name}</span>
                  <select aria-label={`Conta para ${a.name}`} value={accountMap[a.name] ?? ''} onChange={(e) => chooseAccount(a.name, e.target.value)} className={`${fieldClass()} max-w-xs`}>
                    <option value="">Selecione...</option>
                    {preview.availableAccounts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <table className="w-full max-w-2xl text-sm">
            <thead className="text-left text-slate-600 bg-slate-100">
              <tr>
                <th className="px-3 py-2 font-medium">Conta</th>
                <th className="px-3 py-2 font-medium text-right">Entra</th>
                <th className="px-3 py-2 font-medium text-right">Sai</th>
                <th className="px-3 py-2 font-medium text-right">Efeito no saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {preview.effect.map((e) => (
                <tr key={e.name}>
                  <td className="px-3 py-2">{e.name}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{money(e.in)}</td>
                  <td className="px-3 py-2 text-right text-rose-600">{money(e.out)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${e.net < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{money(e.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {file.unpaired.length > 0 && (
            <p className="text-sm text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Transferências em que o arquivo só trouxe um dos lados (linhas {file.unpaired.slice(0, 15).join(', ')}
                {file.unpaired.length > 15 && '…'}): entram mesmo assim, saindo da origem e entrando no destino. Confira no Nibo.
              </span>
            </p>
          )}
          {file.skipped.length > 0 && (
            <p className="text-xs text-slate-500">
              {file.skipped.length} linha(s) ignorada(s): {file.skipped.slice(0, 5).map((s) => `${s.line} (${s.reason})`).join(', ')}
            </p>
          )}
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            Cada transferência vira uma saída na conta de origem <ArrowRight className="w-3 h-3" /> e uma entrada na de destino, já conciliadas. Ao importar o OFX depois, a linha do banco
            é reconhecida e não duplica.
          </p>

          <div className="flex items-center justify-end gap-5">
            <LinkButton onClick={() => setPreview(null)} disabled={!!busy}>
              Cancelar
            </LinkButton>
            <PrimaryButton onClick={confirm} disabled={!!busy || missing.length > 0 || preview.toCreate === 0}>
              {busy === 'importing' && <Loader2 className="w-4 h-4 animate-spin" />}
              Importar {preview.toCreate} transferências
            </PrimaryButton>
          </div>
        </>
      )}
    </section>
  );
};
