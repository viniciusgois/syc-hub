import 'dotenv/config';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';

const port = Number(process.env.PORT ?? 3333);
const server = createApp().listen(port, () => {
  console.log(`SYC Hub API ouvindo em http://localhost:${port}`);
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
