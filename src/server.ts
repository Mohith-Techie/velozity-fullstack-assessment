import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { startJobs } from './jobs/scheduler.js';
import { prisma } from './lib/prisma.js';
import { attachSocketServer } from './realtime/socket.js';

// Express and Socket.IO share one HTTP server, and so one port.
const httpServer = createServer(createApp());
const io = attachSocketServer(httpServer);
let stopJobs = async (): Promise<void> => {};

httpServer.listen(env.PORT, () => {
  console.log(`API + Socket.IO listening on http://localhost:${env.PORT}`);
  // Jobs start once the socket server is up, so the events they emit have somewhere to go.
  if (env.JOBS_ENABLED) stopJobs = startJobs();
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down`);
  void stopJobs() // stop scheduling; let an in-flight sweep finish its batch
    .then(() => new Promise<void>((resolve) => void io.close(() => resolve()))) // sockets, then the HTTP server
    .finally(() => prisma.$disconnect())
    .finally(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
