// Démonstration de Carte Clients : la vraie interface, avec une base FICTIVE en mémoire.
// Aucune connexion à la vraie base : le module Supabase est remplacé par une simulation.
(async () => {
  // Position simulée (Lyon Part-Dieu) : la démo ne montre jamais où se trouve la personne qui filme.
  const pos = () => ({ coords: { ...window.__DEMO__.position, accuracy: 12, heading: null, speed: null }, timestamp: Date.now() });
  const geo = { getCurrentPosition: ok => setTimeout(() => ok(pos()), 200), watchPosition: ok => { setTimeout(() => ok(pos()), 300); return 1; }, clearWatch() {} };
  try { Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true }); } catch {}

  // Mémoire du navigateur séparée de la vraie appli (même adresse de site), et remise à zéro
  // à chaque ouverture : chaque prise de vue repart du même état.
  try {
    const ls = window.localStorage, P = 'demo:' + Date.now() + ':'; // espace neuf à chaque ouverture
    for (let i = ls.length - 1; i >= 0; i--) { const k = ls.key(i); if (k && k.startsWith('demo:')) ls.removeItem(k); }
    // (Storage n'accepte pas de propriétés propres : on adapte ses méthodes, pour cette page seulement.)
    const proto = Storage.prototype, get = proto.getItem, set = proto.setItem, del = proto.removeItem;
    const key = (st, k) => (st === ls ? P + k : k);
    proto.getItem = function (k) { return get.call(this, key(this, k)); };
    proto.setItem = function (k, v) { return set.call(this, key(this, k), v); };
    proto.removeItem = function (k) { return del.call(this, key(this, k)); };
  } catch {}
  try {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.deleteDatabase('demo-carte-clients-audio');
    indexedDB.open = (name, v) => open('demo-' + name, v);
  } catch {}

  // Mode automatique (adresse terminée par #auto) : la démo se joue toute seule, pour la filmer.
  const auto = location.hash === '#auto' || new URLSearchParams(location.search).has('auto');
  if (auto) {
    // Micro simulé : pas de fenêtre d'autorisation pendant le tournage (le son n'est pas utile à la vidéo).
    try {
      // Le son est préparé au toucher de « Lancer la démo » (l'iPhone l'exige) : voir demo/auto.js.
      navigator.mediaDevices.getUserMedia = async () => {
        if (!window.__autoAudio) window.__autoAudio = new AudioContext();
        const ctx = window.__autoAudio, dest = ctx.createMediaStreamDestination(), osc = ctx.createOscillator(), g = ctx.createGain();
        g.gain.value = 0.0001; osc.connect(g); g.connect(dest); osc.start();
        return dest.stream;
      };
    } catch {}
  }

  let html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  html = html
    .replace('<head>', '<head><base href="../">')
    // Icône d'écran d'accueil propre à la démo (sinon elle ouvrirait la vraie appli).
    .replace('href="manifest.webmanifest"', 'href="demo/demo.webmanifest"')
    .replace('<meta name="apple-mobile-web-app-capable"', '<meta name="apple-mobile-web-app-title" content="Démo Clients"><meta name="apple-mobile-web-app-capable"')
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
      if (auto) { const sc = document.createElement('script'); sc.src = 'demo/auto.js?v=' + Date.now(); document.body.appendChild(sc); }
    }, 700);
  }, 200);
})();
