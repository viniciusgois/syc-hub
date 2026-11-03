import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Pencil, Trash2, User, Loader2, Info, Link2, KeyRound, Copy, Check } from 'lucide-react';
import { useCompany } from '../../context/CompanyContext';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { LinkButton, Modal, PrimaryButton, fieldClass } from '../common/Modal';

type Role = 'OWNER' | 'ADMIN' | 'FINANCIAL_OPERATOR' | 'CONSULTANT' | 'VIEWER';

const ROLES: { value: Role; label: string; badge: string; description: string }[] = [
  { value: 'OWNER', label: 'Proprietário', badge: 'PROPRIETÁRIO', description: 'Acesso total, inclusive excluir a empresa e gerenciar proprietários.' },
  { value: 'ADMIN', label: 'Administrador', badge: 'ADMIN', description: 'Acesso total à empresa e aos usuários (exceto proprietários).' },
  { value: 'FINANCIAL_OPERATOR', label: 'Operador financeiro', badge: 'OPERADOR', description: 'Lança, importa extratos e concilia.' },
  { value: 'CONSULTANT', label: 'Consultor', badge: 'CONSULTOR', description: 'Visualiza relatórios e indicadores.' },
  { value: 'VIEWER', label: 'Somente leitura', badge: 'LEITURA', description: 'Apenas visualiza.' },
];
const roleOf = (r: Role) => ROLES.find((x) => x.value === r)!;

const RoleSelect: React.FC<{ value: Role; onChange: (r: Role) => void }> = ({ value, onChange }) => (
  <div className="space-y-2" role="radiogroup" aria-label="Papel">
    {ROLES.map((r) => (
      <label key={r.value} className={`flex items-start gap-2 p-2.5 rounded border cursor-pointer ${value === r.value ? 'border-nibo-blue bg-nibo-blueLight' : 'border-slate-200 hover:bg-slate-50'}`}>
        <input type="radio" name="role" checked={value === r.value} onChange={() => onChange(r.value)} className="mt-1 accent-nibo-blue" />
        <span>
          <span className="block text-sm text-slate-800">{r.label}</span>
          <span className="block text-xs text-slate-500">{r.description}</span>
        </span>
      </label>
    ))}
  </div>
);

interface Member {
  id: string;
  role: Role;
  user: { id: string; name: string; email: string };
  /** Ainda não criou a senha pelo convite */
  pendingInvite: boolean;
}

interface AccessLink {
  url: string;
  expiresAt: string;
  type: 'INVITE' | 'PASSWORD_RESET';
}

/** Link de convite / redefinição para copiar e enviar (não há envio automático de e-mail) */
const AccessLinkModal: React.FC<{ name: string; link: AccessLink; onClose: () => void }> = ({ name, link, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      (document.getElementById('access-link') as HTMLInputElement | null)?.select();
    }
  };
  const invite = link.type === 'INVITE';
  return (
    <Modal title={invite ? 'Link de convite' : 'Link para redefinir a senha'} onClose={onClose} width="max-w-xl" footer={<PrimaryButton onClick={onClose}>Concluir</PrimaryButton>}>
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          Envie este link para <strong>{name}</strong> (WhatsApp, e-mail...). {invite ? 'Com ele a pessoa cria a senha e entra.' : 'Com ele a pessoa cria uma nova senha.'}
        </p>
        <div className="flex gap-2">
          <input id="access-link" readOnly value={link.url} onFocus={(e) => e.target.select()} className={`${fieldClass()} font-mono text-xs`} aria-label="Link de acesso" />
          <button type="button" onClick={copy} className="shrink-0 px-3 h-10 rounded border border-nibo-blue text-nibo-blue hover:bg-nibo-blueLight flex items-center gap-1.5">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Vale uma única vez, até {new Date(link.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Gerar outro link invalida este.
        </p>
      </div>
    </Modal>
  );
};

export const UsersSettings: React.FC = () => {
  const { currentCompany, notify } = useCompany();
  const { user: me } = useAuth();
  const [link, setLink] = useState<{ name: string; link: AccessLink } | null>(null);
  const base = `/companies/${currentCompany.id}/users`;
  const [list, setList] = useState<Member[] | null>(null);
  const [invite, setInvite] = useState<{ name: string; email: string; role: Role } | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.get<Member[]>(base));
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  }, [base, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, message: string, done: () => void) => {
    setBusy(true);
    setFormError(null);
    try {
      await action();
      notify(message);
      done();
      load();
    } catch (err) {
      setFormError(errorMessage(err));
      if (!invite && !editing) notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="flex-1 overflow-y-auto bg-white px-6 py-5 text-slate-800">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-medium text-slate-700">Usuários</h1>
        <button
          onClick={() => (setFormError(null), setInvite({ name: '', email: '', role: 'FINANCIAL_OPERATOR' }))}
          className="flex items-center gap-1.5 px-4 h-9 rounded bg-nibo-blue hover:bg-nibo-blueHover text-white text-sm font-medium"
        >
          <Mail className="w-4 h-4" /> Convidar usuários
        </button>
      </div>

      <p className="text-sm text-slate-600 mb-2">Exibindo {list?.length ?? 0} itens</p>
      <div className="border border-slate-200 rounded overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-5 py-3 font-medium">Nome</th>
              <th className="px-5 py-3 font-medium">E-mail</th>
              <th className="px-5 py-3" />
              <th className="w-32" />
            </tr>
          </thead>
          <tbody>
            {!list && (
              <tr>
                <td colSpan={4} className="px-5 py-4 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Carregando...
                </td>
              </tr>
            )}
            {list?.map((m) => {
              const isMe = m.user.id === me.id;
              return (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 uppercase">
                    <span className="inline-flex items-center gap-2">
                      {m.user.name}
                      {isMe && (
                        <span title="Você">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3">{m.user.email}</td>
                  <td className="px-5 py-3">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{roleOf(m.role).badge}</span>
                    {m.pendingInvite && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">CONVITE PENDENTE</span>}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {!isMe && (
                      <button
                        onClick={() =>
                          run(
                            async () => setLink({ name: m.user.name, link: await api.post<AccessLink>(`${base}/${m.id}/access-link`) }),
                            m.pendingInvite ? 'Novo link de convite gerado' : 'Link de redefinição gerado',
                            () => undefined,
                          )
                        }
                        disabled={busy}
                        aria-label={m.pendingInvite ? `Gerar link de convite para ${m.user.name}` : `Gerar link para ${m.user.name} redefinir a senha`}
                        title={m.pendingInvite ? 'Gerar link de convite' : 'Gerar link para redefinir a senha'}
                        className="p-1.5 rounded text-nibo-blue hover:bg-nibo-blueLight"
                      >
                        {m.pendingInvite ? <Link2 className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
                      </button>
                    )}
                    <button onClick={() => (setFormError(null), setEditing(m))} aria-label={`Alterar papel de ${m.user.name}`} className="p-1.5 rounded text-nibo-blue hover:bg-nibo-blueLight">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {!isMe && (
                      <button onClick={() => setRemoving(m)} aria-label={`Remover ${m.user.name}`} className="p-1.5 rounded text-nibo-blue hover:bg-rose-50 hover:text-rose-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {invite && (
        <Modal
          title="Convidar usuário"
          onClose={() => setInvite(null)}
          busy={busy}
          width="max-w-xl"
          footer={
            <>
              <LinkButton onClick={() => setInvite(null)}>Cancelar</LinkButton>
              <PrimaryButton
                disabled={busy}
                onClick={() => {
                  if (invite.name.trim().length < 2) return setFormError('Informe o nome');
                  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email.trim())) return setFormError('E-mail inválido');
                  const name = invite.name.trim();
                  run(
                    async () => {
                      const created = await api.post<{ pendingInvite: boolean; invite: AccessLink | null }>(base, invite);
                      if (created.invite) setLink({ name, link: created.invite });
                      else if (created.pendingInvite) notify(`${name} já foi convidado por outra empresa e deve usar aquele convite`, 'error');
                    },
                    `${name} adicionado`,
                    () => setInvite(null),
                  );
                }}
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Adicionar
              </PrimaryButton>
            </>
          }
        >
          <div className="space-y-4">
            {formError && <p className="text-sm text-rose-600" role="alert">{formError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="inv-name" className="block text-sm font-medium text-slate-800 mb-1.5">
                  Nome
                </label>
                <input id="inv-name" autoFocus value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} className={fieldClass()} />
              </div>
              <div>
                <label htmlFor="inv-email" className="block text-sm font-medium text-slate-800 mb-1.5">
                  E-mail
                </label>
                <input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={fieldClass()} />
              </div>
            </div>
            <RoleSelect value={invite.role} onChange={(role) => setInvite({ ...invite, role })} />
            <p className="text-xs text-slate-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Se a pessoa ainda não usa o SYC Hub, você recebe um link de convite para enviar a ela; com ele a pessoa cria a senha. Quem já tem senha passa a ver esta empresa ao entrar.
            </p>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal
          title={`Papel de ${editing.user.name}`}
          onClose={() => setEditing(null)}
          busy={busy}
          width="max-w-xl"
          footer={
            <>
              <LinkButton onClick={() => setEditing(null)}>Cancelar</LinkButton>
              <PrimaryButton disabled={busy} onClick={() => run(() => api.patch(`${base}/${editing.id}`, { role: editing.role }), 'Papel atualizado', () => setEditing(null))}>
                Salvar
              </PrimaryButton>
            </>
          }
        >
          {formError && <p className="text-sm text-rose-600 mb-3" role="alert">{formError}</p>}
          <RoleSelect value={editing.role} onChange={(role) => setEditing({ ...editing, role })} />
        </Modal>
      )}

      {link && <AccessLinkModal name={link.name} link={link.link} onClose={() => setLink(null)} />}

      {removing && (
        <Modal
          title="Remover usuário"
          onClose={() => setRemoving(null)}
          busy={busy}
          footer={
            <>
              <LinkButton onClick={() => setRemoving(null)}>Cancelar</LinkButton>
              <PrimaryButton className="bg-rose-600 hover:bg-rose-700" disabled={busy} onClick={() => run(() => api.delete(`${base}/${removing.id}`), 'Acesso removido', () => setRemoving(null))}>
                Remover
              </PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-slate-700">
            Remover o acesso de {removing.user.name} ({removing.user.email}) a {currentCompany.tradeName}? O cadastro da pessoa continua nas outras empresas.
          </p>
        </Modal>
      )}
    </div>
  );
};
