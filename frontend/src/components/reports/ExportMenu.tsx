import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';

/** Botão "Exportar" dos relatórios: Excel (.xlsx) ou PDF (para enviar ao dono da empresa) */
export const ExportMenu: React.FC<{ disabled?: boolean; onExcel: () => void; onPdf: () => Promise<void> }> = ({ disabled, onExcel, onPdf }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pdf = async () => {
    setOpen(false);
    setBusy(true);
    try {
      await onPdf();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-9 px-3 rounded border border-slate-300 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Exportar <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded shadow-lg z-30 py-1">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onExcel();
            }}
            className="w-full px-4 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
          </button>
          <button type="button" role="menuitem" onClick={pdf} className="w-full px-4 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 flex items-center gap-2">
            <FileText className="w-4 h-4 text-rose-600" /> PDF
          </button>
        </div>
      )}
    </div>
  );
};
