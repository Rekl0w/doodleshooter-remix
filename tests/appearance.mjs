import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, args: ['--enable-unsafe-swiftshader'] });
let count = 0;
const check = (name, ok) => { assert.ok(ok, name); console.log('PASS ' + name); count++; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8911');
  await page.waitForFunction(() => !!window.__game);
  const keys = await page.locator('.mapbtn').evaluateAll(buttons => buttons.map(b => b.dataset.map));
  for (const key of keys) {
    let physics;
    const captures = [];
    for (const mode of ['solid', 'notebook']) {
      await page.locator(`[data-map="${key}"]`).click();
      check(`${key}/${mode}: style chooser follows selected map`, await page.locator('#appearance').getAttribute('data-appearance-map') === key);
      await page.locator(`input[name="appearance"][value="${mode}"]`).check();
      check(`${key}/${mode}: choosing style keeps the menu open`, await page.evaluate(() => __game.game.state === 'start'));
      await page.locator('#playMapBtn').click();
      await page.waitForFunction(key => __game.level.key === key, key);
      await page.evaluate(() => { const g = __game; g.game.state = 'pause'; g.enemies.clear(); g.game.queue = []; g.hud.hideScreen(); });
      const actual = await page.evaluate(() => ({ solid: __game.ctx.renderer.post.uniforms.uSolid.value, boxes: JSON.stringify(__game.world.boxes.map(b => [b.min, b.max])) }));
      check(`${key}/${mode}: selected rendering applies`, actual.solid === (mode === 'solid' ? 1 : 0));
      if (physics) check(`${key}: both appearances have identical collisions`, physics === actual.boxes);
      physics = actual.boxes;
      if (['forest', 'dust2', 'skyline'].includes(key)) {
        await page.evaluate(() => { const g = __game, c = g.ctx.camera; document.querySelector('#hud').style.display = 'none'; for (const w of g.player.weapons) w.root.visible = false; c.position.set(0, g.level.key === 'skyline' ? 90 : 45, 75); c.up.set(0,1,0); c.lookAt(0,0,0); c.updateMatrixWorld(); });
        await page.waitForTimeout(60);
        captures.push(await page.screenshot(process.env.QA_OUTPUT ? { path: resolve(process.env.QA_OUTPUT, `${key}-${mode}.png`) } : {}));
        await page.evaluate(() => document.querySelector('#hud').style.display = '');
      }
      await page.evaluate(() => { __game.game.state = 'play'; __game.game.menu = false; });
      await page.keyboard.press('Escape'); await page.locator('#menuBtn').click();
    }
    if (captures.length) check(`${key}: the two modes render different pixels`, !captures[0].equals(captures[1]));
  }
  await page.locator('[data-map="dust2"]').click();
  await page.reload(); await page.waitForFunction(() => !!window.__game);
  check('Dust notebook override survives reload', await page.locator('[value="notebook"]').isChecked() && await page.evaluate(() => __game.ctx.renderer.post.uniforms.uSolid.value === 0));
  await page.locator('[value="solid"]').check(); await page.locator('[data-map="forest"]').click();
  check('appearance preferences are saved separately for each map', await page.locator('[value="notebook"]').isChecked());
  check('both styles compile and render without runtime errors', errors.length === 0);
  console.log(`${count} map appearance checks passed.`);
} finally { await browser.close(); }
