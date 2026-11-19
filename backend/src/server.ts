import 'dotenv/config';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';

const port = Number(process.env.PORT ?? 3333);
const server = createApp().listen(port, '0.0.0.0', () => {
  console.log(`SYC Hub API ouvindo em http://localhost:${port}`);
});

server.on('error', (err) => {
  console.error('Erro no servidor HTTP:', err);
  process.exit(1);
});

// Saída com calma: na troca de versão o Swarm manda SIGTERM à instância antiga. Para de aceitar conexões novas,
// termina as requisições em andamento (até 20 s) e fecha o banco.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} recebido: encerrando com calma...`);
  const force = setTimeout(() => process.exit(0), 20_000);
  force.unref();
  server.close(() => {
    prisma
      .$disconnect()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
  server.closeIdleConnections();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
