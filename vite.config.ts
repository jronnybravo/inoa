import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // TypeORM ships CJS with optional driver requires for every database it
  // supports. Without this, Vite tries to bundle react-native-sqlite and
  // friends and the build dies on packages we will never install.
  optimizeDeps: { exclude: ['typeorm', 'pg'] },
  ssr: { external: ['typeorm', 'pg', 'reflect-metadata'] }
});
