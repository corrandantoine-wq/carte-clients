# 📍 Carte Clients

Web app (installable sur mobile) qui affiche la **base clients commune de l'équipe** sur une carte et montre **en temps réel** les clients les plus proches de chaque collaborateur.

## Fonctionnalités
- **Comptes collaborateurs** (e-mail + mot de passe). Seules les adresses autorisées par un administrateur ont accès.
- **Base clients commune** : tout le monde voit les mêmes clients. Les ajouts des collègues apparaissent en direct.
- **Favoris personnels** : chacun marque ses clients d'une étoile et peut n'afficher que ses favoris.
- **HubSpot** : chaque client peut être relié à sa fiche HubSpot. La fiche affiche alors des champs du CRM, choisis par l'administrateur, avec un lien « Ouvrir dans HubSpot ».
- **Position en direct**, choix du rayon (1 à 100 km), liste triée par distance, itinéraire Google Maps ou Waze, appel, e-mail.
- **Import depuis un ERP** (CSV ou Excel) avec correspondance des colonnes, mise à jour par code client et géocodage par lot. Export CSV.
- **Administration** (menu ☰) : gérer les collaborateurs, choisir les champs HubSpot affichés, vider la base.

## Architecture
| Élément | Rôle |
|---|---|
| `index.html`, `app.js`, `style.css` | L'appli (statique, hébergée sur GitHub Pages) |
| `config.js` | Adresse du projet Supabase et clé publique « anon » |
| `supabase/migrations/` | Tables, règles de sécurité, temps réel, import ERP |
| `supabase/functions/hubspot/` | Passerelle sécurisée vers HubSpot (le jeton HubSpot reste sur le serveur) |

La sécurité repose sur les règles **Row Level Security** de la base :
- Un compte dont l'adresse n'est pas dans `members` ne voit **rien**.
- Les favoris sont visibles par leur seul propriétaire.
- Seuls l'auteur d'un client ou un admin peuvent le supprimer.
- Seuls les admins gèrent les collaborateurs et les champs CRM.

## Installation (une seule fois, environ 20 minutes)

### 1. Créer le projet Supabase
1. Créez un compte sur [supabase.com](https://supabase.com), puis **New project**.
2. Région : choisissez une région **européenne** (Paris ou Frankfurt), pour le RGPD.
3. Notez le mot de passe de la base (il ne servira pas dans l'appli).

### 2. Créer les tables
1. Dans Supabase, ouvrez **SQL Editor → New query**.
2. Collez le contenu de `supabase/migrations/001_init.sql` et cliquez sur **Run**. Recommencez avec `002_import_erp.sql`.
3. Déclarez-vous administrateur. Dans une nouvelle requête, avec **votre** adresse :
   ```sql
   insert into public.members (email, role) values ('prenom.nom@societe.fr', 'admin');
   ```

### 3. Configurer la connexion
1. Ouvrez **Authentication → URL Configuration**.
   - *Site URL* : `https://corrandantoine-wq.github.io/calendrier-matchs/carte-clients/`
   - *Redirect URLs* : ajoutez la même adresse.
2. **Authentication → Sign In / Providers → Email** : laissez « Confirm email » activé.
3. Facultatif mais conseillé : l'envoi d'e-mails intégré à Supabase est limité à quelques messages par heure. Pour une équipe, branchez le serveur d'e-mails de la société dans **Authentication → Emails → SMTP Settings**.

### 4. Relier l'appli au projet
Dans **Project Settings → API**, copiez *Project URL* et la clé *anon public*. Collez-les dans `config.js` :
```js
window.CARTE_CLIENTS_CONFIG = {
  supabaseUrl: 'https://xxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```
La clé « anon » est faite pour être publique. Ne mettez **jamais** la clé *service_role* dans ce fichier.

### 5. Brancher HubSpot
1. Dans HubSpot, créez une **application privée** : Paramètres → Intégrations → Applications privées (selon votre version : *Development → Legacy apps*).
   - Nom : « Carte Clients ».
   - Scopes : `crm.objects.companies.read` et `crm.schemas.companies.read`.
   - Copiez le **jeton d'accès**.
2. Dans Supabase, ouvrez **Edge Functions → Deploy a new function → Via Editor**.
   - Nom : `hubspot`.
   - Collez le contenu de `supabase/functions/hubspot/index.ts`, puis **Deploy**.
3. Dans **Edge Functions → Secrets**, ajoutez `HUBSPOT_TOKEN` avec le jeton copié.
   - Les clients sont liés aux **entreprises** HubSpot par défaut. Pour les lier aux **contacts**, ajoutez aussi le secret `HUBSPOT_OBJECT` = `contacts`, et les scopes `crm.objects.contacts.read` et `crm.schemas.contacts.read`.

### 6. Mettre en ligne et inviter l'équipe
1. Publiez (fusion dans `main` → GitHub Pages).
2. Connectez-vous : onglet **Créer un compte** avec votre adresse admin, confirmez l'e-mail, puis connectez-vous.
3. Menu ☰ → **Collaborateurs** : ajoutez l'adresse de chaque collègue. Chacun crée ensuite son compte avec cette adresse.
4. Menu ☰ → **Champs HubSpot affichés** : cochez les informations du CRM à montrer sur les fiches.

## Importer la base clients (ERP, CSV, Excel)
Menu ☰ → **Importer un fichier**. Formats acceptés :
- **CSV**, séparé par `;` ou `,`. L'encodage UTF-8 ou Windows est détecté automatiquement.
- **Excel** (`.xlsx`, `.xls`) : la première feuille est lue.

Une extraction d'ERP convient (Sage, Cegid, EBP, SAP, Odoo, Divalto…), en général via « Exporter » sur la liste des clients.

1. **Correspondance des colonnes** : l'appli reconnaît les noms habituels (« Raison sociale », « Intitulé », « N° compte tiers », « CP », « Adresse 2 »…). Ajustez si besoin, à l'aide de l'aperçu des 5 premières lignes. La correspondance est mémorisée pour le prochain import du même format.
2. **Code client** : choisissez la colonne qui identifie le client dans l'ERP. Lors des imports suivants, les clients déjà présents sont **mis à jour** au lieu d'être dupliqués. Les notes, favoris et liens HubSpot saisis dans l'appli sont conservés.
3. **Localisation** : les adresses françaises sont localisées **par lot**, quelques minutes pour des milliers de clients, via le service public de géocodage de l'IGN (`data.geopf.fr`). Les résultats peu fiables sont écartés. Les clients non localisés portent le badge « non localisé » et peuvent être corrigés à la main.
4. **Corrections automatiques** : les zéros perdus par Excel sont rétablis (codes postaux `1000` → `01000`, téléphones `612345678` → `0612345678`).

Exemple : `exemple-clients.csv`. Limite du géocodage : 200 000 lignes par fichier.

## Lancer en local
```bash
cd carte-clients && python3 -m http.server 8000   # puis http://localhost:8000
```
Ajoutez `http://localhost:8000` aux *Redirect URLs* de Supabase pour tester la connexion en local.
