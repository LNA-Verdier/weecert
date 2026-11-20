# WeeCert

Réviser les certifications Databricks (Data Engineer Associate, Data Engineer Professional, Data Analyst Associate) en petites sessions de 10 à 15 minutes, avec son équipe.

- **Parcours** de leçons par section, avec révision de fin de section et coffre à ouvrir
- **Révisions** : leçon du jour, rattrapage des erreurs, sprint de 40 questions en 15 minutes, examen blanc aux conditions réelles
- **Répétition espacée resserrée** pour préparer une certification rapidement
- **Gamification** : XP, séries de jours, badges, avatar, classement de la semaine et général
- **Import de questions** (CSV ou JSON) réservé aux administrateurs, avec sources activables et détection des doublons
- **Accès réservé à l'équipe** : seules les adresses ajoutées par le propriétaire peuvent créer un compte

## Stack

Site statique (HTML/CSS/JS, sans build) hébergé sur GitHub Pages, base Supabase (Postgres, authentification et temps réel).

```
index.html                l'application (styles, interface, logique de révision, questions originales)
config.js                 adresse et clé publique Supabase
js/supa.js                connexion, écran de compte, accès aux données Supabase, gestion de l'équipe
icon.svg                  icône (Frizz)
supabase/schema.sql       tables, fonctions et règles d'accès
tests/sql/                tests du schéma sur un Postgres local
tests/e2e/                test du site avec un faux Supabase
```

Les questions importées (par exemple depuis des fichiers CSV) ne sont **jamais** dans ce dépôt : elles restent dans la base Supabase, lisibles uniquement par les membres connectés. Le dossier `migration/` est exclu du dépôt pour la même raison.

## Installation

1. **Supabase** : créer un projet (région Europe), puis dans *SQL Editor* exécuter `supabase/schema.sql`.
2. Toujours dans *SQL Editor*, se déclarer propriétaire :
   ```sql
   insert into public.members (email, role) values ('ton.adresse@exemple.fr', 'owner');
   ```
3. **Authentification** :
   - *Authentication → Sign In / Providers* : *Allow new users to sign up* activé (la liste `members` bloque toute adresse non autorisée).
   - *Email* : activé, *Confirm email* **désactivé**, mot de passe de 10 caractères minimum avec lettres et chiffres.
   - *Authentication → URL Configuration* : *Site URL* et *Redirect URLs* = `https://lna-verdier.github.io/weecert/`.
   - WeeCert fonctionne sans envoi d'e-mails (`EMAILS = false` dans `config.js`). Pour activer la confirmation d'adresse et « Mot de passe oublié », configurer un service d'envoi dans *Authentication → Emails → SMTP Settings* (Brevo, Resend…), réactiver *Confirm email*, puis passer `EMAILS` à `true`.
4. Renseigner `config.js` avec le *Project URL* et la clé *anon public* (*Project Settings → API*).
5. **GitHub Pages** : *Settings → Pages → Deploy from a branch → main / (root)*.
6. Ouvrir le site et cliquer sur **Créer mon compte** avec l'adresse déclarée à l'étape 2.

Pour tester en local : `python3 -m http.server 8000` puis ouvrir http://localhost:8000.

## Donner accès à un collègue

Dans le site, onglet **Profil → Équipe et accès** (visible du seul propriétaire) :

1. Ajouter l'adresse e-mail du collègue.
2. Lui envoyer le lien du site : il clique sur **Créer mon compte** avec cette adresse.
3. Le bouton à côté de son adresse le fait passer **Utilisateur** ou **Administrateur** (les administrateurs peuvent importer des questions).
4. La croix retire l'adresse : la personne perd l'accès et disparaît du classement.

## Mot de passe oublié

Sans service d'envoi d'e-mails, le propriétaire réinitialise le mot de passe dans *SQL Editor* avec un mot de passe provisoire :

```sql
update auth.users
   set encrypted_password = extensions.crypt('Provisoire2026', extensions.gen_salt('bf'))
 where email = 'prenom.nom@entreprise.fr';
```

La personne se connecte avec ce mot de passe, puis le change dans **Profil → Mon compte**.

## Sécurité

- La clé Supabase `anon` est publique par conception. Les règles RLS de `schema.sql` font le reste :
  - inscription refusée à toute adresse absente de la liste `members`
  - questions et classement lisibles uniquement par les membres connectés
  - chacun ne modifie que sa propre progression, et ses données de révision restent privées
  - seuls les administrateurs modifient les questions, seul le propriétaire gère la liste et les rôles
  - les adresses e-mail de l'équipe ne sont visibles que du propriétaire.
- Le code du site est public (GitHub Pages sur un dépôt public), mais il ne contient aucune question importée ni aucune donnée d'équipe.

## Tests

```
./tests/sql/run.sh               # schéma et règles d'accès (Postgres local, psql)
node tests/e2e/smoke.mjs         # site complet avec un faux Supabase (Playwright)
```

Les deux s'exécutent aussi à chaque envoi sur GitHub (*Actions*).

## Licence

Tous droits réservés, voir [LICENSE](LICENSE). WeeCert est un outil de révision indépendant, sans lien avec Databricks, Inc.
