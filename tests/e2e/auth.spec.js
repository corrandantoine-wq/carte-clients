// Connexion, inscription et contrôle d'accès.
const { test, expect, seed, login } = require('../support/fixtures');

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

test('pas d’inscription libre : aucun moyen de créer un compte', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.getByText('Créer un compte')).toHaveCount(0);
  await expect(page.locator('[data-mode=signup], #authTabs')).toHaveCount(0);
  await expect(page.locator('#inviteOnly')).toContainText('sur invitation uniquement');
  expect(await page.evaluate(() => document.documentElement.outerHTML.includes('signUp'))).toBe(false);
});

test('arrivée par une invitation : choix du mot de passe puis accès à l’appli', async ({ page }) => {
  await seed(page, { inviteEmail: 'claire@soc.fr', members: [{ email: 'claire@soc.fr', role: 'user' }] });
  await page.goto('/index.html#access_token=x&type=invite');
  await expect(page.locator('#authLead')).toHaveText('Bienvenue ! Choisissez le mot de passe de votre compte.');
  await expect(page.locator('#authForm [name=email]')).toBeHidden();
  await page.fill('#authForm [name=password]', 'nouveau123');
  await page.fill('#authForm [name=password2]', 'different');
  await page.click('#authSubmit');
  await expect(page.locator('#authMsg')).toHaveText('Les deux mots de passe ne correspondent pas.');
  await page.fill('#authForm [name=password2]', 'nouveau123');
  await page.click('#authSubmit');
  await expect(page.locator('#auth')).toBeHidden();
  expect(await page.evaluate(() => window.__db.users.find(u => u.email === 'claire@soc.fr').password)).toBe('nouveau123');
});

test('lien d’invitation expiré : message clair', async ({ page }) => {
  await page.goto('/index.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expect(page.locator('#authMsg')).toContainText('Ce lien a expiré');
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
