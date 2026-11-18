// Fonction Supabase (Edge Function) : passerelle sécurisée vers HubSpot.
// Le jeton HubSpot reste côté serveur (secret HUBSPOT_TOKEN), jamais dans l'appli.
//
// Actions (POST JSON) :
//   { action: "search", q }        → recherche d'entreprises HubSpot (pour lier un client)
//   { action: "get", id }          → valeurs des champs choisis (table crm_fields) pour une entreprise
//   { action: "properties" }       → liste des champs HubSpot disponibles (admin uniquement)
//   { action: "export" }           → tout le fichier client HubSpot sous forme de tableau,
//                                    repris par l'écran d'import de l'appli (admin uniquement)
//   { action: "sync" }             → synchronisation automatique de la base avec HubSpot.
//                                    Appelée deux fois par semaine par GitHub (workflow « Synchronisation HubSpot »)
//                                    avec l'en-tête x-sync-secret = secret HUBSPOT_SYNC_SECRET, ou par un admin.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
// @ts-types="npm:@types/papaparse@5.3.14"
import Papa from "npm:papaparse@5.4.1";

const HUBSPOT = "https://api.hubapi.com";
const OBJECT = Deno.env.get("HUBSPOT_OBJECT") ?? "companies"; // "companies" ou "contacts"
const TOKEN = Deno.env.get("HUBSPOT_TOKEN") ?? "";
// Facultatif : nom interne du champ HubSpot qui contient le code client de l'ERP (ex. "code_client").
const CODE_PROP = Deno.env.get("HUBSPOT_CODE_CLIENT") ?? "";
const EXPORT_MAX = 20_000; // garde-fou : au-delà, l'import se fait par fichier
const SYNC_SECRET = Deno.env.get("HUBSPOT_SYNC_SECRET") ?? "";
// Filtre des comptes HubSpot repris dans l'appli : seulement les comptes de LIVRAISON
// (la société a aussi des comptes de facturation, qui ne doivent pas apparaître).
//   HUBSPOT_FILTRE_CHAMP  : le champ HubSpot qui indique le type de compte, par son libellé
//                           (« Type de compte ») ou son nom interne. « aucun » = pas de filtre.
//   HUBSPOT_FILTRE_VALEUR : valeur(s) gardée(s), séparées par des virgules.
// La comparaison ignore majuscules et accents, et accepte la valeur interne comme le libellé affiché.
const FILTRE_CHAMP = (Deno.env.get("HUBSPOT_FILTRE_CHAMP") ?? "Type de compte").trim();
const FILTRE_VALEURS = (Deno.env.get("HUBSPOT_FILTRE_VALEUR") ?? "Livraison").split(",").map((v) => v.trim()).filter(Boolean);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function hs(path: string, init: RequestInit = {}) {
  const r = await fetch(HUBSPOT + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// Caches (durée de vie de l'instance de la fonction).
let portalId: number | null = null;
let propDefs: Map<string, any> | null = null;
let propDefsAt = 0;

async function getPortalId(): Promise<number> {
  if (portalId == null) portalId = (await hs("/account-info/v3/details")).portalId as number;
  return portalId;
}
async function getPropDefs() {
  if (!propDefs || Date.now() - propDefsAt > 10 * 60_000) {
    const res = await hs(`/crm/v3/properties/${OBJECT}`);
    propDefs = new Map(res.results.map((p: any) => [p.name, p]));
    propDefsAt = Date.now();
  }
  return propDefs;
}
const recordUrl = (portal: number, id: string) =>
  `https://app.hubspot.com/contacts/${portal}/${OBJECT === "contacts" ? "contact" : "company"}/${id}`;

// Rend une valeur HubSpot lisible (listes → libellé, dates → format FR, nombres, booléens).
function pretty(def: any, raw: string | null) {
  if (raw == null || raw === "") return "";
  if (def?.options?.length) {
    return raw.split(";").map((v) => def.options.find((o: any) => o.value === v)?.label ?? v).join(", ");
  }
  if (def?.type === "datetime" || def?.type === "date") {
    const d = new Date(/^\d+$/.test(raw) ? Number(raw) : raw);
    if (!isNaN(+d)) return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }
  if (def?.type === "number" && !isNaN(Number(raw))) return Number(raw).toLocaleString("fr-FR");
  if (def?.type === "bool") return raw === "true" ? "Oui" : "Non";
  return raw;
}

// ---------- Filtre des comptes (livraison / facturation) ----------
const simplifier = (v: string) => String(v ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

// Garde-t-on cette fiche ? raw : valeur brute du champ HubSpot (plusieurs valeurs possibles, séparées par « ; »).
// options : choix de la liste déroulante HubSpot (valeur interne → libellé), pour accepter l'un ou l'autre.
// Une valeur convient si elle contient le mot cherché : « Livraison » garde aussi « Compte de livraison ».
export function compteGarde(raw: string | null | undefined, valeurs: string[], options: { value: string; label: string }[] = []) {
  if (!valeurs.length) return true; // pas de filtre configuré
  const voulues = valeurs.map(simplifier);
  const convient = (t: string) => t !== "" && voulues.some((w) => simplifier(t).includes(w));
  return String(raw ?? "").split(";").filter(Boolean).some((v) =>
    convient(v) || convient(options.find((o) => o.value === v)?.label ?? ""));
}

// Retrouve le champ par son nom interne ou par son libellé (« Type de compte »).
export function trouverChamp(defs: Map<string, any>, champ: string) {
  if (defs.has(champ)) return defs.get(champ);
  const cible = simplifier(champ);
  return [...defs.values()].find((d) => simplifier(d.label) === cible || simplifier(d.name) === cible.replace(/ /g, "_"));
}

// Renvoie { nom interne du champ, fonction de tri }, ou null si le filtre est désactivé.
// Par sécurité, si le champ est introuvable, on s'arrête plutôt que de reprendre aussi les comptes de facturation.
async function filtreActif() {
  if (!FILTRE_CHAMP || simplifier(FILTRE_CHAMP) === "aucun" || !FILTRE_VALEURS.length) return null;
  const def = trouverChamp(await getPropDefs(), FILTRE_CHAMP);
  if (!def) throw new Error(`Le champ HubSpot « ${FILTRE_CHAMP} » est introuvable : impossible de ne garder que les comptes « ${FILTRE_VALEURS.join(", ")} ». Vérifiez son nom (secret HUBSPOT_FILTRE_CHAMP).`);
  const options = def.options ?? [];
  return { champ: def.name as string, garde: (props: Record<string, string> | undefined) => compteGarde(props?.[def.name], FILTRE_VALEURS, options) };
}

// ---------- Lecture de tout le fichier client HubSpot ----------
// Colonnes nommées comme dans l'écran d'import de l'appli, pour être reconnues automatiquement.
function exportColumns(): [string, string][] {
  const cols: [string, string][] = OBJECT === "contacts"
    ? [["ID HubSpot", "hs_object_id"], ["Prénom", "firstname"], ["Nom", "lastname"], ["Société", "company"],
       ["Adresse", "address"], ["Code postal", "zip"], ["Ville", "city"], ["Téléphone", "phone"],
       ["Mobile", "mobilephone"], ["E-mail", "email"]]
    : [["ID HubSpot", "hs_object_id"], ["Nom", "name"], ["Adresse", "address"], ["Adresse 2", "address2"],
       ["Code postal", "zip"], ["Ville", "city"], ["Téléphone", "phone"], ["Site web", "domain"]];
  if (CODE_PROP) cols.splice(1, 0, ["Code client", CODE_PROP]);
  return cols;
}

async function fetchAll(cols: [string, string][]) {
  const filtre = await filtreActif();
  const props = [...cols.map(([, p]) => p), ...(filtre ? [filtre.champ] : [])].join(",");
  const rows: string[][] = [];
  let after = "", ecartees = 0;
  do { // HubSpot renvoie 100 fiches par page
    const res = await hs(`/crm/v3/objects/${OBJECT}?limit=100&archived=false&properties=${encodeURIComponent(props)}${after ? `&after=${after}` : ""}`);
    for (const r of res.results ?? []) {
      if (filtre && !filtre.garde(r.properties)) { ecartees++; continue; } // ex. compte de facturation
      rows.push(cols.map(([, p]) => p === "hs_object_id" ? String(r.id) : String(r.properties?.[p] ?? "").trim()));
    }
    after = res.paging?.next?.after ?? "";
  } while (after && rows.length < EXPORT_MAX);
  return { rows, truncated: !!after, ecartees };
}

async function exportTable() {
  const cols = exportColumns();
  const { rows, truncated, ecartees } = await fetchAll(cols);
  return { headers: cols.map(([h]) => h), rows, truncated, ecartees, filtre: FILTRE_VALEURS.join(", "), object: OBJECT };
}

// ---------- Synchronisation automatique ----------
type Fiche = { hubspot_id: string; code_client?: string; nom: string; adresse: string; code_postal: string; ville: string; telephone: string; email?: string };
type Existant = { id: string; code_client: string | null; hubspot_id: string | null; nom: string; adresse: string | null; code_postal: string | null; ville: string | null; telephone: string | null; email: string | null; deleted_at: string | null };

const fixCp = (v: string) => (/^\d{4}$/.test(v) ? "0" + v : v);
const fixTel = (v: string) => (/^[1-9]\d{8}$/.test(v) ? "0" + v : v);

// Une ligne HubSpot → un client de l'appli (mêmes règles que l'import de fichier).
export function toFiche(headers: string[], row: string[]): Fiche {
  const get = (h: string) => String(row[headers.indexOf(h)] ?? "").trim();
  const f: Fiche = {
    hubspot_id: get("ID HubSpot"),
    nom: [get("Prénom"), get("Nom")].filter(Boolean).join(" ") || get("Société"),
    adresse: [get("Adresse"), get("Adresse 2")].filter(Boolean).join(", "),
    code_postal: fixCp(get("Code postal")),
    ville: get("Ville"),
    telephone: fixTel(get("Téléphone") || get("Mobile")),
  };
  if (headers.includes("E-mail")) f.email = get("E-mail");
  if (headers.includes("Code client")) f.code_client = get("Code client");
  return f;
}

// Compare HubSpot à la base et prépare les changements, sans rien écrire.
// - client relié à la même fiche HubSpot (ou, à défaut, avec le même code client) : mis à jour ;
// - seules les informations remplies dans HubSpot remplacent celles de l'appli ;
// - les notes, favoris, secteurs et coordonnées (si l'adresse ne change pas) sont conservés ;
// - un client mis à la corbeille dans l'appli y reste ;
// - une fiche supprimée dans HubSpot n'efface rien dans l'appli.
export function planSync(fiches: Fiche[], existants: Existant[]) {
  const byHs = new Map(existants.filter((c) => c.hubspot_id).map((c) => [c.hubspot_id!, c]));
  const byCode = new Map(existants.filter((c) => c.code_client).map((c) => [c.code_client!, c]));
  const vus = new Set<string>(), codes = new Set(byCode.keys()); // codes client déjà pris
  const inserts: Record<string, unknown>[] = [], updates: { id: string; patch: Record<string, unknown> }[] = [];
  let unchanged = 0, trashed = 0, ignored = 0;
  for (const f of fiches) {
    if (!f.hubspot_id || !f.nom || vus.has(f.hubspot_id)) { ignored++; continue; }
    vus.add(f.hubspot_id);
    const old = byHs.get(f.hubspot_id) ?? (f.code_client ? byCode.get(f.code_client) : undefined);
    if (!old) {
      const code = f.code_client && !codes.has(f.code_client) ? f.code_client : null;
      if (code) codes.add(code);
      inserts.push({ nom: f.nom, adresse: f.adresse, code_postal: f.code_postal, ville: f.ville, telephone: f.telephone,
        email: f.email ?? "", hubspot_id: f.hubspot_id, code_client: code });
      continue;
    }
    if (old.deleted_at) { trashed++; continue; }
    const patch: Record<string, unknown> = {};
    for (const k of ["nom", "adresse", "code_postal", "ville", "telephone", "email", "code_client"] as const) {
      const v = f[k];
      if (v && v !== (old[k] ?? "")) {
        if (k === "code_client" && old.code_client) continue; // le code de l'ERP ne change jamais
        if (k === "code_client" && codes.has(v)) continue;    // déjà utilisé par un autre client
        if (k === "code_client") codes.add(v);
        patch[k] = v;
      }
    }
    if (old.hubspot_id !== f.hubspot_id) patch.hubspot_id = f.hubspot_id;
    if ("adresse" in patch || "code_postal" in patch || "ville" in patch) { patch.lat = null; patch.lng = null; } // à relocaliser
    if (Object.keys(patch).length) updates.push({ id: old.id, patch }); else unchanged++;
  }
  return { inserts, updates, unchanged, trashed, ignored };
}

// Localisation des adresses par lot (service public de l'IGN, comme dans l'appli).
async function geocodeBatch(list: { id: string; adresse: string | null; code_postal: string | null; ville: string | null }[]) {
  const found: { id: string; lat: number; lng: number }[] = [];
  for (let i = 0; i < list.length; i += 5000) {
    const csv = Papa.unparse(list.slice(i, i + 5000).map((c) => ({ id: c.id, adresse: c.adresse ?? "", code_postal: c.code_postal ?? "", ville: c.ville ?? "" })));
    const fd = new FormData();
    fd.append("data", new Blob([csv], { type: "text/csv" }), "adresses.csv");
    for (const col of ["adresse", "code_postal", "ville"]) fd.append("columns", col);
    fd.append("postcode", "code_postal");
    const r = await fetch("https://data.geopf.fr/geocodage/search/csv", { method: "POST", body: fd });
    if (!r.ok) continue;
    for (const x of Papa.parse(await r.text(), { header: true, skipEmptyLines: true }).data as any[]) {
      const lat = parseFloat(x.latitude), lng = parseFloat(x.longitude), score = parseFloat(x.result_score);
      const sameDept = !x.code_postal || !x.result_postcode || String(x.code_postal).slice(0, 2) === String(x.result_postcode).slice(0, 2);
      if (Number.isFinite(lat) && Number.isFinite(lng) && score >= 0.5 && sameDept) found.push({ id: x.id, lat, lng });
    }
  }
  return found;
}

async function runSync() {
  const started = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const cols = exportColumns();
  const { rows, truncated, ecartees } = await fetchAll(cols);
  const headers = cols.map(([h]) => h);
  const fiches = rows.map((r) => toFiche(headers, r));

  const COLS = "id,code_client,hubspot_id,nom,adresse,code_postal,ville,telephone,email,deleted_at,lat,lng";
  const existants: any[] = [];
  for (let from = 0; ; from += 1000) { // la base renvoie 1 000 lignes maximum par lecture
    const { data, error } = await admin.from("clients").select(COLS).order("id").range(from, from + 999);
    if (error) throw error;
    existants.push(...data);
    if (data.length < 1000) break;
  }

  const plan = planSync(fiches, existants);
  for (let i = 0; i < plan.inserts.length; i += 500) {
    const { error } = await admin.from("clients").insert(plan.inserts.slice(i, i + 500));
    if (error) throw error;
  }
  for (let i = 0; i < plan.updates.length; i += 20) { // 20 mises à jour à la fois
    const res = await Promise.all(plan.updates.slice(i, i + 20).map((u) => admin.from("clients").update(u.patch).eq("id", u.id)));
    const err = res.find((r) => r.error)?.error;
    if (err) throw err;
  }

  // Localise toutes les adresses de la base qui n'ont pas encore de position.
  const { data: aLocaliser, error } = await admin.from("clients").select("id,adresse,code_postal,ville")
    .is("deleted_at", null).or("lat.is.null,lng.is.null").limit(20000);
  if (error) throw error;
  const avecAdresse = (aLocaliser ?? []).filter((c) => c.adresse || c.code_postal || c.ville);
  const coords = avecAdresse.length ? await geocodeBatch(avecAdresse) : [];
  for (let i = 0; i < coords.length; i += 1000) {
    const { error } = await admin.rpc("set_coords", { items: coords.slice(i, i + 1000) });
    if (error) throw error;
  }

  return {
    ok: true, objet: OBJECT, fiches_hubspot: fiches.length, tronque: truncated,
    filtre: FILTRE_VALEURS.join(", ") || "aucun", fiches_ecartees_par_le_filtre: ecartees,
    ajoutes: plan.inserts.length, mis_a_jour: plan.updates.length, inchanges: plan.unchanged,
    restes_a_la_corbeille: plan.trashed, ignores: plan.ignored,
    localises: coords.length, non_localises: avecAdresse.length - coords.length,
    duree_s: Math.round((Date.now() - started) / 1000),
  };
}

// Comparaison à durée constante (le secret ne doit pas pouvoir être deviné caractère par caractère).
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  // Synchronisation planifiée (GitHub) : protégée par un secret partagé, sans compte utilisateur.
  const syncKey = req.headers.get("x-sync-secret");
  if (syncKey !== null) {
    if (!SYNC_SECRET || !sameSecret(syncKey, SYNC_SECRET)) return json({ error: "Secret de synchronisation invalide." }, 403);
    if (!TOKEN) return json({ error: "HubSpot n'est pas encore configuré (secret HUBSPOT_TOKEN manquant)." }, 503);
    try { return json(await runSync()); }
    catch (e) { console.error(e); return json({ error: String((e as any)?.message ?? e) }, 502); }
  }

  // Vérifie que l'appelant est un collaborateur autorisé (via ses droits, pas ceux du serveur).
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: member } = await db.rpc("is_member");
  if (!member) return json({ error: "Accès réservé aux collaborateurs autorisés." }, 403);
  if (!TOKEN) return json({ error: "HubSpot n'est pas encore configuré (secret HUBSPOT_TOKEN manquant)." }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Requête invalide" }, 400); }

  try {
    if (body.action === "search") {
      const q = String(body.q ?? "").trim();
      if (q.length < 2) return json({ results: [] });
      const nameProp = OBJECT === "contacts" ? "lastname" : "name";
      const filtre = await filtreActif();
      const props = OBJECT === "contacts"
        ? ["firstname", "lastname", "email", "phone", "city", "zip", "address"]
        : ["name", "domain", "phone", "city", "zip", "address"];
      if (filtre) props.push(filtre.champ);
      const res = await hs(`/crm/v3/objects/${OBJECT}/search`, {
        method: "POST",
        body: JSON.stringify({ query: q, limit: filtre ? 50 : 10, properties: props, sorts: [{ propertyName: nameProp, direction: "ASCENDING" }] }),
      });
      const results = (res.results ?? []).filter((r: any) => !filtre || filtre.garde(r.properties)).slice(0, 10);
      return json({
        results: results.map((r: any) => ({
          id: r.id,
          name: OBJECT === "contacts" ? [r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") : r.properties.name,
          detail: [r.properties.address, [r.properties.zip, r.properties.city].filter(Boolean).join(" "), r.properties.domain ?? r.properties.email]
            .filter(Boolean).join(" · "),
        })),
      });
    }

    if (body.action === "get") {
      const id = String(body.id ?? "");
      if (!/^\d+$/.test(id)) return json({ error: "Identifiant HubSpot invalide" }, 400);
      const { data: fields, error } = await db.from("crm_fields").select("property,label").order("position");
      if (error) throw error;
      const [defs, portal] = await Promise.all([getPropDefs(), getPortalId()]);
      const names = (fields ?? []).map((f) => f.property);
      const rec = await hs(`/crm/v3/objects/${OBJECT}/${id}?properties=${encodeURIComponent(names.join(","))}`);
      return json({
        id,
        url: recordUrl(portal, id),
        fields: (fields ?? []).map((f) => ({ label: f.label, value: pretty(defs.get(f.property), rec.properties?.[f.property]) })),
      });
    }

    if (body.action === "properties") {
      const { data: admin } = await db.rpc("is_admin");
      if (!admin) return json({ error: "Réservé aux administrateurs." }, 403);
      const defs = await getPropDefs();
      return json({
        properties: [...defs.values()]
          .filter((p: any) => !p.hidden)
          .map((p: any) => ({ name: p.name, label: p.label, group: p.groupName }))
          .sort((a, b) => a.label.localeCompare(b.label, "fr")),
      });
    }

    if (body.action === "export" || body.action === "sync") {
      const { data: admin } = await db.rpc("is_admin");
      if (!admin) return json({ error: "Réservé aux administrateurs." }, 403);
      if (body.action === "export") return json(await exportTable());
      return json(await runSync());
    }

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
}

// CARTE_CLIENTS_TEST : permet aux tests d'importer planSync sans démarrer le serveur.
if (!Deno.env.get("CARTE_CLIENTS_TEST")) Deno.serve(handler);
