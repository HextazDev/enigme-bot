const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.agents/**', '.claude/**'] },
  { ...js.configs.recommended, files: ['src/**/*.js', 'scripts/**/*.cjs', 'test/**/*.js', '*.js', '*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs', ecmaVersion: 2022 },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['test/fixtures/**/*.js'], rules: { 'no-unused-vars': 'off' } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['src/**/*.ts', '*.ts'] })),
  { files: ['src/**/*.ts', '*.ts'], rules: { '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
];
