// Enregistrement audio des rendez-vous, avec sauvegarde au fil de l'eau sur le téléphone.
// - Le son est enregistré par morceaux de 5 s, gardés dans la mémoire du téléphone (IndexedDB) :
//   si l'appli se ferme ou plante, l'enregistrement peut être récupéré.
// - L'écran reste allumé pendant l'enregistrement (le micro s'arrête si l'écran se verrouille).
// - Les enregistrements terminés attendent dans une file d'envoi tant que le réseau manque.

const DB_NAME = 'carte-clients-audio';
const KBPS = 32_000; // voix : ~14 Mo par heure

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('brouillons', { keyPath: 'id' }); // enregistrements en cours (récupération)
      r.result.createObjectStore('envois', { keyPath: 'visite_id' }); // enregistrements à envoyer
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode), s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => { db.close(); res(out instanceof IDBRequest ? out.result : undefined); };
    t.onerror = t.onabort = () => { db.close(); rej(t.error); };
  });
}
export const stock = {
  put: (store, v) => tx(store, 'readwrite', s => { s.put(v); }),
  get: (store, k) => tx(store, 'readonly', s => s.get(k)),
  all: (store) => tx(store, 'readonly', s => s.getAll()),
  del: (store, k) => tx(store, 'readwrite', s => { s.delete(k); }),
};

export const audioSupporte = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.indexedDB);

// Format accepté par le téléphone : mp4 (iPhone, et lisible partout), sinon webm.
export function formatAudio() {
  for (const [mime, ext] of [['audio/mp4', 'mp4'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/ogg;codecs=opus', 'ogg']]) {
    if (MediaRecorder.isTypeSupported?.(mime)) return { mime, ext };
  }
  return { mime: '', ext: 'webm' };
}

export const fmtChrono = s => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(r).padStart(2, '0');
};

export class Enregistreur {
  constructor({ clientId, consentement, onTick = () => {}, onEtat = () => {} }) {
    Object.assign(this, { clientId, consentement, onTick, onEtat });
    this.id = crypto.randomUUID();
    this.chunks = []; this.etat = 'arrete'; this.duree = 0; this.coupure = false;
  }
  async demarrer() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const { mime, ext } = formatAudio();
    this.mime = mime; this.ext = ext;
    this.rec = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: KBPS });
    this.mime = this.rec.mimeType || mime || 'audio/webm';
    this.rec.ondataavailable = e => { if (e.data?.size) { this.chunks.push(e.data); this.sauver(); } };
    // Micro coupé par le téléphone (écran verrouillé, appel entrant, autre appli…) : on le signale.
    for (const t of this.stream.getAudioTracks()) t.addEventListener('ended', () => { if (this.etat !== 'arrete') { this.coupure = true; this.onEtat('coupe'); } });
    this.rec.start(5000);
    this.etat = 'enregistre'; this.debut = Date.now(); this.base = 0;
    this.timer = setInterval(() => this.tick(), 500);
    this.verrouEcran();
    document.addEventListener('visibilitychange', this.vis = () => { if (!document.hidden) this.verrouEcran(); });
    this.onEtat('enregistre');
  }
  tick() { if (this.etat === 'enregistre') { this.duree = this.base + (Date.now() - this.debut) / 1000; this.onTick(this.duree); } }
  pause() {
    if (this.etat !== 'enregistre') return;
    this.rec.pause(); this.tick(); this.base = this.duree; this.etat = 'pause'; this.onEtat('pause');
  }
  reprendre() {
    if (this.etat !== 'pause') return;
    this.rec.resume(); this.debut = Date.now(); this.etat = 'enregistre'; this.onEtat('enregistre');
  }
  async arreter() {
    if (this.etat === 'arrete') return null;
    this.tick();
    const fini = new Promise(res => { this.rec.onstop = res; setTimeout(res, 3000); }); // filet : certains téléphones n'envoient pas « stop »
    try { this.rec.stop(); } catch { /* déjà arrêté par le téléphone */ }
    await fini;
    this.liberer();
    this.etat = 'arrete'; this.onEtat('arrete');
    const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] });
    return { blob, ext: this.ext, mime: blob.type, duree: Math.round(this.duree), id: this.id };
  }
  annuler() { try { this.rec?.stop(); } catch { /* rien */ } this.liberer(); this.etat = 'arrete'; stock.del('brouillons', this.id).catch(() => {}); }
  liberer() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach(t => t.stop());
    this.wake?.release?.().catch(() => {}); this.wake = null;
    if (this.vis) document.removeEventListener('visibilitychange', this.vis);
  }
  async verrouEcran() { try { if (!this.wake && navigator.wakeLock) { this.wake = await navigator.wakeLock.request('screen'); this.wake.addEventListener('release', () => { this.wake = null; }); } } catch { /* non disponible */ } }
  // Copie de sécurité dans le téléphone, à chaque morceau.
  sauver() {
    stock.put('brouillons', { id: this.id, client_id: this.clientId, consentement: this.consentement, debut: this.debutIso ??= new Date().toISOString(),
      duree: Math.round(this.duree), mime: this.mime, ext: this.ext, chunks: this.chunks }).catch(() => {});
  }
}

// Enregistrements interrompus (appli fermée pendant l'enregistrement) pour un client.
export async function brouillons(clientId) {
  try { return (await stock.all('brouillons')).filter(b => b.client_id === clientId && b.chunks?.length); } catch { return []; }
}
