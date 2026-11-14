// The split-reply reproduction's own config: one file, one app, generous times. See split-repro.spec.mjs.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'split-repro.spec.mjs',
  timeout: 4 * 60_000,
  globalTimeout: 12 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off' },
  outputDir: '../results/split-repro',
});
