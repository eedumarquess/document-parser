import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const SHARED_IGNORES = [
  '**/dist/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/*.d.ts',
  '**/*.map'
];

const NODE_SCRIPT_GLOBALS = {
  __dirname: 'readonly',
  console: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly'
};

export default tseslint.config(
  {
    ignores: SHARED_IGNORES
  },
  {
    files: ['tooling/**/*.cjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: NODE_SCRIPT_GLOBALS
    }
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off'
    }
  }
);
