import fs from 'node:fs';
import { prisma } from './prisma.js';

/**
 * Commit que está no ar: `APP_COMMIT` (variável) ou o arquivo gravado no build da imagem (`/app/commit`, ver
 * Dockerfile). A Action "Conferir deploy" compara com o commit do push.
 */
function readCommit(): string {
  if (process.env.APP_COMMIT) return process.env.APP_COMMIT.trim();
  const file = process.env.APP_COMMIT_FILE ?? '/app/commit';
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{7,40}$/.test(value)) return value;
  } catch {
    // sem arquivo: ambiente de desenvolvimento
  }
  return 'desconhecido';
}

export const APP_COMMIT = readCommit();

/** O banco responde em até 2 s? */
export async function checkDatabase(timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
