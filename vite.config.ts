// The worker and Vercel both read configuration from process.env. Loading .env
// here keeps the dev server on that same path instead of routing dev through
// SvelteKit's $env modules, which the standalone worker cannot import.
import 'dotenv/config';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],
    /*
     * Honour a port handed to us, and fall back to Vite's usual one.
     *
     * Vite does not read PORT by itself: told nothing, it takes 5173, and if
     * that is busy it quietly picks 5174 instead. Anything that assigned us a
     * port is then pointing at the wrong server. Reading PORT here means a
     * tool that allocates a free port actually gets the server it asked for,
     * and running this alongside another Vite project on 5173 stops being a
     * collision.
     */
    server: { port: Number(process.env.PORT) || 5173 },
    // TypeORM ships CJS with optional driver requires for every database it
    // supports. Without this, Vite tries to bundle react-native-sqlite and
    // friends and the build dies on packages we will never install.
    optimizeDeps: { exclude: ['typeorm', 'pg'] },
    ssr: { external: ['typeorm', 'pg', 'reflect-metadata'] }
});
