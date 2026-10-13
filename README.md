# Support ExpSoft — gestion d'incidents portable

Système de tickets d'incident + formulaire « Contacter ExpSoft », à déposer dans
`nicolas-riquier.com/support/`.

- Interface **100 % HTML5 + JavaScript** (aucune bibliothèque, aucun build).
- **Pas de base SQL** : les données sont des fichiers JSON dans `support/data/`.
- Un seul fichier serveur, `api.php`, le « gardien » qui valide et écrit les données.
- **Portable** : zippe le dossier `support/` (données comprises), dézippe-le chez un autre hébergeur, c'est reparti.

## Contenu

```
support/
├── index.html        Espace client : signaler un incident, suivre son ticket, répondre
├── admin.html        Ton espace : traiter les tickets, lire les messages de contact
├── api.php           Le gardien : seul fichier qui écrit dans data/
├── config.php        Réglages (mot de passe admin, e-mail de notification, logiciels)
├── assets/           CSS + JS
└── data/             La base (créée automatiquement)
    ├── tickets.db.php    Tickets
    ├── contacts.db.php   Messages de contact
    ├── meta.db.php       Compteur de numéros de ticket
    └── ratelimit.db.php  Anti-spam (peut être supprimé sans risque)
```

Les fichiers `*.db.php` contiennent du **JSON lisible**, précédé d'une ligne PHP de
protection : si quelqu'un essaie de les ouvrir depuis le web, il reçoit une erreur 404.
La base reste donc privée chez n'importe quel hébergeur, même sans `.htaccess`.

## Installation

1. Ouvre `support/config.php` et règle au minimum :
   - `admin_password` : ton mot de passe admin (la connexion est refusée tant qu'il vaut `change-moi`) ;
   - `notify_email` : ton e-mail pour être prévenu des nouveaux tickets (ou `''`) ;
   - `softwares` : la liste de tes logiciels.
2. Envoie le dossier `support/` sur ton site (FTP).
3. Vérifie que le dossier `support/data/` est **inscriptible** par le serveur (droits 755 ou 775).
4. C'est en ligne :
   - clients : `https://nicolas-riquier.com/support/`
   - admin : `https://nicolas-riquier.com/support/admin.html`

**Prérequis :** un hébergement avec PHP 8.1 ou plus (le cas de quasiment tous les hébergeurs).
Aucune base de données à créer.

## Liens utiles depuis le reste du site

- Bouton contact direct : `support/index.html#contact`
- Accès direct au suivi : `support/index.html#suivi`

## Fonctionnement

**Client**
1. Remplit le formulaire (logiciel, gravité, description).
2. Reçoit un **n° de ticket** (`EXP-2026-0001`) et un **code d'accès** (aussi mémorisés dans son navigateur).
3. Suit son ticket et répond au support avec ce n° + code.

**Toi (admin)**
- Tickets non lus et bloquants en premier, recherche, filtre par statut.
- Réponse + changement de statut : `Nouveau → En cours → Attente client → Résolu → Fermé`.
- Quand le client répond à un ticket « Attente client » ou « Résolu », il repasse « En cours ».
- Messages de contact : lu / non lu / suppression, réponse par e-mail en un clic.
- Bouton **Sauvegarde** : télécharge toute la base dans un fichier JSON.

## Migration d'hébergeur

1. Télécharge le dossier `support/` complet (FTP), `data/` compris.
2. Dépose-le chez le nouvel hébergeur.
3. Vérifie les droits d'écriture sur `data/`.

Tickets, historique et numérotation sont conservés.

## Sécurité

- Le code d'accès client est stocké **haché** (comme un mot de passe) : même avec la base, on ne le retrouve pas.
- Tout le texte affiché passe par `textContent` : pas d'injection HTML/JS possible.
- Admin protégé par mot de passe + session (cookie `HttpOnly`, `SameSite=Strict`).
- Le gardien n'accepte que des requêtes JSON, ce qui bloque les attaques de type CSRF.
- Anti-spam : champ piège invisible + limites par IP (5 tickets/heure, 5 contacts/heure,
  10 essais de connexion admin et 20 essais de code ticket par 15 minutes).
- `data/.htaccess` interdit en plus l'accès au dossier sur les serveurs Apache.

## Tester en local

```bash
php -S 127.0.0.1:8000
# puis ouvrir http://127.0.0.1:8000/support/
```
