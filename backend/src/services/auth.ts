import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { UserRole, UserTokenType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'syc_session';
export const SESSION_DAYS = 30;
const TOKEN_HOURS: Record<UserTokenType, number> = { INVITE: 7 * 24, PASSWORD_RESET: 24 };

// ----------------------------------------------------------------------------
// Senhas (scrypt, sem dependências nativas)
// ----------------------------------------------------------------------------

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Mínimo 8 caracteres, com letra e número */
export function assertStrongPassword(password: string) {
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'A senha precisa de ao menos 8 caracteres, com letras e números', { fields: ['password'] });
  }
}

// ----------------------------------------------------------------------------
// Tokens opacos: o cliente recebe o valor; o banco guarda só o SHA-256
// ----------------------------------------------------------------------------

const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: string, userAgent?: string) {
  const token = newToken();
  await prisma.session.create({
    data: { userId, tokenHash: tokenHash(token), userAgent: userAgent?.slice(0, 250), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return token;
}

export function sessionCookie(token: string | null) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return token
    ? `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}${secure}`
    : `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function readCookie(header: string | undefined, name: string) {
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Link de convite / redefinição (o administrador copia e envia; não há envio de e-mail) */
export async function issueUserToken(userId: string, type: UserTokenType, createdById: string) {
  const token = newToken();
  // Um link válido por vez: gerar outro invalida os anteriores do mesmo tipo
  await prisma.userToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const record = await prisma.userToken.create({
    data: { userId, type, tokenHash: tokenHash(token), createdById, expiresAt: new Date(Date.now() + TOKEN_HOURS[type] * 3_600_000) },
  });
  const appUrl = (process.env.APP_URL ?? process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:5173').replace(/\/$/, '');
  return { url: `${appUrl}/?acesso=${token}`, expiresAt: record.expiresAt, type };
}

// ----------------------------------------------------------------------------
// Papéis
// ----------------------------------------------------------------------------

/** Hierarquia: consultor e somente leitura só visualizam */
export const ROLE_RANK: Record<UserRole, number> = { VIEWER: 0, CONSULTANT: 0, FINANCIAL_OPERATOR: 1, ADMIN: 2, OWNER: 3 };
export const atLeast = (role: UserRole | undefined, min: UserRole) => !!role && ROLE_RANK[role] >= ROLE_RANK[min];

/**
 * Quem pode gerar convite / redefinição de senha para `targetId`: precisa ser administrador em TODAS as empresas
 * de que o usuário participa (e proprietário onde ele for proprietário). Evita que o admin de uma empresa
 * assuma a conta de alguém que também acessa outras empresas.
 */
export async function assertCanManageCredentials(requesterId: string, targetId: string) {
  if (requesterId === targetId) return;
  const [target, mine] = await Promise.all([
    prisma.companyUser.findMany({ where: { userId: targetId }, select: { companyId: true, role: true, company: { select: { tradeName: true } } } }),
    prisma.companyUser.findMany({ where: { userId: requesterId }, select: { companyId: true, role: true } }),
  ]);
  const myRole = new Map(mine.map((m) => [m.companyId, m.role]));
  for (const t of target) {
    const role = myRole.get(t.companyId);
    const ok = t.role === 'OWNER' ? role === 'OWNER' : atLeast(role, 'ADMIN');
    if (!ok) {
      throw new HttpError(403, `Este usuário também acessa "${t.company.tradeName}". Só quem administra todas as empresas dele pode gerar este link.`);
    }
  }
}
