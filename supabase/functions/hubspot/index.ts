// Fonction Supabase (Edge Function) : passerelle sécurisée vers HubSpot.
// Le jeton HubSpot reste côté serveur (secret HUBSPOT_TOKEN), jamais dans l'appli.
//
// Actions (POST JSON) :
//   { action: "search", q }        → recherche d'entreprises HubSpot (pour lier un client)
//   { action: "get", id }          → valeurs des champs choisis (table crm_fields) pour une entreprise
//   { action: "properties" }       → liste des champs HubSpot disponibles (admin uniquement)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const HUBSPOT = "https://api.hubapi.com";
const OBJECT = Deno.env.get("HUBSPOT_OBJECT") ?? "companies"; // "companies" ou "contacts"
const TOKEN = Deno.env.get("HUBSPOT_TOKEN") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

async function getPortalId() {
  if (portalId == null) portalId = (await hs("/account-info/v3/details")).portalId;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

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
      const props = OBJECT === "contacts"
        ? ["firstname", "lastname", "email", "phone", "city", "zip", "address"]
        : ["name", "domain", "phone", "city", "zip", "address"];
      const res = await hs(`/crm/v3/objects/${OBJECT}/search`, {
        method: "POST",
        body: JSON.stringify({ query: q, limit: 10, properties: props, sorts: [{ propertyName: nameProp, direction: "ASCENDING" }] }),
      });
      return json({
        results: res.results.map((r: any) => ({
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

    return json({ error: "Action inconnue" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
