// Tests de bout en bout de Carte Clients (base de données et services externes simulés).
const { defineConfig, devices } = require('@playwright/test');

const common = {
  baseURL: 'http://localhost:8765',
  serviceWorkers: 'block',
  geolocation: { latitude: 48.8600, longitude: 2.3400 }, // Paris
  permissions: ['geolocation'],
  locale: 'fr-FR',
  trace: 'off',
};

module.exports = defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  webServer: { command: 'python3 -m http.server 8765', url: 'http://localhost:8765/index.html', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', ...common } },
    { name: 'ordinateur', use: { viewport: { width: 1366, height: 820 }, browserName: 'chromium', ...common } },
  ],
});
