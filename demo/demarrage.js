// Démonstration de Carte Clients : la vraie interface, avec une base FICTIVE en mémoire.
// Aucune connexion à la vraie base : le module Supabase est remplacé par une simulation.
(async () => {
  // Position simulée (Lyon Part-Dieu) : la démo ne montre jamais où se trouve la personne qui filme.
  const pos = () => ({ coords: { ...window.__DEMO__.position, accuracy: 12, heading: null, speed: null }, timestamp: Date.now() });
  const geo = { getCurrentPosition: ok => setTimeout(() => ok(pos()), 200), watchPosition: ok => { setTimeout(() => ok(pos()), 300); return 1; }, clearWatch() {} };
  try { Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true }); } catch {}

  let html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  html = html
    .replace('<head>', '<head><base href="../">')
    .replace(/<script src="https:\/\/[^"]*supabase-js[^"]*"><\/script>/, '<script src="tests/support/mock-supabase.js"></script>')
    .replace('<script src="config.js"></script>', `<script>window.CARTE_CLIENTS_CONFIG = { supabaseUrl: 'https://demo.invalid', supabaseAnonKey: 'demo', demo: true };<\/script>
      <style>.demo-badge{position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom) + 8px);z-index:3000;background:#7c3aed;color:#fff;font:600 12px system-ui;padding:6px 10px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none}
      @media (max-width:899px){.demo-badge{bottom:auto;top:calc(env(safe-area-inset-top) + 74px)}}</style>`)
    .replace('<body>', '<body><div class="demo-badge">Démo · données fictives</div>');
  if (!/mock-supabase/.test(html)) { document.body.textContent = 'Démonstration indisponible.'; return; } // sécurité : jamais la vraie base
  document.open(); document.write(html); document.close();

  // Connexion automatique au compte de démonstration.
  const t0 = Date.now();
  const tick = setInterval(() => {
    const f = document.querySelector('#authForm');
    if (Date.now() - t0 > 15000) return clearInterval(tick);
    if (!f || !window.__db || !window.L || document.querySelector('#auth')?.hidden) return;
    clearInterval(tick);
    setTimeout(() => {
      f.querySelector('[name=email]').value = window.__DEMO__.email;
      f.querySelector('[name=password]').value = window.__DEMO__.password;
      document.querySelector('#authSubmit').click();
    }, 700);
  }, 200);
})();
