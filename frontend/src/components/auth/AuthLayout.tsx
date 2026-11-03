import React from 'react';

/** Marca do SYC Hub (a mesma constelação do trilho lateral) */
export const BrandMark: React.FC<{ className?: string }> = ({ className = 'w-8 h-8' }) => (
  <svg viewBox="0 0 32 32" className={`${className} fill-current`} aria-hidden="true">
    <circle cx="8" cy="23" r="3.6" />
    <circle cx="16" cy="9" r="3.6" />
    <circle cx="24" cy="23" r="3.6" />
    <path d="M8 23 L16 9 L24 23" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

/** Moldura das telas fora do sistema (login, definir senha) */
export const AuthLayout: React.FC<{ title: string; subtitle?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div className="min-h-screen flex bg-[#f4f6f9] text-slate-800">
    <aside className="hidden lg:flex w-[42%] max-w-[560px] bg-[#14233c] text-white flex-col justify-between p-12">
      <div className="flex items-center gap-3">
        <BrandMark className="w-9 h-9 text-white" />
        <span className="text-xl font-semibold tracking-tight">SYC Hub</span>
      </div>
      <div>
        <p className="text-3xl font-semibold leading-snug">Gestão financeira e BPO das suas empresas em um só lugar.</p>
        <p className="mt-4 text-slate-300">Extratos, conciliação, contas a pagar e receber, fluxo de caixa e o painel de resultados de cada cliente.</p>
      </div>
      <p className="text-xs text-slate-400">Save Your Company</p>
    </aside>
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex lg:hidden items-center gap-2.5 mb-8 text-[#14233c]">
          <BrandMark className="w-8 h-8" />
          <span className="text-lg font-semibold">SYC Hub</span>
        </div>
        <h1 className="text-2xl font-medium text-slate-800">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-7">{children}</div>
      </div>
    </main>
  </div>
);

/** Campo de senha com mostrar/ocultar */
export const PasswordInput: React.FC<{
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  invalid?: boolean;
}> = ({ id, value, onChange, autoComplete, autoFocus, invalid }) => {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className={`w-full h-11 pl-3 pr-16 rounded border bg-white text-sm focus:outline-none focus:ring-2 ${
          invalid ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-nibo-blue focus:ring-nibo-blueLight'
        }`}
      />
      <button type="button" onClick={() => setVisible((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-nibo-blue hover:underline">
        {visible ? 'Ocultar' : 'Mostrar'}
      </button>
    </div>
  );
};

