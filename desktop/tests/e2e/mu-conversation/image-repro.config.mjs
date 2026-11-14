// The #416 image repro's own config. See image-repro.spec.mjs.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'image-repro.spec.mjs',
  timeout: 4 * 60_000,
  globalTimeout: 12 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'off' },
  outputDir: '../results/image-repro',
});
