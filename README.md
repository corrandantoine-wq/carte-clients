# 📍 Carte Clients

Web app (installable sur mobile) qui affiche toute une base clients sur une carte et montre **en temps réel** les clients les plus proches de l'utilisateur.

## Fonctionnalités
- **Position en direct** (GPS du téléphone) avec cercle de précision ; la carte suit vos déplacements (bouton ◎).
- **Rayon réglable** (1–200 km) : les clients dans le rayon passent en vert, la liste est triée par distance et se met à jour quand vous bougez.
- **Import CSV** (séparateur `;` ou `,`, colonnes détectées automatiquement : nom, adresse, code postal, ville, téléphone, e-mail, notes, latitude, longitude).
- **Géocodage automatique** des adresses sans coordonnées (Base Adresse Nationale, repli sur OpenStreetMap/Nominatim pour l'étranger).
- Fiche client : appel 📞, e-mail, **itinéraire Google Maps / Waze**, modification, suppression.
- Ajout manuel (menu ☰, ou clic droit / appui long sur la carte), recherche, export CSV.
- Regroupement des marqueurs (clusters) pour les grosses bases.
- Données stockées **uniquement sur l'appareil** (localStorage) : rien n'est envoyé à un serveur, sauf les adresses à géocoder.

## Lancer
La géolocalisation exige **HTTPS** (ou `localhost`) :

```bash
cd carte-clients
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Pour l'utiliser sur téléphone, hébergez le dossier sur un hébergeur HTTPS statique (GitHub Pages, Netlify…), ouvrez l'URL puis « Ajouter à l'écran d'accueil ».

## Format CSV
Voir `exemple-clients.csv`. Il faut au minimum une colonne `nom` ou `adresse`.
