// Connexion, inscription et contrôle d'accès.
const { test, expect, login } = require('../support/fixtures');

test('affiche l’écran de connexion et rien d’autre', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('#list li[data-id]')).toHaveCount(0);
});

test('mauvais mot de passe : message clair en français', async ({ page }) => {
  await login(page, 'admin@soc.fr', 'mauvais-mot-de-passe', { expectApp: false });
  await expect(page.locator('#authMsg')).toHaveText('E-mail ou mot de passe incorrect.');
});

test('inscription : demande de confirmer l’adresse', async ({ page }) => {
  await page.goto('/index.html');
  await page.click('#authTabs [data-mode=signup]');
  await page.fill('#authForm [name=email]', 'claire@soc.fr');
  await page.fill('#authForm [name=password]', 'secret123');
  await page.fill('#authForm [name=password2]', 'autre123');
  await page.click('#authSubmit');
  await expect(page.locator('#authMsg')).toHaveText('Les deux mots de passe ne correspondent pas.');
  await page.fill('#authForm [name=password2]', 'secret123');
  await page.click('#authSubmit');
  await expect(page.locator('#authMsg')).toContainText('Cliquez sur le lien reçu par e-mail');
});

test('un compte non autorisé est bloqué', async ({ page }) => {
  await login(page, 'intrus@gmail.com', 'motdepasse1', { expectApp: false });
  await expect(page.locator('#authDenied')).toBeVisible();
  await expect(page.locator('#deniedEmail')).toHaveText('intrus@gmail.com');
});

test('administrateur : accès à l’appli et au menu d’administration', async ({ page }) => {
  await login(page);
  await expect(page.locator('#auth')).toBeHidden();
  await page.click('#userBtn');
  await expect(page.locator('#menuRole')).toHaveText('Administrateur');
  await expect(page.locator('.admin-only')).toBeVisible();
  await page.click('[data-action=logout]');
  await expect(page.locator('#auth')).toBeVisible();
});

test('collaborateur : pas de menu d’administration', async ({ page }) => {
  await login(page, 'bob@soc.fr');
  await page.click('#userBtn');
  await expect(page.locator('#menuRole')).toHaveText('Collaborateur');
  await expect(page.locator('.admin-only')).toBeHidden();
});
