// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

/**
 * Server-rendered, Node adapter — not static, and not edge.
 *
 * The naming engine resolves NS records over `node:dns`, reads the system word
 * list off disk to build its trigram model, and caches API responses to the
 * filesystem. None of that survives a static build or an edge runtime, so the
 * app runs as a long-lived Node server.
 */
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 4321, host: false },
  devToolbar: { enabled: false },
});
