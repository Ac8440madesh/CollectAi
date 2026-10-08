import { env } from './config/env.js';
import { createApp } from './app.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`✅ CollectAI API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`   Health: http://localhost:${env.PORT}/api/health`);
});

// Graceful shutdown so `node --watch` restarts and Ctrl-C exit cleanly.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => process.exit(0));
  });
}
