// Fonction Supabase (Edge Function) : rendez-vous HubSpot et comptes rendus de visite.
// Le jeton HubSpot reste côté serveur (secret HUBSPOT_TOKEN, le même que la fonction « hubspot »).
// Toutes les lectures et écritures dans la base se font avec les droits de l'appelant
// (règles d'accès de 008_comptes_rendus.sql) : pas de clé secrète service_role ici.
//
// Droits nécessaires sur l'appli privée HubSpot (en plus de ceux de la fonction « hubspot ») :
//   crm.objects.contacts.read, crm.objects.contacts.write (rendez-vous), files (enregistrements).
//
// Actions (POST JSON) :
//   { action: "liste", client_id }  → rendez-vous HubSpot du client, du plus proche au plus lointain (± 14 jours)
//   { action: "envoyer", visite_id } → écrit le compte rendu dans le rendez-vous (créé s'il n'y en a pas),
//                                      y joint l'enregistrement audio et l'efface du stockage temporaire
//   { action: "audio", visite_id }   → lien d'écoute temporaire (15 min) de l'enregistrement
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  ajouterPieceJointe, CONSERVATION_AUDIO, fusionnerNotes, nomFichierAudio, notesCompteRendu, nouveauRdv, trierRdv, TYPES_AUDIO,
} from "./logique.mjs";

const HUBSPOT = "https://api.hubapi.com";
const OBJECT = Deno.env.get("HUBSPOT_OBJECT") ?? "companies"; // "companies" ou "contacts", comme la fonction « hubspot »
const TOKEN = Deno.env.get("HUBSPOT_TOKEN") ?? "";
const DOSSIER = "/Carte Clients/Enregistrements";
const PROPS = ["hs_meeting_title", "hs_meeting_start_time", "hs_meeting_end_time", "hs_meeting_outcome", "hs_timestamp"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hs(path: string, init: RequestInit = {}) {
  const r = await fetch(HUBSPOT + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) },
  });
  if (r.status === 204) return null;
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    try { msg = JSON.parse(text).message ?? msg; } catch { /* texte brut */ }
    if (r.status === 403) msg = `droits HubSpot insuffisants (ajoutez les droits « rendez-vous » et « files » à l'appli privée) : ${msg}`;
    throw new Error(`HubSpot ${r.status} : ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: member } = await db.rpc("is_member");
  if (!member) return json({ error: "Accès réservé aux collaborateurs autorisés." }, 403);
  if (!TOKEN) return json({ error: "HubSpot n'est pas encore configuré (secret HUBSPOT_TOKEN manquant)." }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Requête invalide" }, 400); }

  // ---------- Rendez-vous planifiés pour un client ----------
  if (body.action === "liste") {
    if (!UUID.test(String(body.client_id))) return json({ error: "Client invalide" }, 400);
    const { data: c } = await db.from("clients").select("hubspot_id").eq("id", body.client_id).maybeSingle();
    if (!c) return json({ error: "Client introuvable" }, 404);
    if (!c.hubspot_id) return json({ rdv: [] });
    try {
      const assoc = await hs(`/crm/v4/objects/${OBJECT}/${c.hubspot_id}/associations/meetings?limit=500`);
      const ids = (assoc?.results ?? []).map((a: any) => String(a.toObjectId));
      if (!ids.length) return json({ rdv: [] });
      const meetings: any[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const res = await hs("/crm/v3/objects/meetings/batch/read", {
          method: "POST", body: JSON.stringify({ properties: PROPS, inputs: ids.slice(i, i + 100).map((id: string) => ({ id })) }),
        });
        meetings.push(...(res?.results ?? []));
      }
      return json({ rdv: trierRdv(meetings) });
    } catch (e) { return json({ error: (e as Error).message }, 502); }
  }

  if (!UUID.test(String(body.visite_id))) return json({ error: "Compte rendu invalide" }, 400);
  const { data: v } = await db.from("visites").select("*").eq("id", body.visite_id).maybeSingle();
  if (!v) return json({ error: "Compte rendu introuvable" }, 404);

  // ---------- Écoute d'un enregistrement ----------
  if (body.action === "audio") {
    if (!v.hubspot_file_id) return json({ error: v.audio_path ? "Enregistrement pas encore transféré dans HubSpot." : "Pas d'enregistrement." }, 404);
    try {
      const r = await hs(`/files/v3/files/${v.hubspot_file_id}/signed-url?expirationSeconds=900`);
      return json({ url: r.url });
    } catch (e) {
      const msg = (e as Error).message;
      return json({ error: / 404 /.test(msg) ? "Enregistrement supprimé (conservation limitée à 6 mois)." : msg }, 502);
    }
  }

  // ---------- Envoi du compte rendu (et de l'enregistrement) dans HubSpot ----------
  if (body.action === "envoyer") {
    const { data: c } = await db.from("clients").select("nom,hubspot_id").eq("id", v.client_id).maybeSingle();
    if (!c?.hubspot_id) return json({ error: "Ce client n'est pas relié à HubSpot." }, 400);
    const maj = (patch: Record<string, unknown>) => db.from("visites").update(patch).eq("id", v.id).select("*").single();
    try {
      // 1. Le rendez-vous : celui choisi par le commercial, sinon on le crée.
      let meetingId = v.hubspot_meeting_id as string | null;
      let existing: any = null;
      if (meetingId) {
        existing = await hs(`/crm/v3/objects/meetings/${meetingId}?properties=hs_internal_meeting_notes,hs_attachment_ids`);
      } else {
        const created = await hs("/crm/v3/objects/meetings", {
          method: "POST", body: JSON.stringify({ properties: { ...nouveauRdv(v, c.nom), hs_meeting_outcome: "SCHEDULED" } }),
        });
        meetingId = String(created.id);
        await hs(`/crm/v4/objects/meetings/${meetingId}/associations/default/${OBJECT}/${c.hubspot_id}`, { method: "PUT" });
        await maj({ hubspot_meeting_id: meetingId }); // pour ne pas en recréer un si l'envoi est relancé
      }

      // 2. L'enregistrement : stockage temporaire → fichier privé HubSpot (supprimé après 6 mois).
      let fileId = v.hubspot_file_id as string | null;
      if (v.audio_path && !fileId) {
        const { data: blob, error } = await db.storage.from("enregistrements").download(v.audio_path);
        if (error || !blob) throw new Error("enregistrement introuvable dans le stockage temporaire : renvoyez-le depuis le téléphone");
        const ext = String(v.audio_path).split(".").pop()!.toLowerCase();
        const form = new FormData();
        form.append("file", new Blob([await blob.arrayBuffer()], { type: TYPES_AUDIO[ext as keyof typeof TYPES_AUDIO] ?? "audio/webm" }), nomFichierAudio(v, c.nom));
        form.append("folderPath", DOSSIER);
        form.append("options", JSON.stringify({ access: "PRIVATE", ttl: CONSERVATION_AUDIO, overwrite: false, duplicateValidationStrategy: "NONE" }));
        const up = await hs("/files/v3/files", { method: "POST", body: form });
        fileId = String(up.id);
        await maj({ hubspot_file_id: fileId });
      }

      // 3. Le compte rendu dans les notes internes du rendez-vous, et le résultat du rendez-vous.
      const props: Record<string, string> = {
        hs_internal_meeting_notes: fusionnerNotes(existing?.properties?.hs_internal_meeting_notes, notesCompteRendu(v, { client: c.nom }), v.id),
        hs_meeting_outcome: v.resultat === "absent" ? "NO_SHOW" : "COMPLETED",
      };
      if (fileId) props.hs_attachment_ids = ajouterPieceJointe(existing?.properties?.hs_attachment_ids, fileId);
      await hs(`/crm/v3/objects/meetings/${meetingId}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });

      // 4. Fin : l'audio n'est plus gardé que dans HubSpot.
      if (v.audio_path) await db.storage.from("enregistrements").remove([v.audio_path]);
      const { data: done, error } = await maj({ hubspot_statut: "envoye", hubspot_erreur: null, audio_path: null, hubspot_meeting_id: meetingId });
      if (error) throw error;
      return json({ visite: done });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await maj({ hubspot_statut: "erreur", hubspot_erreur: msg.slice(0, 500) });
      return json({ error: msg }, 502);
    }
  }

  return json({ error: "Action inconnue" }, 400);
});
