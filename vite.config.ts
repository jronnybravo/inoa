// The worker and Vercel both read configuration from process.env. Loading .env
// here keeps the dev server on that same path instead of routing dev through
// SvelteKit's $env modules, which the standalone worker cannot import.
import 'dotenv/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    // TypeORM ships CJS with optional driver requires for every database it
    // supports. Without this, Vite tries to bundle react-native-sqlite and
    // friends and the build dies on packages we will never install.
    optimizeDeps: { exclude: ['typeorm', 'pg'] },
    ssr: { external: ['typeorm', 'pg', 'reflect-metadata'] }
});
