# 🎬 Médiathèque Numérique – Notes Allociné & IMDb

Userscript (Tampermonkey / Violentmonkey) qui affiche les **notes Allociné Presse, Spectateurs et IMDb** directement sur les vignettes de films de [Médiathèque Numérique](https://vod.mediatheque-numerique.com/), avec un **code couleur** pour repérer d'un coup d'œil les films qui valent le détour.

<!-- Ajoutez une capture d'écran : ![Aperçu](docs/apercu.png) -->

Exemple de badge ajouté en bas de chaque affiche : `📰 3,9` `👥 4,0` `IMDb 7.1`

## ✨ Fonctionnalités

- **Trois notes par film** : Allociné Presse (/5), Allociné Spectateurs (/5) et IMDb (/10).
- **Code couleur** selon la note (ramenée sur 5 pour IMDb) :

  | Note /5        | Couleur              | Appréciation |
  |----------------|----------------------|--------------|
  | < 2,5          | 🔴 Rouge             | Mauvais      |
  | 2,5 – 3,5      | 🟠 Orange            | Moyen        |
  | 3,5 – 4,2      | 🟢 Vert clair        | Correct      |
  | ≥ 4,2          | 🟢 Vert foncé, liseré doré | Génial |

- **Fonctionne partout sur le site** : nouveautés, accueil, sélections, carrousels et **liste d'envies** (tableau de bord).
- **Correspondance fiable** : recherche par titre + année, ou par **réalisateur** quand l'année n'est pas affichée (liste d'envies) ; recherche IMDb via le **titre original** fourni par Allociné (indispensable pour les films étrangers).
- **Liens directs** : un clic sur une note ouvre la fiche Allociné ou IMDb dans un nouvel onglet. Survol = info-bulle (nombre de votes IMDb, appréciation).
- **Léger** : notes chargées uniquement à l'approche des vignettes (défilement infini géré), 3 requêtes simultanées max, **cache de 7 jours**.
- **Robuste** aux re-rendus de la page (application React) : les badges sont ré-attachés automatiquement.

## 📦 Installation

1. Installez une extension de userscripts :
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Brave, Edge, Firefox…)
   - ou [Violentmonkey](https://violentmonkey.github.io/)
2. **Chrome / Brave / Edge récents** : activez le **Mode développeur** dans `brave://extensions` (ou `chrome://extensions`), ou l'option « Autoriser les scripts utilisateur » dans les détails de l'extension. C'est requis par Manifest V3 pour exécuter des userscripts.
3. Ouvrez le fichier [`mediatheque-notes.user.js`](mediatheque-notes.user.js) en mode **Raw** : Tampermonkey propose de l'installer.
   *(Ou : Tampermonkey → Créer un nouveau script → coller le contenu → Enregistrer.)*
4. Rendez-vous sur https://vod.mediatheque-numerique.com/novelties. À la première requête, Tampermonkey demande l'autorisation d'accéder aux domaines externes : choisissez **« Toujours autoriser le domaine »**.

## 🔑 Clé OMDb (pour la note IMDb)

IMDb n'autorise pas l'accès direct à ses notes depuis un autre site ; le script passe donc par l'API **[OMDb](https://www.omdbapi.com/)**, gratuite.

1. Demandez une clé gratuite (1 000 requêtes/jour) : https://www.omdbapi.com/apikey.aspx
2. **Cliquez sur le lien d'activation** reçu par e-mail (sinon la clé renvoie une erreur 401).
3. Saisissez la clé :
   - en cliquant sur un badge **`IMDb 🔑`**,
   - ou via le menu Tampermonkey → **« Définir la clé OMDb (notes IMDb) »**.

| Badge IMDb | Signification |
|------------|---------------|
| `IMDb 7.1` | Note trouvée |
| `IMDb –`   | Film introuvable sur OMDb (souvent un film très récent) |
| `IMDb 🔑`  | Aucune clé configurée — cliquer pour la saisir |
| `IMDb ⚠`   | Clé refusée (invalide, non activée ou quota atteint) — cliquer pour la ressaisir |

Les notes Allociné fonctionnent sans clé.

## ⚙️ Fonctionnement

```
Vignette (titre, année / réalisateur)
        │
        ├─► Allociné : /_/autocomplete/<titre>  → choix du film (réalisateur, titre, année)
        │       └─► fiche du film → notes Presse & Spectateurs + titre original
        │
        └─► IMDb : suggestion API (titre original) → identifiant tt…
                └─► OMDb (?i=tt…) → note IMDb + nombre de votes
```

Les requêtes vers les autres sites passent par `GM_xmlhttpRequest`, seul moyen pour un userscript de contourner la politique CORS du navigateur. Les domaines contactés sont déclarés dans l'en-tête du script (`@connect`) :

- `www.allocine.fr`
- `v3.sg.media-imdb.com`
- `www.omdbapi.com`

## 🎨 Personnalisation

Tout se règle en haut ou au milieu du script :

| Quoi | Où |
|------|----|
| Seuils de couleur | tableau `TIERS` |
| Couleurs | classes CSS `.mn-bad`, `.mn-avg`, `.mn-good`, `.mn-great` |
| Durée du cache | `CACHE_TTL` (7 jours par défaut) |
| Requêtes simultanées | `MAX_PARALLEL` (3 par défaut) |

Pour vider le cache : Tampermonkey → le script → onglet **Stockage**, ou incrémentez `CACHE_PREFIX`.

## 🐞 Dépannage

- **Aucun badge** : vérifiez que le script est activé et que le Mode développeur / « Autoriser les scripts utilisateur » est actif (Chrome/Brave).
- **`–` partout** : les domaines externes n'ont pas été autorisés dans Tampermonkey.
- **Mauvais film associé** : ouvrez la console (F12) ; les messages du script commencent par `[notes]`. Ouvrez une *issue* avec le titre concerné.

## ⚠️ Limites

- Allociné ne propose pas d'API officielle : le script lit ses pages publiques et peut cesser de fonctionner si le site change.
- Les films sans critiques presse (souvent les classiques anciens) n'ont pas de note Presse.
- Projet personnel et non commercial, sans lien avec Médiathèque Numérique, ARTE, Allociné, IMDb ou OMDb. Les données restent la propriété de leurs auteurs respectifs.

## 🔒 Vie privée

Le script n'envoie aucune donnée personnelle : seuls les **titres des films** sont transmis à Allociné, IMDb et OMDb. La clé OMDb et le cache sont stockés localement par Tampermonkey.

## 📝 Historique

| Version | Changements |
|---------|-------------|
| 1.5 | Liste d'envies : correspondance par réalisateur, repli sur le titre court |
| 1.4 | Détection du titre sur toutes les pages du site |
| 1.3 | Code couleur selon la note |
| 1.2 | Meilleure gestion des erreurs de clé OMDb (pas de mise en cache) |
| 1.1 | Note IMDb via OMDb (l'API GraphQL d'IMDb bloque les requêtes externes) |
| 1.0 | Première version |

## 📄 Licence

[MIT](LICENSE) — libre à vous de l'utiliser, le modifier et le partager.

