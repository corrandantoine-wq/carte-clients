// Fonction Supabase (Edge Function) : invite un collaborateur par e-mail.
// Les inscriptions libres sont désactivées : seul un administrateur peut faire créer un compte,
// et seulement pour une adresse déjà présente dans la liste des collaborateurs (table members).
// La clé secrète service_role est fournie par Supabase au serveur (variable d'environnement) :
// elle n'apparaît jamais dans l'appli ni dans le dépôt.
//
// Appel (POST JSON) : { email }  →  { status: "invité" | "existe" }  ou  { error }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const APP_URL = Deno.env.get("APP_URL") ?? "https://corrandantoine-wq.github.io/carte-clients/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  // 1. L'appelant doit être administrateur (vérifié avec SES droits, pas ceux du serveur).
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: admin } = await asCaller.rpc("is_admin");
  if (!admin) return json({ error: "Réservé aux administrateurs." }, 403);

  let email = "";
  try { email = String((await req.json()).email ?? "").trim().toLowerCase(); } catch { /* corps invalide */ }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Adresse e-mail invalide." }, 400);

  // 2. L'adresse doit être dans la liste des collaborateurs autorisés.
  const { data: member } = await asCaller.from("members").select("email").eq("email", email).maybeSingle();
  if (!member) return json({ error: "Ajoutez d'abord cette adresse à la liste des collaborateurs." }, 400);

  // 3. Envoi de l'invitation (opération d'administration, côté serveur uniquement).
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await service.auth.admin.inviteUserByEmail(email, { redirectTo: APP_URL });
  if (error) {
    if (/already.*(registered|exists)|email_exists/i.test(`${error.message} ${(error as any).code ?? ""}`)) return json({ status: "existe" });
    console.error(error);
    return json({ error: error.message }, 502);
  }
  return json({ status: "invité" });
});
