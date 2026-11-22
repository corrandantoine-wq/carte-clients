// Démo automatique : rejoue le script de la vidéo (1 minute) avec un doigt simulé.
// Ouvrir /demo/#auto, lancer l'enregistrement de l'écran, puis toucher « Lancer la démo ».
(() => {
  const $ = s => document.querySelector(s);
  // Micro simulé, installé ici (dans la page finale) : sur iPhone, celui posé avant le chargement
  // de l'appli est perdu, d'où la fenêtre « souhaite accéder au micro ». Le son n'est pas utile à la vidéo.
  const fauxMicro = async () => {
    if (!window.__autoAudio) window.__autoAudio = new AudioContext();
    const ctx = window.__autoAudio, dest = ctx.createMediaStreamDestination(), osc = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0.0001; osc.connect(g); g.connect(dest); osc.start();
    return dest.stream;
  };
  try { MediaDevices.prototype.getUserMedia = fauxMicro; } catch {}
  try { Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: fauxMicro, configurable: true, writable: true }); } catch {}
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const css = document.createElement('style');
  css.textContent = `
    .auto-finger{position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.55);
      border:3px solid rgba(21,35,63,.55);box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:5000;pointer-events:none;opacity:0;
      transition:transform .55s cubic-bezier(.4,0,.2,1),opacity .25s}
    .auto-finger.press{animation:autopress .32s ease}
    @keyframes autopress{50%{scale:.72;background:rgba(228,87,46,.45)}}
    .auto-cover{position:fixed;inset:0;z-index:6000;display:grid;place-items:center;background:rgba(15,22,38,.92);color:#fff;font:600 18px system-ui;text-align:center;padding:24px}
    .auto-cover button{margin-top:22px;font:700 18px system-ui;padding:16px 26px;border-radius:16px;border:0;background:#e4572e;color:#fff}
    .auto-cover small{display:block;margin-top:14px;font-weight:400;font-size:14px;opacity:.8;max-width:30ch}
    .auto-count{font:800 96px system-ui}
    .auto-end{position:fixed;inset:0;z-index:6000;display:grid;place-items:center;background:#15233f;color:#fff;text-align:center;opacity:0;transition:opacity .6s}
    .auto-end b{display:block;font:800 40px system-ui;margin-bottom:10px} .auto-end span{font:500 20px system-ui;opacity:.85}`;
  document.head.appendChild(css);
  const finger = document.createElement('div'); finger.className = 'auto-finger'; document.body.appendChild(finger);
  const finger2 = document.createElement('div'); finger2.className = 'auto-finger'; document.body.appendChild(finger2);
  const place = (f, x, y, ms = 0) => { f.style.transition = ms ? `transform ${ms}ms linear, opacity .25s` : 'opacity .25s'; f.style.transform = `translate(${x}px, ${y}px)`; };
  const restore = () => { finger.style.transition = ''; };
  // Glisser la carte avec le doigt : le doigt et la carte bougent ensemble.
  async function drag(dx, dy, ms = 1100) {
    const m = window.__map; if (!m) return;
    const x = innerWidth / 2 - dx / 2, y = innerHeight * 0.3 - dy / 2;
    place(finger, x, y); await sleep(30); finger.style.opacity = 1; await sleep(300);
    place(finger, x + dx, y + dy, ms);
    m.panBy([-dx, -dy], { duration: ms / 1000, easeLinearity: 1 });
    await sleep(ms + 150); finger.style.opacity = 0; await sleep(300); restore();
  }
  // Pincer pour dézoomer (ou écarter pour zoomer) : deux doigts.
  async function pinch(zoom, ms = 1300) {
    const m = window.__map; if (!m) return;
    const cx = innerWidth / 2, cy = innerHeight * 0.3, a = zoom < 0 ? 90 : 25, b = zoom < 0 ? 25 : 90;
    place(finger, cx - a, cy - a * 0.6); place(finger2, cx + a, cy + a * 0.6);
    await sleep(30); finger.style.opacity = finger2.style.opacity = 1; await sleep(300);
    place(finger, cx - b, cy - b * 0.6, ms); place(finger2, cx + b, cy + b * 0.6, ms);
    const p = m.containerPointToLatLng([cx, cy]);
    m.flyTo(p, m.getZoom() + zoom, { duration: ms / 1000 });
    await sleep(ms + 200); finger.style.opacity = finger2.style.opacity = 0; await sleep(300); restore(); finger2.style.transition = '';
  }

  async function waitFor(sel, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const el = typeof sel === 'function' ? sel() : $(sel); if (el && el.getClientRects().length) return el; await sleep(100); }
    throw new Error('Élément introuvable : ' + sel);
  }
  async function point(el) {
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    await sleep(350);
    const r = el.getBoundingClientRect();
    finger.style.opacity = 1;
    finger.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
    await sleep(600);
  }
  async function tap(sel, pause = 700) {
    const el = await waitFor(sel);
    await point(el);
    finger.classList.remove('press'); void finger.offsetWidth; finger.classList.add('press');
    await sleep(180);
    el.click();
    await sleep(pause);
  }
  async function choose(sel, value, pause = 900) {
    const el = await waitFor(sel);
    await point(el);
    finger.classList.remove('press'); void finger.offsetWidth; finger.classList.add('press');
    await sleep(250);
    el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(pause);
  }
  async function type(sel, text) {
    const el = await waitFor(sel);
    await point(el); el.focus();
    for (const ch of text) { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(55); }
    el.blur(); await sleep(400);
  }
  async function scrollList(dy) {
    const l = $('#list'); if (!l) return;
    l.scrollBy({ top: dy, behavior: 'smooth' }); await sleep(1200);
  }
  const byText = (sel, text) => () => [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text));
  const hideFinger = () => { finger.style.opacity = 0; };

  async function play() {
    // Scène 1 (0 – 15 s) : la carte, puis on la parcourt au doigt pour voir les clients autour.
    await sleep(2000);
    await pinch(1);              // zoomer : les clients se détachent un par un
    await sleep(800);
    await drag(-80, 35);         // glisser vers l'est
    await sleep(500);
    await drag(110, -60);        // puis vers l'ouest
    await sleep(500);
    await drag(-30, 25);         // retour au centre
    await sleep(400);
    await pinch(-1);             // dézoomer : vue d'ensemble autour de soi
    await sleep(700);
    // Scène 2 (15 – 21 s) : rayon 25 km, la liste avec « vu il y a ».
    await choose('#radiusSel', '25', 1000);
    hideFinger();
    await scrollList(240); await sleep(700); await scrollList(-240);
    // Scène 3 (21 – 30 s) : la tournée du mardi, optimisée.
    await tap('#menuBtn', 500);
    await tap('[data-action=tour]', 600);
    await tap('#toursBtn', 600);
    await tap('#toursSaved li[data-t]', 1200);
    await tap('[data-tour=optim]', 2000);
    // Scène 4 (30 – 47 s) : démarrer, compte rendu avec enregistrement.
    await tap('[data-tour=start]', 900);
    await tap('[data-tour=cr]', 1500);
    await tap('#recConsent', 700);
    await tap('#recStart', 500);
    hideFinger(); await sleep(3000);
    await tap('#recStop', 900);
    await tap(byText('#crForm .seg span', 'Commande passée'), 600);
    await type('#crNotes', '12 cartons, livraison mardi');
    await tap('#crSave', 1600);
    // Scène 5 (47 – 52 s) : étape suivante.
    await tap('[data-tour=next]', 2300);
    hideFinger(); await sleep(1000);
    // Fin.
    const end = document.createElement('div'); end.className = 'auto-end';
    end.innerHTML = '<div><b>Carte Clients</b><span>Essai gratuit 30 jours</span></div>';
    document.body.appendChild(end); await sleep(50); end.style.opacity = 1;
  }

  function alerte(txt) {
    const d = document.createElement('div'); d.className = 'auto-cover';
    d.innerHTML = '<div>' + txt.replace(/</g, '&lt;') + '<small>Fermez complètement la démo puis rouvrez-la.</small></div>';
    d.addEventListener('click', () => d.remove()); document.body.appendChild(d);
  }
  // Écran de départ : le temps de lancer l'enregistrement de l'écran.
  (async () => {
    try { await waitFor(() => $('#auth')?.hidden && $('#list li[data-id]'), 25000); }
    catch { alerte('La démo n’a pas fini de se charger.'); return; }
    const cover = document.createElement('div'); cover.className = 'auto-cover';
    cover.innerHTML = '<div>Démo automatique prête<small>1. Lancez l’enregistrement de l’écran.<br>2. Touchez le bouton, puis ne touchez plus rien pendant 1 minute.</small><button type="button">▶ Lancer la démo</button></div>';
    document.body.appendChild(cover);
    cover.querySelector('button').addEventListener('click', async () => {
      // Son simulé démarré pendant le vrai toucher : sinon l'iPhone le laisse en pause.
      try { window.__autoAudio = window.__autoAudio || new AudioContext(); window.__autoAudio.resume(); } catch {}
      for (const n of [3, 2, 1]) { cover.innerHTML = `<div class="auto-count">${n}</div>`; await sleep(1000); }
      cover.remove();
      try { await play(); } catch (e) { hideFinger(); alerte('La démo s’est arrêtée : ' + e.message); }
    }, { once: true });
  })();
})();
