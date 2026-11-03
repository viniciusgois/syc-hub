import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword, assertStrongPassword } from '../src/services/auth.js';

async function main() {
  const args = process.argv.slice(2);
  const email = (args[0] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = args[1] || process.env.ADMIN_PASSWORD || '';
  const name = (args[2] || process.env.ADMIN_NAME || 'Administrador').trim();

  if (!email || !password) {
    console.error('\nUso:');
    console.error('  npm run user:create <email> <senha> "[Nome Completo]"\n');
    console.error('Exemplo:');
    console.error('  npm run user:create vinicius@exemplo.com SenhaForte123 "Vinicius Gois"\n');
    process.exit(1);
  }

  try {
    assertStrongPassword(password);
  } catch (err: any) {
    console.error(`\nErro: ${err.message}\n`);
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`\nUsuário ${email} já existe. Atualizando senha...`);
    await prisma.user.update({
      where: { email },
      data: {
        passwordHash: await hashPassword(password),
        name: name || existing.name,
      },
    });
    console.log(`✓ Senha atualizada com sucesso para ${email}!\n`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
    },
  });

  console.log('\n=============================================');
  console.log('✓ Usuário criado com sucesso!');
  console.log(`  ID:    ${user.id}`);
  console.log(`  Nome:  ${user.name}`);
  console.log(`  Email: ${user.email}`);
  console.log('=============================================\n');
}

main()
  .catch((err) => {
    console.error('Erro ao criar usuário:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
