// @ts-check
// Split-reply reproduction (mu issue candidate): one streaming reply from the backend, persisted as several rows,
// reloaded as history — does it render as one message or several? Screenshots both states to
// MU_E2E_ROOT/split-repro/. Run:
//   MU_BACKEND_BIN="C:/Program Files/mu/resources/bundled-backend/win32-x64/aioncore.exe" \
//   MU_E2E_ROOT=E:/mu/tmp/split-repro npx playwright test --config tests/e2e/mu-conversation/split-repro.config.mjs
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp, quitApp } from './app.mjs';
import { startFakeModel } from './fakeModel.mjs';
import { createProfile } from './profile.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const FENCE_DONE = '图就这些，完成。';
const PROVIDER_NAME = 'E2E Fake';
const run = { fake: undefined, profile: undefined, state: undefined };
const page = () => {
  if (!run.state) throw new Error('the app is not running');
  return run.state.page;
};
const replies = () => page().locator('[data-testid="message-text-left"]');
const shotDir = () => {
  const dir = join(run.profile.paths.root, 'shots');
  mkdirSync(dir, { recursive: true });
  return dir;
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  run.fake = await startFakeModel();
  run.profile = createProfile({ desktopRoot, root: process.env.MU_E2E_ROOT });
  // The backend's conversation, not the native host's: the split rows come from the backend's persistence.
  run.profile.env.MU_NATIVE_HOST = '0';
  run.state = await launchApp({ desktopRoot, profile: run.profile, run: 1, electron });
  await run.state.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, run.profile.paths.project);
});

test.afterAll(async () => {
  if (run.state) await quitApp(run.state).catch(() => {});
  await run.fake?.close();
});

test('one streamed reply, reloaded as history, stays one message', async () => {
  const p = page();

  // The first-run welcome: skip it, land on the guide.
  await expect(p.getByTestId('mu-welcome')).toBeVisible({ timeout: 60_000 });
  await p.getByText('跳过引导', { exact: true }).click();
  await p.waitForURL(/#\/guid/);

  // Add the fake model as an OpenAI-compatible endpoint (the conversation spec's steps).
  await p.getByTestId('sider-settings').click();
  await p.waitForURL(/#\/settings\/providers/);
  await p.getByTestId('mu-provider-add').click();
  const editor = p.getByTestId('mu-provider-editor');
  await editor.getByLabel('显示名称').fill(PROVIDER_NAME);
  await editor.getByLabel('接口地址（Base URL）').fill(run.fake?.baseUrl ?? '');
  await editor.getByLabel('API 密钥').fill('e2e-key-not-secret');
  await editor.getByText('测试连接', { exact: true }).click();
  await p.getByTestId('mu-model-offer-e2e-fake-model').click({ timeout: 20_000 });
  await p.getByRole('button', { name: '保存' }).click();
  await p.getByText('已保存', { exact: false }).first().waitFor({ timeout: 20_000 });
  await p.getByTestId('sider-settings').click();
  await p.waitForURL((url) => !url.hash.startsWith('#/settings'));
  await p.waitForURL(/#\/guid/);

  // Pick the project, send the fenced-block turn, wait for the turn to end.
  await p.getByTestId('workspace-selector-btn').click();
  const other = p.getByText('选择其他目录', { exact: true });
  if (await other.isVisible().catch(() => false)) await other.click();
  await expect(p.getByText('project', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  const box = p.getByTestId('guid-input');
  await box.click();
  await box.fill('E2E:SLOW 200 请慢慢说');
  await box.press('Enter');
  await p.waitForURL(/#\/conversation\//, { timeout: 60_000 });

  await expect(p.locator('[data-testid="message-text-left"] .markdown-shadow-body').filter({ hasText: 'SLOW-200' }).first())
    .toBeVisible({ timeout: 120_000 });
  await expect(p.getByTestId('sendbox-stop-btn')).toHaveCount(0, { timeout: 30_000 });

  const liveCount = await replies().count();
  await p.screenshot({ path: join(shotDir(), '1-live.png'), fullPage: false });

  // Reload: the conversation comes back from the backend's persisted rows.
  await p.reload({ waitUntil: 'domcontentloaded' });
  await expect(p.locator('[data-testid="message-text-left"] .markdown-shadow-body').filter({ hasText: 'SLOW-200' }).first())
    .toBeVisible({ timeout: 60_000 });
  const reloadedCount = await replies().count();
  await p.screenshot({ path: join(shotDir(), '2-reloaded.png'), fullPage: false });

  console.log(`[split-repro] bubbles live=${liveCount} reloaded=${reloadedCount}`);
  expect(reloadedCount, 'the same reply after reload').toBe(liveCount);
});
