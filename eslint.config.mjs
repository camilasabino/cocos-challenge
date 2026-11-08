// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['eslint.config.mjs', 'dist/', 'coverage/', 'node_modules/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // Dependency boundaries. TypeORM belongs to repositories and persistence
  // adapters; application services depend on application-owned ports.
  {
    files: ['src/**/*.service.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['typeorm', '@nestjs/typeorm', 'pg'],
              message:
                'Application services must not depend on the ORM or driver; use a repository or port.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/trading/orders/**/*.ts', 'src/trading/portfolio/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['typeorm', '@nestjs/typeorm', 'pg'],
              message:
                'Use cases must not depend on the ORM or driver; go through their port.',
            },
            {
              group: ['**/persistence/**', '**/*.entity', '**/*.repository'],
              message:
                'Use cases must not depend on persistence code; go through their port.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/trading/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['typeorm', 'pg', '@nestjs/*'],
              message:
                'Domain code is pure: no framework or persistence imports.',
            },
            {
              group: [
                '**/persistence/**',
                '**/orders/**',
                '**/portfolio/**',
                '**/*.entity',
                '**/*.repository',
              ],
              message:
                'Domain code must not depend on use cases or persistence.',
            },
          ],
        },
      ],
    },
  },
);
