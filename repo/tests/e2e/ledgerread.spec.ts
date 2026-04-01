import { expect, test } from '@playwright/test';

const login = async (
  page: import('@playwright/test').Page,
  path: string,
  username: string,
  password: string,
) => {
  await page.goto(path);
  await page.getByPlaceholder('Username').fill(username);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
};

const readOfflineStorageSnapshot = async (page: import('@playwright/test').Page) =>
  page.evaluate(async () => {
    const localStorageKeys = Object.keys(window.localStorage);
    const sessionStorageKeys = Object.keys(window.sessionStorage);

    const openDatabase = () =>
      new Promise<IDBDatabase | null>((resolve, reject) => {
        const request = window.indexedDB.open('ledgerread-offline');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => resolve(request.result);
      }).catch(() => null);

    const db = await openDatabase();
    if (!db) {
      return {
        localStorageKeys,
        sessionStorageKeys,
        indexedDbKeys: {},
      };
    }

    const readKeys = (storeName: string) =>
      new Promise<string[]>((resolve, reject) => {
        if (!db.objectStoreNames.contains(storeName)) {
          resolve([]);
          return;
        }

        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAllKeys();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result.map((value) => String(value)));
      });

    const indexedDbKeys = {
      profiles: await readKeys('profiles'),
      titles: await readKeys('titles'),
      keys: await readKeys('keys'),
    };

    db.close();

    return {
      localStorageKeys,
      sessionStorageKeys,
      indexedDbKeys,
    };
  });

test('customer reader preferences persist after save and reload', async ({ page }) => {
  await login(page, '/login', 'reader.ada', 'Reader!2026');
  await expect(page).toHaveURL(/\/app\/library$/);
  await page.getByRole('link', { name: 'Library' }).click();
  await page.locator('button:has-text("Quiet Harbor")').first().click();
  await expect(page).toHaveURL(/\/app\/reader\//);

  const fontSizeSlider = page.locator('input[type="range"]').first();
  const startingFontSize = Number(await fontSizeSlider.inputValue());
  const expectedFontSize = String(Math.min(startingFontSize + 4, 28));
  await fontSizeSlider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(fontSizeSlider).toHaveValue(expectedFontSize);
  await page.getByRole('button', { name: 'Save Preferences' }).click();
  await expect(page.getByText('Reading preferences saved to the local server.')).toBeVisible();

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, '/login', 'reader.ada', 'Reader!2026');
  await expect(page).toHaveURL(/\/app\/library$/);
  await page.locator('button:has-text("Quiet Harbor")').first().click();
  await expect(page).toHaveURL(/\/app\/reader\//);
  const persistedFontSizeSlider = page.locator('input[type="range"]').first();
  await expect(persistedFontSizeSlider).toHaveValue(expectedFontSize);
});

test('reader routes invalid titles into a retryable error state instead of hanging', async ({ page }) => {
  await login(page, '/login', 'reader.ada', 'Reader!2026');
  await expect(page).toHaveURL(/\/app\/library$/);
  await page.goto('/app/reader/not-a-real-title');
  await expect(page.getByText('Unable To Load Title')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('clerk checkout stays locked until review total completes', async ({ page }) => {
  await login(page, '/pos/login', 'clerk.emma', 'Clerk!2026');
  await expect(page).toHaveURL(/\/pos\/checkout$/);
  const finalizeButton = page.getByRole('button', { name: 'Finalize Checkout' });
  await expect(finalizeButton).toBeDisabled();

  await page.getByRole('button', { name: 'Add SKU' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Quantity for Quiet Harbor Hardcover' })).toBeVisible();
  await expect(finalizeButton).toBeDisabled();

  await page.getByRole('button', { name: 'Review Total' }).click();
  await expect(finalizeButton).toBeEnabled();
});

test('moderator can action a customer-created report from the queue', async ({ browser }) => {
  const customerPage = await browser.newPage();
  await login(customerPage, '/login', 'reader.ada', 'Reader!2026');
  await expect(customerPage).toHaveURL(/\/app\/library$/);
  await customerPage.getByRole('link', { name: 'Community' }).click();
  await customerPage.getByRole('button', { name: 'Report' }).first().click();
  await customerPage.locator('textarea').last().fill('Browser-level moderation proof note');
  await customerPage.getByRole('button', { name: 'Submit Report' }).click();
  await expect(customerPage.getByText('Report added to the local moderation queue.')).toBeVisible();
  await customerPage.getByRole('button', { name: 'Logout' }).click();
  await customerPage.close();

  const moderatorPage = await browser.newPage();
  await login(moderatorPage, '/mod/login', 'mod.noah', 'Moderator!2026');
  await expect(moderatorPage).toHaveURL(/\/mod\/queue$/);
  await expect(moderatorPage.getByText('Moderation Queue')).toBeVisible();
  await expect(moderatorPage.getByText('Browser-level moderation proof note')).toBeVisible();
  await moderatorPage.getByRole('button', { name: 'Hide' }).first().click();
  await expect(moderatorPage.getByText('Moderation action applied: hide.')).toBeVisible();
  await moderatorPage.close();
});

test('inventory managers can reach admin finance and audits while finance keeps its own workspace', async ({ browser }) => {
  const inventoryPage = await browser.newPage();
  await login(inventoryPage, '/admin/login', 'inventory.ivan', 'Inventory!2026');
  await expect(inventoryPage).toHaveURL(/\/admin\/overview$/);
  await inventoryPage.goto('/admin/finance');
  await expect(inventoryPage).toHaveURL(/\/admin\/finance$/);
  await expect(inventoryPage.getByRole('link', { name: 'Finance' })).toBeVisible();
  await expect(inventoryPage.getByRole('link', { name: 'Audits' })).toBeVisible();
  await expect(inventoryPage.getByText('Settlement Status', { exact: true })).toBeVisible();
  await expect(inventoryPage.getByText('Discrepancy Review')).toBeVisible();
  await expect(inventoryPage.getByText('Import Manifest')).toBeVisible();
  await expect(inventoryPage.getByRole('button', { name: 'Import & Compare' })).toBeVisible();
  await inventoryPage.goto('/admin/audits');
  await expect(inventoryPage).toHaveURL(/\/admin\/audits$/);
  await expect(inventoryPage.locator('article').first()).toBeVisible();
  await inventoryPage.close();

  const financePage = await browser.newPage();
  await login(financePage, '/finance/login', 'finance.zoe', 'Finance!2026');
  await expect(financePage).toHaveURL(/\/finance\/settlements$/);
  await expect(financePage.getByRole('link', { name: 'Settlements' })).toBeVisible();
  await expect(financePage.getByText('Settlement Status', { exact: true })).toBeVisible();
  await expect(financePage.getByText('Discrepancy Review')).toBeVisible();
  await expect(financePage.getByText('Settlement Intake')).toBeVisible();
  await expect(financePage.getByRole('button', { name: 'Import & Compare' })).toHaveCount(0);
  await financePage.close();
});

test('shared-browser user switching keeps reader cache and preferences isolated per account', async ({ page }) => {
  await login(page, '/login', 'reader.ada', 'Reader!2026');
  await expect(page).toHaveURL(/\/app\/library$/);
  await page.locator('button:has-text("Quiet Harbor")').first().click();
  await expect(page).toHaveURL(/\/app\/reader\//);

  const adaFontSizeSlider = page.locator('input[type="range"]').first();
  const adaStartingFontSize = Number(await adaFontSizeSlider.inputValue());
  const adaExpectedFontSize = String(Math.min(adaStartingFontSize + 4, 28));
  await adaFontSizeSlider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(adaFontSizeSlider).toHaveValue(adaExpectedFontSize);
  await page.getByRole('button', { name: 'Save Preferences' }).click();
  await expect(page.getByText('Reading preferences saved to the local server.')).toBeVisible();

  const adaStorage = await readOfflineStorageSnapshot(page);
  const serializedAdaStorage = JSON.stringify(adaStorage);
  expect(serializedAdaStorage).not.toContain('reader.ada');
  expect(serializedAdaStorage).not.toContain('reader.mei');

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, '/login', 'reader.mei', 'Reader!2026');
  await expect(page).toHaveURL(/\/app\/library$/);
  await page.locator('button:has-text("Quiet Harbor")').first().click();
  await expect(page).toHaveURL(/\/app\/reader\//);

  const meiFontSizeSlider = page.locator('input[type="range"]').first();
  await expect(meiFontSizeSlider).toHaveValue('18');

  await page.goto('/app/profile');
  await expect(page.getByText('Warehouse Kiosk')).toBeVisible();
  await expect(page.getByText('Traditional Chinese')).toBeVisible();

  const meiStorage = await readOfflineStorageSnapshot(page);
  const serializedMeiStorage = JSON.stringify(meiStorage);
  expect(serializedMeiStorage).not.toContain('reader.ada');
  expect(serializedMeiStorage).not.toContain('reader.mei');
});
