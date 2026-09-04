import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/*
 * The project's own standard. It is not derived from a published style guide.
 *
 * Two goals, in this order.
 *
 * STRICT means the linter catches defects, not formatting. Everything here is
 * a rule that has an answer — a promise nobody awaited, a switch missing a
 * case, a comparison that coerces — rather than a preference someone could
 * reasonably hold the other way. Type-aware checking is on, because most of
 * the bugs worth catching are invisible without types.
 *
 * STABLE means it does not move under you. Prettier owns every question of
 * layout, so no rule here has an opinion about whitespace and the two cannot
 * disagree. Rule sets are pinned by name rather than spread from `all`, so a
 * dependency bump cannot introduce a rule nobody chose.
 */
export default ts.config(
    {
        // Build output, not source. Linting it produced 576 complaints about
        // minified code nobody wrote, which buried the twenty that mattered.
        ignores: [
            '.svelte-kit/',
            '.vercel/',
            '.claude-flow/',
            '.swarm/',
            'build/',
            'dist/',
            'node_modules/',
            '**/*.sqlite'
        ]
    },

    js.configs.recommended,
    ...ts.configs.strictTypeChecked,
    ...svelte.configs['flat/recommended'],
    importX.flatConfigs.recommended,
    importX.flatConfigs.typescript,

    {
        languageOptions: {
            globals: { ...globals.browser, ...globals.node },
            parserOptions: {
                // Type-aware rules need the program, not just the syntax.
                projectService: true,
                extraFileExtensions: ['.svelte']
            }
        },
        settings: {
            'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })]
        }
    },

    {
        files: ['**/*.svelte'],
        languageOptions: { parserOptions: { parser: ts.parser } }
    },

    {
        rules: {
            /*
             * Braces on every branch, body on its own line.
             *
             * The compact form reads fine right up until somebody adds a
             * second statement and it quietly falls outside the branch, which
             * is a diff that looks correct in review.
             */
            curly: ['error', 'all'],
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-var': 'error',
            'prefer-const': 'error',
            'object-shorthand': 'error',

            /*
             * An unawaited promise is the defect this codebase is most prone
             * to: nearly every function here talks to a database, a browser,
             * or somebody else's API.
             */
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
            '@typescript-eslint/no-misused-promises': 'error',

            // Imports read as: dependencies, then the project, then siblings.
            'import-x/order': [
                'error',
                {
                    groups: [
                        'builtin',
                        'external',
                        'internal',
                        'parent',
                        'sibling',
                        'index',
                        'type'
                    ],
                    'newlines-between': 'never',
                    alphabetize: { order: 'asc', caseInsensitive: true }
                }
            ],
            'import-x/no-duplicates': 'error',
            /*
             * Both fire on plugin packages that legitimately export a default
             * alongside named members — the config file below imports several.
             * They warn about a naming coincidence, not a defect.
             */
            'import-x/no-named-as-default': 'off',
            'import-x/no-named-as-default-member': 'off',
            'import-x/no-unresolved': [
                'error',
                {
                    // SvelteKit's virtual modules exist only at build time, so
                    // no resolver can find them on disk.
                    ignore: ['^\\$app/', '^\\$env/', '^\\$service-worker$']
                }
            ],

            // Rows from the database and payloads from other people's APIs are
            // genuinely unshaped; the types that matter are asserted where the
            // data enters, not pretended at every call site.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ]
        }
    },

    {
        /*
         * Tests, where the one rule that does not apply is switched off.
         *
         * node:test's `describe` and `it` return promises the runner owns and
         * awaits itself; nothing in a test file is supposed to await them. The
         * rule is right everywhere else in this project and stays on there, so
         * it is disabled here rather than relaxed globally.
         */
        files: ['**/*.test.ts'],
        rules: { '@typescript-eslint/no-floating-promises': 'off' }
    },

    {
        /*
         * Config files sit outside the app's TypeScript program, so the
         * type-aware rules have nothing to work from and would only report
         * that fact. Last in the list, because flat config applies in order
         * and this has to win over the rules above it.
         */
        files: ['*.config.js', '*.config.ts'],
        extends: [ts.configs.disableTypeChecked]
    }
);
