// @ts-check
// #416: a native reply's markdown image with a relative path — renders after #418, collapsed into a broken image
// before it. Runs against whatever out/ holds; writes one screenshot of the transcript per run. The PNG is planted in
// the throwaway project by `prepare`, the reply embeds it by relative path only.
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeWorld } from './nativeWorld.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CARD = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAAaUlEQVR42u3QMQ0AAAgDsAmbfxWIwQE3R5MqaKblEAWCBAkSJEiQIEEIEiRIkCBBggQhSJAgQYIEECRKEIEGCBAkSJEiQIAQJEiRIkCBBghAkSJAgQYIECUKQIEGCBAkSJEgQggQJEvTPAsVS4dLklj4SAAAAAElFTkSuQmCC',
  'base64'
);

const { start, stop, page, reachSidebar, send, runEnds, shot, expectNoProblems } = createNativeWorld({
  desktopRoot,
  prepare: (profile) => {
    mkdirSync(profile.paths.project, { recursive: true });
    writeFileSync(join(profile.paths.project, 'card.png'), CARD);
  },
});

test.beforeAll(async () => {
  await start();
});

test.afterAll(async () => {
  await stop().catch(() => {});
});

test('a relative-path markdown image in a native reply', async () => {
  const p = page();
  await reachSidebar();
  await p.getByTestId('native-new').click();
  await expect(p.getByTestId('native-new-panel')).toBeVisible();
  await p.getByTestId('native-project').click();
  await p.waitForURL(/#\/conversation\/native\//, { timeout: 30_000 });

  await send('E2E:ECHO ![card](card.png)');
  await runEnds(/^settled$/);

  // The transcript's own verdict: an <img> whose load was resolved by the workspace, or the broken-image state.
  const imgs = p.locator('[data-testid="native-conversation"] img');
  const count = await imgs.count();
  const loaded = [];
  for (let i = 0; i < count; i++) {
    const ok = await imgs.nth(i).evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false);
    loaded.push(ok);
  }
  await shot('relative-image');
  console.log(`[image-repro] imgs=${count} loaded=${JSON.stringify(loaded)}`);
  expectNoProblems();
});
