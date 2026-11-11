'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

// Test het echte publicatiepakket onder een subpad, zoals op GitHub Pages.
const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:8781/_site/';
const output = path.join(root, 'gebruikersroute-testresultaten');
const recipe = JSON.parse(fs.readFileSync(path.join(root, '_site/recepten.json'), 'utf8'))
  .find(item => item.id === 'klassieke-saucijzenbroodjes');
const server = spawn('python3', ['-m', 'http.server', '8781', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
fs.mkdirSync(output, { recursive: true });
let browser, page;
const results = [];

async function ready() {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url, { method: 'HEAD' })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Het publicatiepakket is niet bereikbaar.');
}

(async () => {
  try {
    await ready();
    browser = await chromium.launch(process.env.TEST_CHROMIUM_PATH ? { executablePath: process.env.TEST_CHROMIUM_PATH } : {});
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam', serviceWorkers: 'block', reducedMotion: 'reduce' });
      // Geen productieaccount of externe dienst nodig voor deze lokale gebruikersroute.
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
        ? route.continue() : route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await context.route('**/cloud-config.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.COOKBOOK_CLOUD_CONFIG={active:false};' }));
      page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.goto(url);
      await page.locator('#search').fill('saucijzen');
      await page.locator(`#cards a[href="#recept/${recipe.id}"]`).click();
      await page.locator('#plus').click();
      await page.locator('#plus').click();
      assert.equal(await page.locator('.servings strong').innerText(), '4');
      assert.match(await page.locator('#recipeIngredients').innerText(), /8 plakjes/);
      await page.locator('#addBasket').click();
      await page.locator('#goBasket').click();
      const pastry = page.locator('.basket-product-row').filter({ hasText: 'Roomboterbladerdeeg' });
      assert.match(await pastry.innerText(), /8 plakjes/);
      await pastry.locator('input[type="checkbox"]').check();
      await page.reload();
      assert.equal(await pastry.locator('input[type="checkbox"]').isChecked(), true);
      assert.match(await page.locator('#basketProgress').innerText(), /^1 van /);

      await page.locator('#recipesNav').click();
      await page.locator('#search').fill('saucijzen');
      await page.locator(`#cards a[href="#recept/${recipe.id}"]`).click();
      // Open het recept opnieuw en stel de te koken hoeveelheid in.
      await page.locator('#plus').click();
      await page.locator('#plus').click();
      assert.equal(await page.locator('.servings strong').innerText(), '4');
      await page.locator('#startCooking').click();
      assert.match(await page.locator('.cook-step-body').innerText(), /8 plakjes/);
      for (let step = 0; step < recipe.steps.length; step++) await page.locator('#cookNext').click();
      await page.locator('[data-finish-star="4"]').click();
      await page.locator('#finishFeedback').fill('Test: krokant en goed op smaak.');
      await page.locator('#finishSave').click();
      await page.reload();
      assert.equal(await page.locator('#recipeRating').inputValue(), '4');
      assert.equal(await page.locator('#feedbackText').inputValue(), 'Test: krokant en goed op smaak.');
      assert.match(await page.locator('#cookDateLabel').innerText(), /Laatst gekookt:/);

      await page.getByRole('link', { name: 'Registreer maaltijd', exact: true }).click();
      await page.locator('#recipeSelect option').filter({ hasText: 'Saucijzenbroodjes' }).first().waitFor({ state: 'attached' });
      assert.match(await page.locator('#recipeSelect option:checked').textContent(), /Saucijzenbroodjes/);
      // Vier gekookte porties zijn niet automatisch vier gegeten porties.
      assert.equal(await page.locator('#recipeQty').inputValue(), '1');
      await page.locator('#recipeQty').fill('0.5');
      await page.locator('#addRecipe').click();
      await page.reload();
      assert.equal(await page.locator('#entries > li').count(), 1);
      assert.match(await page.locator('#entries .entry-title').innerText(), /Saucijzenbroodjes.*0,5 portie/);
      const calories = Math.round(recipe.nutrition.kcal * 0.5).toLocaleString('nl-NL');
      assert.equal(await page.locator('#entries .entry-kcal').innerText(), `${calories} kcal`);
      assert.match(await page.locator('#calories').innerText(), new RegExp(`^${calories} `));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `dagboek-${width}.png`), fullPage: true });
      results.push({ width, passed: true, journey: 'Zoeken → porties → boodschappen → kookervaring → halve portie registreren' });
      console.log(`GESLAAGD ${width}px: volledige gebruikersroute met opgeslagen boodschappen, kookervaring en maaltijd.`);
      await context.close();
      page = null;
    }
  } catch (error) {
    results.push({ passed: false, error: error.message });
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'fout.png'), fullPage: true }).catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'resultaten.json'), JSON.stringify(results, null, 2));
    if (browser) await browser.close();
    server.kill();
  }
})();
