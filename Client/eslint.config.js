import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // vendor/ holds the prebuilt @common/client bundle - generated output, linted
  // in its own repo before it is vendored here.
  globalIgnores(['dist', 'vendor']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // server/ is the standalone CommonJS mock API (its own package.json + deps, run only
    // via `npm run start:server`) - not part of the SPA build. Lint it with Node globals
    // and CommonJS source type, or `require`/`__dirname`/`process` all read as undefined.
    files: ['server/**/*.js'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
    rules: {
      // Vite Fast Refresh rules are meaningless for a Node server module.
      'react-refresh/only-export-components': 'off',
    },
  },
])
