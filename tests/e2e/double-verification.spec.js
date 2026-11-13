// Double vérification obligatoire pour les administrateurs ; export réservé aux administrateurs.
const { test, expect, seed, login } = require('../support/fixtures');

test('administrateur : le code à 6 chiffres est demandé après le mot de passe', async ({ page }) => {
  await login(page, 'admin@soc.fr', 'motdepasse1', { expectApp: false });
  await expect(page.locator('#authMfa')).toBeVisible();
  await expect(page.locator('#mfaAsk')).toBeVisible();
  await expect(page.locator('#mfaEnroll')).toBeHidden();
  await page.fill('#mfaCode', '000000');
  await page.click('#mfaSubmit');
  await expect(page.locator('#mfaMsg')).toContainText('Code incorrect');
  await expect(page.locator('#auth')).toBeVisible(); // toujours bloqué
  await page.fill('#mfaCode', '123456');
  await page.click('#mfaSubmit');
  await expect(page.locator('#auth')).toBeHidden();
  await page.click('#userBtn');
  await expect(page.locator('#menuRole')).toHaveText('Administrateur');
});

test('nouvel administrateur : enregistrement de l’appli d’authentification (QR code) à la première connexion', async ({ page }) => {
  await seed(page, { users: [{ id: 'u-chef', email: 'chef@soc.fr', password: 'motdepasse1', confirmed: true }], members: [{ email: 'chef@soc.fr', role: 'admin' }] });
  await login(page, 'chef@soc.fr', 'motdepasse1', { expectApp: false });
  await expect(page.locator('#mfaEnroll')).toBeVisible();
  await expect(page.locator('#mfaQr img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(page.locator('#mfaSecret')).toHaveText('JBSWY3DPEHPK3PXP');
  await page.fill('#mfaCode', '123 456'); // code collé tel qu'affiché par Google Authenticator (avec une espace)
  await expect(page.locator('#mfaCode')).toHaveValue('123456');
  await page.click('#mfaSubmit');
  await expect(page.locator('#auth')).toBeHidden();
  expect(await page.evaluate(() => window.__db.users.find(u => u.email === 'chef@soc.fr').factors.map(f => f.status))).toEqual(['verified']);
  expect(await page.evaluate(() => window.__db.enrollments)).toBe(1); // un seul enregistrement, pas de doublon
});

test('administrateur : se déconnecter depuis l’écran du code', async ({ page }) => {
  await login(page, 'admin@soc.fr', 'motdepasse1', { expectApp: false });
  await page.click('#mfaLogout');
  await expect(page.locator('#authForm')).toBeVisible();
});

test('collaborateur : pas de code demandé, et pas d’export', async ({ page }) => {
  await login(page, 'bob@soc.fr');
  await page.click('#userBtn');
  await expect(page.locator('#menuRole')).toHaveText('Collaborateur');
  await expect(page.locator('[data-action=export]')).toBeHidden();
});

test('administrateur : l’export est disponible', async ({ page }) => {
  await login(page);
  await page.click('#userBtn');
  await expect(page.locator('[data-action=export]')).toBeVisible();
});
