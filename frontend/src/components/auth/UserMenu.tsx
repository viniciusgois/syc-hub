import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { LinkButton, Modal, PrimaryButton } from '../common/Modal';
import { PasswordInput } from './AuthLayout';
import { ROLE_LABEL } from '../../lib/roles';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

const ChangePasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { notify } = useCompany();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (next !== confirm) {
      setError('As senhas novas não conferem');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/me/password', { currentPassword: current, newPassword: next });
      notify('Senha alterada. As outras sessões foram encerradas.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Alterar senha"
      onClose={onClose}
      busy={busy}
      width="max-w-md"
      footer={
        <>
          <LinkButton type="button" onClick={onClose} disabled={busy}>
            Cancelar
          </LinkButton>
          <PrimaryButton type="button" onClick={save} disabled={busy || !current || !next}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {(
          [
            ['pw-current', 'Senha atual', current, setCurrent, 'current-password'],
            ['pw-new', 'Nova senha', next, setNext, 'new-password'],
            ['pw-confirm', 'Confirme a nova senha', confirm, setConfirm, 'new-password'],
          ] as const
        ).map(([id, label, value, onChange, autoComplete]) => (
          <div key={id}>
            <label htmlFor={id} className="block text-sm font-medium text-slate-800 mb-1.5">
              {label}
            </label>
            <PasswordInput id={id} value={value} onChange={onChange} autoComplete={autoComplete} autoFocus={id === 'pw-current'} />
          </div>
        ))}
        <p className="text-xs text-slate-500">Mínimo de 8 caracteres, com letras e números.</p>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
};

/** Avatar no rodapé do trilho: quem está logado, papel na empresa, alterar senha e sair */
export const UserMenu: React.FC = () => {
  const { user, logout } = useAuth();
  const { role, currentCompany } = useCompany();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.name}
        className="w-8 h-8 rounded-full bg-blue-800/80 border border-blue-400/50 flex items-center justify-center text-white text-[11px] font-bold hover:ring-2 hover:ring-blue-400 transition-all shadow"
      >
        {initials(user.name)}
      </button>
      {open && (
        <div role="menu" className="absolute left-11 bottom-0 w-64 bg-white rounded-md shadow-xl border border-slate-200 py-2 text-slate-700 z-50">
          <div className="px-4 py-2 border-b border-slate-100">
            <p className="text-sm font-medium text-slate-800 truncate">{user.name}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
            <p className="mt-1.5 text-xs text-slate-500 truncate">
              {ROLE_LABEL[role]} em <span className="text-slate-700">{currentCompany.tradeName}</span>
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
            className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2"
          >
            <KeyRound className="w-4 h-4 text-slate-400" /> Alterar senha
          </button>
          <button type="button" role="menuitem" onClick={logout} className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2">
            <LogOut className="w-4 h-4 text-slate-400" /> Sair
          </button>
        </div>
      )}
      {changing && <ChangePasswordModal onClose={() => setChanging(false)} />}
    </div>
  );
};
