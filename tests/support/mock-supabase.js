// Faux supabase-js en mémoire, pour tester l'interface sans serveur.
// Reproduit le sous-ensemble de l'API utilisé par app.js, avec les règles d'accès
// principales (favoris propres à chacun, collaborateurs autorisés).
// window.__SEED__ (défini avant le chargement) permet de pré-remplir la base.
(() => {
  const db = window.__db = {
    users: [{ id: 'u-admin', email: 'admin@soc.fr', password: 'motdepasse1', confirmed: true },
            { id: 'u-bob', email: 'bob@soc.fr', password: 'motdepasse1', confirmed: true },
            { id: 'u-intrus', email: 'intrus@gmail.com', password: 'motdepasse1', confirmed: true }],
    members: [{ email: 'admin@soc.fr', role: 'admin' }, { email: 'bob@soc.fr', role: 'user' }],
    clients: [], favorites: [], client_history: [],
    crm_fields: [{ property: 'name', label: 'Nom dans le CRM', position: 1 }, { property: 'lifecyclestage', label: 'Étape du cycle de vie', position: 2 }, { property: 'notes_last_contacted', label: 'Dernier contact', position: 3 }],
  };
  for (const [k, v] of Object.entries(window.__SEED__ || {})) db[k] = Array.isArray(db[k]) ? [...db[k], ...v] : v;
  let session = null; const listeners = [];
  const emit = (ev, s) => listeners.forEach(cb => cb(ev, s));
  const uid = () => session?.user.id;
  const isAdmin = () => db.members.some(m => m.email === session?.user.email && m.role === 'admin');
  // Reproduit le déclencheur d'historique de la base (003_historique_corbeille.sql).
  const FIELDS = ['nom', 'code_client', 'adresse', 'code_postal', 'ville', 'telephone', 'email', 'notes', 'hubspot_id'];
  let histId = 0;
  function log(action, row, changes = {}) {
    db.client_history.push({ id: ++histId, client_id: row.id, client_nom: row.nom, action, changes, user_id: uid(), user_email: session?.user.email, at: new Date(Date.now() + histId).toISOString() });
  }
  function logUpdate(before, after) {
    const changes = {};
    for (const k of FIELDS) if ((before[k] ?? null) !== (after[k] ?? null)) changes[k] = [before[k] ?? null, after[k] ?? null];
    const act = !before.deleted_at && after.deleted_at ? 'suppression' : before.deleted_at && !after.deleted_at ? 'restauration' : Object.keys(changes).length ? 'modification' : null;
    if (act) log(act, after, changes);
  }
  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ret = false; }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    insert(rows) { this.op = 'insert'; this.p = [].concat(rows); return this; }
    upsert(rows, o = {}) { this.op = 'upsert'; this.p = [].concat(rows); this.key = o.onConflict || 'email'; return this; }
    update(p) { this.op = 'update'; this.p = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(k, v) { this.f.push(r => r[k] === v); return this; }
    neq(k, v) { this.f.push(r => r[k] !== v); return this; }
    not(k, op, v) { this.f.push(r => r[k] != null); return this; }
    is(k, v) { this.f.push(r => (r[k] ?? null) === v); return this; }
    limit(n) { this.lim = n; return this; }
    order(k, o = {}) { this.ord = k; this.desc = o.ascending === false; return this; }
    range(a, b) { this.rg = [a, b]; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    rows() { let rows = db[this.t]; if (this.t === 'favorites') rows = rows.filter(r => r.user_id === uid()); return rows.filter(r => this.f.every(fn => fn(r))); }
    then(res, rej) {
      let out;
      if (this.op === 'select') {
        out = this.rows().map(r => ({ ...r }));
        if (this.ord) { out.sort((a, b) => String(a[this.ord]).localeCompare(String(b[this.ord]))); if (this.desc) out.reverse(); }
        if (this.lim) out = out.slice(0, this.lim);
        if (this.rg) out = out.slice(this.rg[0], this.rg[1] + 1);
      } else if (this.op === 'insert' || this.op === 'upsert') {
        out = this.p.map(r => {
          const row = { ...r };
          if (this.t === 'clients') Object.assign(row, { id: crypto.randomUUID(), created_by: uid(), hubspot_id: r.hubspot_id ?? null, deleted_at: r.deleted_at ?? null });
          if (this.t === 'favorites') row.user_id = uid();
          if (this.op === 'upsert') { const k = this.key; const ex = row[k] != null && db[this.t].find(x => x[k] === row[k]); if (ex) { const before = { ...ex }; Object.assign(ex, r); if (this.t === 'clients') logUpdate(before, ex); return { ...ex }; } }
          db[this.t].push(row); if (this.t === 'clients') log('création', row); return row;
        });
      } else if (this.op === 'update') {
        out = this.rows();
        if (this.t === 'clients' && this.p.deleted_at && out.some(r => !r.deleted_at && r.created_by !== uid() && !isAdmin())) {
          return Promise.resolve({ data: null, error: { message: 'Seul l\'auteur de la fiche ou un administrateur peut la supprimer.', code: '42501' } }).then(res, rej);
        }
        out.forEach(r => { const before = { ...r }; Object.assign(r, this.p); if (this.t === 'clients') logUpdate(before, r); });
        out = out.map(r => ({ ...r }));
      } else if (this.op === 'delete') {
        out = this.rows();
        if (this.t === 'clients') { if (!isAdmin()) out = []; out.forEach(r => log('suppression définitive', r)); } // suppression définitive : admin seulement
        db[this.t] = db[this.t].filter(r => !out.includes(r));
      }
      const data = this.one ? (out[0] ?? null) : out;
      return Promise.resolve({ data, error: null }).then(res, rej);
    }
  }
  const client = {
    from: t => new Q(t),
    rpc: async (fn, { items }) => { let n = 0; for (const it of items) { const c = db.clients.find(x => x.id === it.id); if (c) { c.lat = it.lat; c.lng = it.lng; n++; } } return { data: n, error: null }; },
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    functions: { invoke: async (name, { body }) => {
      await new Promise(r => setTimeout(r, 300));
      if (body.action === 'search') return { data: { results: [
        { id: '1001', name: body.q + ' (HubSpot)', detail: '12 rue de Rivoli, 75004 Paris · dupont.fr' },
        { id: '1002', name: body.q + ' Lyon', detail: '69007 Lyon' }] } };
      if (body.action === 'get') return { data: { id: body.id, url: 'https://app.hubspot.com/contacts/123/company/' + body.id,
        fields: db.crm_fields.map(f => ({ label: f.label, value: { name: 'Boulangerie Dupont SAS', lifecyclestage: 'Client', notes_last_contacted: '4 novembre 2026' }[f.property] || '' })) } };
      if (body.action === 'properties') return { data: { properties: [
        { name: 'name', label: 'Nom de l’entreprise' }, { name: 'lifecyclestage', label: 'Étape du cycle de vie' },
        { name: 'notes_last_contacted', label: 'Dernier contact' }, { name: 'annualrevenue', label: 'Chiffre d’affaires annuel' },
        { name: 'hubspot_owner_id', label: 'Propriétaire' }] } };
    } },
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session } }; },
      async signInWithPassword({ email, password }) {
        const u = db.users.find(x => x.email === email && x.password === password);
        if (!u) return { data: {}, error: { message: 'Invalid login credentials' } };
        if (!u.confirmed) return { data: {}, error: { message: 'Email not confirmed' } };
        session = { user: { id: u.id, email: u.email } }; emit('SIGNED_IN', session); return { data: { session }, error: null };
      },
      async signUp({ email, password }) {
        if (db.users.some(x => x.email === email)) return { data: {}, error: { message: 'User already registered' } };
        db.users.push({ id: 'u-' + email, email, password, confirmed: false }); return { data: { session: null }, error: null };
      },
      async signOut() { session = null; emit('SIGNED_OUT', null); return { error: null }; },
      async resetPasswordForEmail() { return { error: null }; },
      async updateUser() { return { error: null }; },
    },
  };
  window.supabase = { createClient: () => client };
})();
