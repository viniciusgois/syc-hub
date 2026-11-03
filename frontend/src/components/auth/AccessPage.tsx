import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api, errorMessage, setAuthToken } from '../../lib/api';
import { AuthUser } from '../../context/AuthContext';
import { AuthLayout, PasswordInput } from './AuthLayout';

interface AccessInfo {
  type: 'INVITE' | 'PASSWORD_RESET';
  user: { name: string; email: string };
  expiresAt: string;
}

/** Link de convite (primeiro acesso) ou de redefinição de senha: define a senha e já entra */
export const AccessPage: React.FC<{ token: string; onSignedIn: (user: AuthUser) => void; onCancel: () => void }> = ({ token, onSignedIn, onCancel }) => {
  const [info, setInfo] = useState<AccessInfo | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<AccessInfo>(`/auth/access/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) => setInvalid(errorMessage(err)));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('As senhas não conferem');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { user, token: sessionToken } = await api.post<{ user: AuthUser; token?: string }>(`/auth/access/${encodeURIComponent(token)}`, { password });
      if (sessionToken) setAuthToken(sessionToken);
      onSignedIn(user);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <AuthLayout title="Link inválido" subtitle={invalid}>
        <button type="button" onClick={onCancel} className="w-full h-11 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium">
          Ir para o login
        </button>
      </AuthLayout>
    );
  }
  if (!info) {
    return (
      <AuthLayout title="Carregando...">
        <Loader2 className="w-5 h-5 text-nibo-blue animate-spin" />
      </AuthLayout>
    );
  }

  const invite = info.type === 'INVITE';
  return (
    <AuthLayout
      title={invite ? `Olá, ${info.user.name.split(' ')[0]}!` : 'Redefinir senha'}
      subtitle={
        <>
          {invite ? 'Crie sua senha para acessar o SYC Hub com o e-mail ' : 'Crie uma nova senha para '}
          <strong className="text-slate-700">{info.user.email}</strong>.
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="access-password" className="block text-sm font-medium text-slate-800 mb-1.5">
            Nova senha
          </label>
          <PasswordInput id="access-password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
          <p className="mt-1 text-xs text-slate-500">Mínimo de 8 caracteres, com letras e números.</p>
        </div>
        <div>
          <label htmlFor="access-confirm" className="block text-sm font-medium text-slate-800 mb-1.5">
            Confirme a senha
          </label>
          <PasswordInput id="access-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!error && password !== confirm} />
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="w-full h-11 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {invite ? 'Criar senha e entrar' : 'Salvar e entrar'}
        </button>
      </form>
    </AuthLayout>
  );
};
