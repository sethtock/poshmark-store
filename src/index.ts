// Sub-agent entry point — run directly with: npm start
import { loadEnv } from './lib/env.js';
import { run } from './agents/poshmark-agent.js';

loadEnv();

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
