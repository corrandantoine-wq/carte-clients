// Tests de la synchronisation HubSpot (fonction Supabase), lancés avec Deno :
//   CARTE_CLIENTS_TEST=1 deno test --allow-env --allow-net --allow-read --allow-sys tests/deno/
import { assertEquals } from "jsr:@std/assert@1";
import { planSync, toFiche } from "../../supabase/functions/hubspot/index.ts";

const H = ["ID HubSpot", "Code client", "Nom", "Adresse", "Adresse 2", "Code postal", "Ville", "Téléphone", "Site web"];
const fiche = (...r: string[]) => toFiche(H, r);
const client = (o: Record<string, unknown>) => ({ id: "x", code_client: null, hubspot_id: null, nom: "", adresse: "", code_postal: "", ville: "", telephone: "", email: "", deleted_at: null, ...o }) as any;

Deno.test("une ligne HubSpot devient un client (codes postaux et téléphones réparés)", () => {
  assertEquals(fiche("1001", "", "Dupont SAS", "12 rue de Rivoli", "Bât. B", "1000", "Bourg", "472000000", "dupont.fr"),
    { hubspot_id: "1001", code_client: "", nom: "Dupont SAS", adresse: "12 rue de Rivoli, Bât. B", code_postal: "01000", ville: "Bourg", telephone: "0472000000" });
});

Deno.test("nouveaux clients, mises à jour, corbeille et doublons", () => {
  const p = planSync([
    fiche("1", "", "Nouveau", "1 rue A", "", "75001", "Paris", "", ""),
    fiche("2", "", "Dupont SAS", "12 rue de Rivoli", "", "75004", "Paris", "", ""),   // même fiche, nouveau nom
    fiche("3", "CLI3", "Martin", "", "", "", "", "0102030405", ""),                    // reconnu par son code client
    fiche("4", "", "En corbeille", "", "", "", "", "", ""),
    fiche("5", "", "Identique", "", "", "", "Lyon", "", ""),
    fiche("1", "", "Doublon", "", "", "", "", "", ""),
  ], [
    client({ id: "c2", hubspot_id: "2", nom: "Dupont", adresse: "12 rue de Rivoli", code_postal: "75004", ville: "Paris" }),
    client({ id: "c3", code_client: "CLI3", nom: "Martin", ville: "Lyon" }),
    client({ id: "c4", hubspot_id: "4", nom: "Vieux", deleted_at: "2026-11-01" }),
    client({ id: "c5", hubspot_id: "5", nom: "Identique", ville: "Lyon" }),
  ]);
  assertEquals(p.inserts.map((c) => c.nom), ["Nouveau"]);
  assertEquals(p.updates, [
    { id: "c2", patch: { nom: "Dupont SAS" } },                                // adresse identique : position gardée
    { id: "c3", patch: { telephone: "0102030405", hubspot_id: "3" } },          // ville vide dans HubSpot : « Lyon » gardé
  ]);
  assertEquals([p.unchanged, p.trashed, p.ignored], [1, 1, 1]);
});

Deno.test("adresse modifiée : le client sera relocalisé ; le code client de l'ERP ne change jamais", () => {
  const p = planSync([fiche("9", "HS9", "A", "2 rue B", "", "69001", "Lyon", "", "")],
    [client({ id: "c9", hubspot_id: "9", code_client: "ERP9", nom: "A", adresse: "1 rue B", code_postal: "69001", ville: "Lyon" })]);
  assertEquals(p.updates, [{ id: "c9", patch: { adresse: "2 rue B", lat: null, lng: null } }]);
});

Deno.test("deux fiches HubSpot avec le même code client : pas de conflit", () => {
  const p = planSync([fiche("1", "C1", "A", "", "", "", "", "", ""), fiche("2", "C1", "B", "", "", "", "", "", "")], []);
  assertEquals(p.inserts.map((c) => c.code_client), ["C1", null]);
});
