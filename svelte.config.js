import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: {
    // Node runtime, not edge: TypeORM needs Node APIs and a real TCP socket
    // to Neon. Every function here is a short read or write — the long-running
    // discovery work happens in the local worker, never in a Vercel function.
    adapter: adapter({ runtime: 'nodejs22.x' })
  }
};
