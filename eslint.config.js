import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
    js.configs.recommended,
    ...ts.configs.recommended,
    ...svelte.configs['flat/recommended'],
    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.node }
        }
    },
    {
        files: ['**/*.svelte'],
        languageOptions: {
            parserOptions: { parser: ts.parser }
        }
    },
    {
        rules: {
            // The database rows and API payloads are genuinely dynamic; the
            // types that matter are asserted at the boundaries instead.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ]
        }
    },
    {
        // Build output, not source. Linting it drowns real findings in
        // hundreds of complaints about minified code nobody wrote.
        ignores: ['.svelte-kit/', '.vercel/', 'build/', 'dist/', 'node_modules/', '**/*.sqlite']
    }
);
