// @ts-check
// Present-card reproduction (#450): the files a `present` call hands over should show as a card
// (data-testid="message-deliverables"). On main the card reads only the flat output.files; if the
// tool's result carries them in output.details.files (PresentDetails), no card shows. This run
// proves which shape the harness sends and whether the card appears. Screenshots + DB row dump.
// Run:
//   MU_ROOT="C:/Program Files/mu/resources/harness/mu-agent" \
//   MU_BACKEND_BIN="C:/Program Files/mu/resources/bundled-backend/win32-x64/aioncore.exe" \
//   MU_E2E_ROOT=E:/mu/tmp/present-repro npx playwright test --config tests/e2e/mu-conversation/present-repro.config.mjs
import { _electron as electron, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp, quitApp } from './app.mjs';
import { startFakeModel } from './fakeModel.mjs';
import { createProfile } from './profile.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROVIDER_NAME = 'E2E Fake';
const run = { fake: undefined, profile: undefined, state: undefined };
const page = () => {
  if (!run.state) throw new Error('the app is not running');
  return run.state.page;
};
const shotDir = () => {
  const dir = join(run.profile.paths.root, 'shots');
  mkdirSync(dir, { recursive: true });
  return dir;
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  run.fake = await startFakeModel();
  run.profile = createProfile({ desktopRoot, root: process.env.MU_E2E_ROOT });
  run.profile.env.MU_NATIVE_HOST = '0';
  run.state = await launchApp({ desktopRoot, profile: run.profile, run: 1, electron });
  await run.state.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, run.profile.paths.project);
});

test.afterAll(async () => {
  if (process.env.MU_E2E_KEEP_OPEN) return; // leave the window for hands-on clicking
  if (run.state) await quitApp(run.state).catch(() => {});
  await run.fake?.close();
});

test('a present call shows its card (the #450 question)', async () => {
  const p = page();

  await expect(p.getByTestId('mu-welcome')).toBeVisible({ timeout: 60_000 });
  await p.getByText('跳过引导', { exact: true }).click();
  await p.waitForURL(/#\/guid/);

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

  await p.getByTestId('workspace-selector-btn').click();
  const other = p.getByText('选择其他目录', { exact: true });
  if (await other.isVisible().catch(() => false)) await other.click();
  await expect(p.getByText('project', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // The first message goes through the guide's input, which also starts the conversation.
  const filePath = join(run.profile.paths.project, 'notes', 'present-me.txt').replaceAll('\\', '/');
  const guide = p.getByTestId('guid-input');
  await guide.click();
  await guide.fill('E2E:WRITE notes/present-me.txt');
  await guide.press('Enter');
  await p.waitForURL(/#\/conversation\//, { timeout: 60_000 });

  const waitTurn = async (marker) => {
    await expect(p.locator('[data-testid="message-text-left"] .markdown-shadow-body').filter({ hasText: marker }).first())
      .toBeVisible({ timeout: 90_000 });
    await expect(p.getByTestId('sendbox-stop-btn')).toHaveCount(0, { timeout: 30_000 });
  };
  await waitTurn('WRITE-DONE');

  const send = async (text) => {
    const box = p.getByTestId('sendbox-input');
    await box.click();
    await box.fill(text);
    await box.press('Enter');
  };
  await send(`E2E:PRESENT ${filePath}`);
  await waitTurn('PRESENT-SAW');

  const cardCount = await p.getByTestId('message-deliverables').count();
  const fileRows = await p.getByTestId('message-deliverables-file').count();
  await p.screenshot({ path: join(shotDir(), 'present.png') });
  console.log(`[present-repro] deliverables card=${cardCount} fileRows=${fileRows}`);
  // No assertion on the count: the point is to observe. The DB row tells the payload's shape.
  if (process.env.MU_E2E_KEEP_OPEN) {
    console.log(`[present-repro] window stays open for 15 min — click the deliverables card (profile ${run.profile.paths.root})`);
    await p.waitForTimeout(15 * 60_000);
  }
});
