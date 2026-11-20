// Démo automatique : rejoue le script de la vidéo (1 minute) avec un doigt simulé.
// Ouvrir /demo/#auto, lancer l'enregistrement de l'écran, puis toucher « Lancer la démo ».
(() => {
  const $ = s => document.querySelector(s);
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
    // Scène 1 (0 – 6 s) : la carte, sans rien toucher.
    await sleep(5500);
    // Scène 2 (6 – 16 s) : rayon 25 km, la liste avec « vu il y a ».
    await choose('#radiusSel', '25', 1500);
    hideFinger();
    await scrollList(260); await sleep(1500); await scrollList(-260); await sleep(1200);
    // Scène 3 (16 – 32 s) : la tournée du mardi, optimisée.
    await tap('#menuBtn', 900);
    await tap('[data-action=tour]', 1000);
    await tap('#toursBtn', 1100);
    await tap('#toursSaved li[data-t]', 2200);
    hideFinger(); await sleep(1500);
    await tap('[data-tour=optim]', 3500);
    hideFinger(); await sleep(1500);
    // Scène 4 (32 – 50 s) : démarrer, compte rendu avec enregistrement.
    await tap('[data-tour=start]', 1200);
    await tap('[data-tour=cr]', 1800);
    await tap('#recConsent', 800);
    await tap('#recStart', 600);
    hideFinger(); await sleep(3200);
    await tap('#recStop', 1000);
    await tap(byText('#crForm .seg span', 'Commande passée'), 700);
    await type('#crNotes', '12 cartons, livraison mardi');
    await tap('#crSave', 1800);
    // Scène 5 (50 – 55 s) : étape suivante.
    await tap('[data-tour=next]', 2500);
    hideFinger(); await sleep(1500);
    // Fin (55 – 60 s).
    const end = document.createElement('div'); end.className = 'auto-end';
    end.innerHTML = '<div><b>Carte Clients</b><span>Essai gratuit 30 jours</span></div>';
    document.body.appendChild(end); await sleep(50); end.style.opacity = 1;
  }

  // Écran de départ : le temps de lancer l'enregistrement de l'écran.
  (async () => {
    await waitFor(() => $('#auth')?.hidden && $('#list li[data-id]'), 20000);
    const cover = document.createElement('div'); cover.className = 'auto-cover';
    cover.innerHTML = '<div>Démo automatique prête<small>1. Lancez l’enregistrement de l’écran.<br>2. Touchez le bouton, puis ne touchez plus rien pendant 1 minute.</small><button type="button">▶ Lancer la démo</button></div>';
    document.body.appendChild(cover);
    cover.querySelector('button').addEventListener('click', async () => {
      for (const n of [3, 2, 1]) { cover.innerHTML = `<div class="auto-count">${n}</div>`; await sleep(1000); }
      cover.remove();
      try { await play(); } catch (e) { hideFinger(); console.warn('Démo automatique interrompue :', e.message); }
    }, { once: true });
  })();
})();
