import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, UserCheck } from 'lucide-react';
import { api, errorMessage, setAuthToken } from '../../lib/api';
import { AuthUser } from '../../context/AuthContext';
import { AuthLayout, PasswordInput } from './AuthLayout';

const authInput =
  'w-full h-11 px-3 rounded border border-slate-300 bg-white text-sm focus:outline-none focus:border-nibo-blue focus:ring-2 focus:ring-nibo-blueLight';

export const LoginPage: React.FC<{ onSignedIn: (user: AuthUser) => void; expired?: boolean }> = ({ onSignedIn, expired }) => {
  const [isSetup, setIsSetup] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    api
      .get<{ needsSetup: boolean }>('/auth/setup-status')
      .then((res) => setIsSetup(res.needsSetup))
      .catch(() => setIsSetup(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Informe e-mail e senha');
      return;
    }
    if (isSetup) {
      if (!name.trim()) {
        setError('Informe o seu nome');
        return;
      }
      if (password.length < 8) {
        setError('A senha deve ter no mínimo 8 caracteres');
        return;
      }
      if (password !== confirmPassword) {
        setError('As senhas não coincidem');
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      if (isSetup) {
        const { user, token } = await api.post<{ user: AuthUser; token?: string }>('/auth/setup', {
          name,
          email,
          password,
        });
        if (token) setAuthToken(token);
        onSignedIn(user);
      } else {
        const { user, token } = await api.post<{ user: AuthUser; token?: string }>('/auth/login', { email, password });
        if (token) setAuthToken(token);
        onSignedIn(user);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (isSetup) {
    return (
      <AuthLayout
        title="Primeiro Acesso"
        subtitle="Seu banco está pronto e vazio. Cadastre o primeiro administrador para iniciar."
      >
        <div className="mb-4 p-3 rounded bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center gap-2">
          <UserCheck className="w-4 h-4 shrink-0 text-blue-600" />
          <span>Este usuário terá acesso total (Proprietário) para gerenciar o SYC Hub.</span>
        </div>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="setup-name" className="block text-sm font-medium text-slate-800 mb-1.5">
              Seu Nome Completo
            </label>
            <input
              id="setup-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={authInput}
              placeholder="Ex: Vinicius Gois"
            />
          </div>
          <div>
            <label htmlFor="setup-email" className="block text-sm font-medium text-slate-800 mb-1.5">
              E-mail
            </label>
            <input
              id="setup-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInput}
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label htmlFor="setup-password" className="block text-sm font-medium text-slate-800 mb-1.5">
              Senha (mínimo 8 caracteres com letras e números)
            </label>
            <PasswordInput
              id="setup-password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              invalid={!!error}
            />
          </div>
          <div>
            <label htmlFor="setup-confirm-password" className="block text-sm font-medium text-slate-800 mb-1.5">
              Confirme a Senha
            </label>
            <PasswordInput
              id="setup-confirm-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              invalid={!!error}
            />
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 text-sm text-rose-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Criar Administrador e Começar
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Entrar" subtitle="Acesse com o e-mail e a senha cadastrados.">
      {expired && !error && (
        <p role="status" className="mb-4 px-3 py-2.5 rounded border border-amber-200 bg-amber-50 text-sm text-amber-900">
          Sua sessão expirou. Entre novamente.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-slate-800 mb-1.5">
            E-mail
          </label>
          <input id="login-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
        </div>
        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-slate-800 mb-1.5">
            Senha
          </label>
          <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} />
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="w-full h-11 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Entrar
        </button>
      </form>
      <button type="button" onClick={() => setForgot((v) => !v)} className="mt-5 text-sm text-nibo-blue hover:underline" aria-expanded={forgot}>
        Esqueci minha senha
      </button>
      {forgot && (
        <p className="mt-2 text-sm text-slate-600">
          Peça ao administrador da sua empresa um link para redefinir a senha. Ele gera o link em <strong>Configurações › Usuários</strong> e envia para você.
        </p>
      )}
    </AuthLayout>
  );
};
