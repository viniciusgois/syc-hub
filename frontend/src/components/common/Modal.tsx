import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** Modal centralizado simples (Esc e clique fora fecham, exceto quando `busy`) */
export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  busy?: boolean;
  width?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, onClose, busy, width = 'max-w-lg', footer, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={() => !busy && onClose()} />
      <div className={`relative w-full ${width} max-h-[90vh] bg-white rounded-md shadow-2xl flex flex-col text-slate-800`}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-700">{title}</h2>
          <button onClick={onClose} disabled={busy} aria-label="Fechar" className="p-1.5 rounded text-slate-500 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-5">{footer}</div>}
      </div>
    </div>
  );
};

export const fieldClass = (error?: string) =>
  `w-full h-10 px-3 rounded border text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 ${
    error ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
  }`;

export const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', ...props }) => (
  <button
    {...props}
    className={`px-5 h-10 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center gap-2 disabled:opacity-50 ${className}`}
  />
);

export const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', ...props }) => (
  <button {...props} className={`text-sm text-nibo-blue hover:underline disabled:opacity-50 ${className}`} />
);
