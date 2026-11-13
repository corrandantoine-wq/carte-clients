# 📍 Carte Clients

Web app (installable sur mobile) qui affiche la **base clients commune de l'équipe** sur une carte et montre **en temps réel** les clients les plus proches de chaque collaborateur.

## Fonctionnalités
- **Accès privé, sur invitation** : pas d'inscription libre. Un administrateur invite chaque collaborateur par e-mail ; la personne choisit son mot de passe en suivant le lien.
- **Base clients commune** : tout le monde voit les mêmes clients. Les ajouts des collègues apparaissent en direct.
- **Favoris personnels** : chacun marque ses clients d'une étoile et peut n'afficher que ses favoris.
- **HubSpot** : chaque client peut être relié à sa fiche HubSpot. La fiche affiche alors des champs du CRM, choisis par l'administrateur, avec un lien « Ouvrir dans HubSpot ».
- **Temps de trajet A → B** entre deux clients, ou depuis sa position : durée, distance, heure d'arrivée et tracé sur la carte. Calcul par le service d'itinéraire de l'IGN, temps hors trafic.
- **Position en direct**, choix du rayon (1 à 100 km), liste triée par distance, itinéraire Google Maps ou Waze, appel, e-mail.
- **Import depuis un ERP** (CSV ou Excel) avec correspondance des colonnes, mise à jour par code client et géocodage par lot. Export CSV.
- **Corbeille** : supprimer un client le met à la corbeille (bouton « Annuler » immédiat). Tout collaborateur peut restaurer ; seul un admin supprime définitivement.
- **Secteurs** : chaque client peut avoir un commercial attitré. Filtre « Mes clients » ; l'admin attribue les clients et filtre par commercial ; un commercial peut prendre un client libre ou rendre les siens.
- **Historique** : chaque création, modification, suppression et restauration est enregistrée (qui, quand, ancienne et nouvelle valeur), consultable sur la fiche.
- **Administration** (menu ☰) : gérer les collaborateurs, exporter la base, choisir les champs HubSpot affichés, vider la base.

## Architecture
| Élément | Rôle |
|---|---|
| `index.html`, `style.css` | Structure et apparence de l'appli (statique, hébergée sur GitHub Pages) |
| `app.js` | Interface : carte, liste, fiche, comptes, import, trajet, administration |
| `js/utils.js` | Fonctions utilitaires (distances, formats, initiales, liens) |
| `js/geo.js` | Services IGN : géocodage des adresses (unitaire et par lot), itinéraires |
| `js/importer.js` | Import ERP : lecture CSV ou Excel, reconnaissance des colonnes, préparation |
| `js/icons.js` | Icônes |
| `config.js` | Adresse du projet Supabase et clé publique « anon » |
| `supabase/migrations/` | Tables, règles de sécurité, temps réel, import ERP |
| `supabase/functions/hubspot/` | Passerelle sécurisée vers HubSpot (le jeton HubSpot reste sur le serveur) |
| `supabase/functions/inviter/` | Envoi des invitations (réservé aux admins ; la clé secrète reste sur le serveur) |

## Sécurité
- **Pas d'inscription libre** : les inscriptions sont désactivées dans Supabase (*Authentication → Sign In / Providers → Allow new users to sign up* : désactivé). Les comptes sont créés uniquement par invitation, via la fonction `inviter`. Elle vérifie que l'appelant est administrateur et que l'adresse figure dans `members`.
- **Double vérification des administrateurs** : après le mot de passe, un code à 6 chiffres d'une appli d'authentification (Google Authenticator, Microsoft Authenticator…). L'appli s'enregistre par QR code à la première connexion. La règle est imposée **par la base** (`006_double_verification_admin.sql`) : une session administrateur sans code n'a accès à rien, même avec le bon mot de passe. Un e-mail d'alerte est envoyé si une méthode de vérification est ajoutée ou retirée du compte.
  - *Téléphone perdu* : Supabase → **Authentication → Users** → le compte → supprimez le facteur MFA. À la connexion suivante, l'appli propose d'enregistrer un nouveau téléphone.
- **Export réservé aux administrateurs** : le bouton « Exporter en CSV » n'apparaît que pour eux. Un collaborateur voit les clients dans l'appli : il ne faut inviter que des personnes de confiance, et les retirer de la liste dès leur départ (accès coupé immédiatement).
- **Rien sans connexion** : l'appli n'interroge la base qu'après la connexion. De plus, le rôle `anon` (requêtes non connectées) n'a **aucun droit** sur les tables ni les fonctions, y compris les tables créées plus tard (`005_verrou_anon.sql`). Supabase répond « permission refusée ».
- **Clés** : seule la clé publique `anon` figure dans le code (`config.js`). Les secrets sont hors du dépôt :
  - la clé `service_role` est une variable d'environnement des fonctions Supabase ;
  - le jeton HubSpot est un secret Supabase ;
  - la connexion à la base et la phrase de chiffrement des sauvegardes sont des secrets GitHub ;
  - le mot de passe Gmail est dans les réglages SMTP de Supabase.

Règles d'accès (**Row Level Security**, activée sur toutes les tables) :
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
2. Collez le contenu de `supabase/migrations/001_init.sql` et cliquez sur **Run**. Recommencez avec `002_import_erp.sql`, puis `003_historique_corbeille.sql`, `004_secteurs.sql`, `005_verrou_anon.sql` et `006_double_verification_admin.sql`.
3. Déclarez-vous administrateur. Dans une nouvelle requête, avec **votre** adresse :
   ```sql
   insert into public.members (email, role) values ('prenom.nom@societe.fr', 'admin');
   ```

### 3. Configurer la connexion
1. Ouvrez **Authentication → URL Configuration**.
   - *Site URL* : `https://corrandantoine-wq.github.io/carte-clients/`
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
   - Faites de même pour la fonction `inviter` (`supabase/functions/inviter/index.ts`), indispensable pour inviter les collaborateurs.
3. Dans **Edge Functions → Secrets**, ajoutez `HUBSPOT_TOKEN` avec le jeton copié.
   - Les clients sont liés aux **entreprises** HubSpot par défaut. Pour les lier aux **contacts**, ajoutez aussi le secret `HUBSPOT_OBJECT` = `contacts`, et les scopes `crm.objects.contacts.read` et `crm.schemas.contacts.read`.

### 6. Mettre en ligne et inviter l'équipe
1. Publiez (fusion dans `main` → GitHub Pages).
2. **Désactivez les inscriptions** : Supabase → *Authentication → Sign In / Providers* → décochez **Allow new users to sign up**.
3. **Premier administrateur** : Supabase → *Authentication → Users → Invite user* avec votre adresse (déjà déclarée admin à l'étape 2 de l'installation). Suivez le lien reçu pour choisir votre mot de passe.
4. Menu ☰ → **Collaborateurs** : saisissez l'adresse d'un collègue et cliquez sur **Inviter**. Il reçoit un e-mail pour choisir son mot de passe. Le bouton ✉ renvoie l'invitation si besoin.
4. Menu ☰ → **Champs HubSpot affichés** : cochez les informations du CRM à montrer sur les fiches.

## Sauvegardes
Chaque nuit, GitHub sauvegarde la base Supabase (workflow « Sauvegarde quotidienne »). Les données de l'appli et les comptes des collaborateurs sont **chiffrés** et conservés **30 jours** (onglet **Actions** → une exécution → **Artifacts**). La même tâche garde la base active : l'offre gratuite de Supabase la met en pause après 7 jours sans activité.

### Mise en route (une fois)
1. **Mot de passe de la base** : dans Supabase, **Project Settings → Database → Reset database password**, puis copiez-le.
2. **Chaîne de connexion** : bouton **Connect** de Supabase → **Session pooler**. Elle ressemble à
   `postgresql://postgres.nyxiwbbbuxxrhegwgkiz:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
   Remplacez `[YOUR-PASSWORD]` par le mot de passe.
3. Dans GitHub, **Settings → Secrets and variables → Actions → New repository secret**, créez :
   - `SUPABASE_DB_URL` : la chaîne de connexion complète ;
   - `BACKUP_PASSPHRASE` : une longue phrase secrète de votre choix. **Gardez-la aussi ailleurs** (gestionnaire de mots de passe) : sans elle, les sauvegardes sont illisibles.
4. **Actions → Sauvegarde quotidienne → Run workflow** pour une première sauvegarde immédiate.

### Restaurer
```bash
bash outils/restaurer.sh sauvegarde-AAAA-MM-JJ.tar.gz.gpg "CHAÎNE_DE_CONNEXION"
```
Le script demande la phrase secrète, affiche le contenu, puis demande confirmation avant de **remplacer** les données de l'appli. Si le projet Supabase a été recréé, il restaure aussi les comptes. Il nécessite PostgreSQL 17 et `gpg`. Ce scénario est vérifié par les tests automatiques (`tests/db/sauvegarde.sh`).

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

## Tests automatiques
Ils sont lancés automatiquement sur GitHub à chaque modification (onglet **Actions**, workflow « Tests »).

- **Unitaires** : 14 tests des modules `js/` (en moins d'une seconde).
  ```bash
  npm run test:unit
  ```
- **Interface** : 36 scénarios, rejoués sur mobile et sur ordinateur. Ils couvrent la connexion, l'accès refusé, l'import ERP (CSV et Excel), le ré-import sans doublon, les favoris, le rayon, la recherche, le trajet A → B, la corbeille, l'historique, les secteurs, HubSpot et l'administration. La base de données et les services externes sont simulés.
  ```bash
  npm ci && npx playwright install chromium && npx playwright test
  ```
- **Base de données** : 54 vérifications des règles d'accès sur un vrai PostgreSQL (collaborateur, administrateur, personne non autorisée, accès sans connexion).
  ```bash
  PGHOST=localhost PGUSER=postgres bash tests/db/run.sh
  ```

## Lancer en local
```bash
python3 -m http.server 8000   # puis http://localhost:8000
```
Ajoutez `http://localhost:8000` aux *Redirect URLs* de Supabase pour tester la connexion en local.
