// Affichage : téléphone tenu à l'horizontale, liste des collaborateurs avec de longues adresses.
const { devices } = require('@playwright/test');
const { test, expect, seed, login } = require('../support/fixtures');

const LONG = 'gregoire.dupont-martin@entreprise-exemple.fr';
// iPhone 13 à l'horizontale (sans changer de navigateur au milieu du fichier).
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['iPhone 13 landscape'];

test.describe('téléphone tenu à l’horizontale', () => {
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test('panneau à gauche, carte visible à droite', async ({ page }) => {
    await login(page);
    const sheet = await page.locator('#sheet').boundingBox();
    const vp = page.viewportSize();
    expect(sheet.x).toBeLessThan(40);                 // panneau à gauche
    expect(sheet.width).toBeLessThan(vp.width * 0.5); // la carte garde plus de la moitié de l'écran
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(vp.height); // panneau entièrement visible
    await expect(page.locator('#title')).toBeInViewport();
  });

  test('le menu défile jusqu’en bas et tous ses boutons sont accessibles', async ({ page }) => {
    await seed(page, { members: [{ email: LONG, role: 'user' }] });
    await login(page);
    await page.click('#menuBtn');
    const menu = await page.locator('#menu').boundingBox();
    expect(menu.y + menu.height).toBeLessThanOrEqual(page.viewportSize().height); // le menu tient dans l'écran
    await page.locator('[data-action=logout]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-action=logout]')).toBeInViewport();
    await page.click('[data-action=members]');                   // bouton du bas du menu, cliquable
    await expect(page.locator('#membersDialog')).toBeVisible();
    const dernier = page.locator(`#membersList li[data-email="${LONG}"] .t`);
    await dernier.scrollIntoViewIfNeeded();                       // la fenêtre défile jusqu'au dernier collaborateur
    await expect(dernier).toBeInViewport();
    await expect(page.locator('#membersDialog [data-close]')).toBeVisible(); // « Fermer » reste accessible
  });
});

test('collaborateurs : l’adresse e-mail complète n’est jamais cachée par le sélecteur', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); // petit téléphone
  await seed(page, { members: [{ email: LONG, role: 'user' }] });
  await login(page);
  await page.click('#userBtn');
  await page.click('[data-action=members]');
  for (const email of ['bob@soc.fr', LONG]) {
    const li = page.locator(`#membersList li[data-email="${email}"]`);
    const t = await li.locator('.t').boundingBox(), sel = await li.locator('select').boundingBox();
    const chevauche = !(t.x + t.width <= sel.x || sel.x + sel.width <= t.x || t.y + t.height <= sel.y || sel.y + sel.height <= t.y);
    expect(chevauche, `le sélecteur recouvre ${email}`).toBe(false);
    expect(await li.locator('.t').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${email} coupée`).toBe(true);
    await expect(li.locator('.t')).toContainText(email);
  }
});
