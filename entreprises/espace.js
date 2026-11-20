// Espace d'une entreprise cliente : la même appli que la version principale, reliée à la base
// Supabase de cette entreprise (un projet Supabase par entreprise, sans lien entre les données).
// Chaque dossier entreprises/<nom>/ contient un index.html qui définit window.ESPACE puis charge ce fichier.
(async () => {
  const e = window.ESPACE || {};
  if (!e.supabaseUrl || !e.supabaseAnonKey) { document.body.textContent = 'Espace mal configuré.'; return; }
  let html = await (await fetch('../../index.html', { cache: 'no-cache' })).text();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  html = html
    .replace('<head>', '<head><base href="../../">')
    .replace('<link rel="manifest" href="manifest.webmanifest">', `<link rel="manifest" href="${esc(location.pathname.replace(/[^/]*$/, ''))}manifest.webmanifest">`)
    .replace('<script src="config.js"></script>', `<script>window.CARTE_CLIENTS_CONFIG = ${JSON.stringify({ supabaseUrl: e.supabaseUrl, supabaseAnonKey: e.supabaseAnonKey, entreprise: e.entreprise || '' }).replace(/</g, '\\u003c')};<\/script>`);
  if (!html.includes('window.CARTE_CLIENTS_CONFIG = {"supabaseUrl"')) { document.body.textContent = 'Espace indisponible.'; return; } // jamais la base d'une autre entreprise
  document.open(); document.write(html); document.close();
})();
