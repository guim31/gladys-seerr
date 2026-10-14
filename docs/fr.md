# Overseerr / Jellyseerr

Suivez dans Gladys les demandes de films et de séries de votre foyer : ce qui
attend votre approbation, ce qui est en cours de téléchargement, ce qui vient
d'arriver dans la médiathèque, et les problèmes signalés par vos utilisateurs.
Fonctionne avec **Overseerr** (Plex), **Jellyseerr** (Jellyfin, Emby, Plex) et
**Seerr** (leur successeur) : les trois partagent la même API.

C'est le compagnon de l'intégration « Sonarr & Radarr », qui suit les
téléchargements eux-mêmes ; celle-ci suit les demandes de vos utilisateurs.

> Testée contre de vrais serveurs Overseerr 1.35.0, Jellyseerr 2.7.3 et
> Seerr 3.5.0, mais pas encore sur une installation complète (Plex ou Jellyfin,
> Sonarr, Radarr et Gladys ensemble) : retours bienvenus sur
> [GitHub](https://github.com/guim31/gladys-seerr/issues).

## Prérequis

- Gladys Assistant 5.1.0 ou plus récent.
- Un serveur Overseerr, Jellyseerr ou Seerr que Gladys peut joindre sur votre
  réseau (par exemple `http://192.168.1.2:5055`).
- Sa clé d'API : dans l'interface web, **Settings → General → API Key**. La clé
  agit comme l'administrateur du serveur : gardez-la pour vous.

## Configuration

Intégrations → Overseerr / Jellyseerr → Configuration :

- **Adresse** : l'adresse IP ou le nom du serveur avec son port, et sa base
  d'URL s'il est derrière un reverse proxy (`https://example.org/overseerr`).
  Une adresse copiée depuis le navigateur fonctionne aussi.
- **Clé d'API** : voir plus haut.
- **Nom** : le nom de l'appareil dans Gladys. Vide : le nom de l'application
  suivi de l'adresse.
- Un **second serveur** est facultatif : une instance 4K, ou un Jellyseerr à
  côté d'un Overseerr.
- **Autoriser l'approbation et le refus** : décoché par défaut. Coché, les
  actions de scène et les boutons du widget peuvent approuver ou refuser la
  demande en attente la plus récente. Décoché, Gladys ne fait que lire.
- **Accepter les certificats auto-signés** : pour une adresse en `https://`
  servie avec votre propre certificat.
- **Intervalle de rafraîchissement** : de 30 secondes à 10 minutes (1 minute
  par défaut).
- **Langue des textes** : les noms des fonctionnalités (donnés à l'ajout de
  l'appareil, puis figés par Gladys), les titres des films et séries, et les
  mots envoyés aux scènes. Français par défaut.

**Tester la connexion** lit chaque serveur maintenant et indique ce qu'il
trouve.

Ensuite, dans l'onglet **Découverte**, ajoutez à Gladys l'appareil de chaque
serveur.

## Appareil

Un appareil par serveur, en lecture seule :

| Fonctionnalité                    | Ce qu'elle indique                                                      |
| --------------------------------- | ----------------------------------------------------------------------- |
| En ligne                          | 1 tant que le serveur répond                                            |
| Demandes en attente d'approbation | Demandes que personne n'a encore approuvées ni refusées                 |
| Demandes approuvées en cours      | Approuvées, pas encore dans la médiathèque                              |
| Demandes disponibles              | Approuvées et dans la médiathèque                                       |
| Demandes en échec                 | Sonarr ou Radarr les a refusées                                         |
| Total des demandes                | Toutes les demandes, quel que soit leur état                            |
| Problèmes ouverts                 | Problèmes signalés par les utilisateurs, pas encore résolus             |
| Dernière demande                  | Titre de la demande la plus récente                                     |
| Dernier demandeur                 | Qui l'a faite                                                           |
| Version                           | Version du serveur                                                      |
| Mise à jour disponible            | 1 quand le serveur annonce une nouvelle version (Overseerr, Jellyseerr) |

Les compteurs gardent leur historique : un graphique des demandes en attente
montre combien de temps votre famille attend.

## Déclencheurs de scène

- **Nouvelle demande** : quelqu'un a demandé un film ou une série. Filtres :
  serveur, films ou séries, état (en attente d'approbation, ou approuvée
  d'office pour les utilisateurs qui en ont le droit), demandeur. Informations
  transmises à la scène : titre, film ou série, demandeur, état, saisons,
  demande en 4K, numéro de la demande.
- **Demande disponible** : un film demandé, ou toutes les saisons demandées
  d'une série, est maintenant dans la médiathèque. Filtres : serveur, films ou
  séries, demandeur. Informations : titre, film ou série, demandeur, demande en
  4K.
- **Nouveau problème signalé** : un utilisateur a signalé un problème sur un
  film ou un épisode. Filtres : serveur, films ou séries, type (vidéo, audio,
  sous-titres, autre). Informations : titre, type, auteur du signalement, son
  message, saison et épisode.

Chaque événement est annoncé une fois, y compris après un redémarrage de
l'intégration : ce qu'elle connaissait déjà n'est pas annoncé à nouveau. Une
demande ou un problème créé plus d'une heure avant sa lecture (l'intégration
était arrêtée) n'est pas annoncé comme nouveau ; une arrivée l'est toujours.

## Actions de scène

Elles demandent **Autoriser l'approbation et le refus** ; sinon elles échouent
avec un message qui dit où l'activer.

- **Approuver la dernière demande** : approuve la demande en attente la plus
  récente, sur un serveur ou n'importe lequel, films, séries ou les deux. Le
  serveur l'envoie alors à Sonarr ou Radarr, comme quand vous l'approuvez dans
  son interface.
- **Refuser la dernière demande** : la refuse. Une demande refusée peut encore
  être approuvée plus tard dans l'interface d'Overseerr ou de Jellyseerr.

Résultats transmis aux actions suivantes : si une demande a été trouvée
(aucune en attente n'est pas une erreur), son titre, son demandeur, film ou
série.

## Widget

**Demandes de médias** : trois tuiles (à approuver, en cours, problèmes
ouverts), les huit demandes les plus récentes avec leur affiche, leur demandeur
et leur état (en attente, approuvée, en partie, disponible, refusée, en échec),
et une ligne par serveur avec sa version. Tous les serveurs, ou celui choisi
dans les réglages du widget.

Avec **Autoriser l'approbation et le refus**, une légende nomme la demande en
attente la plus récente et deux boutons agissent sur elle : **Approuver** et
**Refuser**, chacun demandant d'abord une confirmation.

Les affiches viennent du serveur lui-même (son cache d'images) : ni votre
navigateur ni l'intégration ne contactent TMDB.

## Exemples de scènes

- **Prévenir le demandeur** : déclencheur « Demande disponible », demandeur
  `alice` ; action « Envoyer un message » à Alice, avec le titre choisi dans
  les informations de la scène : « … est disponible, bon visionnage ! ».
- **Approuver les demandes des enfants en journée** : déclencheur « Nouvelle
  demande », état en attente d'approbation, demandeur `leo` ; condition : entre
  9 h et 20 h ; action « Approuver la dernière demande ».
- **Un problème de sous-titres** : déclencheur « Nouveau problème signalé »,
  type Sous-titres ; action « Envoyer un message » à l'administrateur avec le
  titre et le message.
- **Résumé du matin** : chaque jour à 8 h, envoyer la valeur de « Demandes en
  attente d'approbation » quand elle dépasse 0.

## Utilisation de l'API

- Tout reste sur votre réseau : l'intégration ne parle qu'à l'API locale de
  votre serveur, avec la clé d'API dans l'en-tête `X-Api-Key` (jamais dans une
  adresse, jamais dans les journaux).
- Une lecture = deux petites requêtes (`/request/count`, `/issue/count`). La
  liste des 50 demandes les plus récentes et des 20 derniers problèmes n'est
  lue que quand ces compteurs bougent, et toutes les 10 minutes de toute façon ;
  la version une fois par heure. Chaque lecture de la liste fait demander au
  serveur leurs profils de qualité à Sonarr et Radarr : gardez un intervalle de
  rafraîchissement raisonnable.
- Les titres et affiches sont demandés au serveur (qui les demande une fois à
  TMDB et les garde), pour les demandes les plus récentes et les événements
  seulement.
- L'intégration garde dans `/data/seerr-state.json` les derniers numéros de
  demande et de problème vus et les demandes qui attendent leur média. Aucun
  mot de passe, aucune clé.

## Dépannage

- **« clé d'API refusée »** : recopiez la clé depuis Settings → General. Une
  nouvelle clé générée sur le serveur invalide l'ancienne.
- **« ne répond pas »** : vérifiez l'adresse et le port (5055 par défaut), et
  que Gladys peut joindre le serveur (même réseau, pare-feu, réseau Docker).
- **« certificat refusé »** : cochez **Accepter les certificats auto-signés**,
  ou utilisez l'adresse en `http://` de votre réseau.
- **« l'adresse redirige »** : saisissez l'adresse finale, avec sa base d'URL.
- **Titres affichés « Film n° 550 »** : le serveur n'a pas pu joindre TMDB à
  ce moment-là ; les titres reviennent seuls quelques minutes plus tard.
- **Aucun événement** : les événements concernent ce qui se passe après le
  démarrage de l'intégration ; lancez **Tester la connexion** pour voir ce que
  répond le serveur. Pour plus de détails, réglez `LOG_LEVEL=debug` sur
  l'intégration et lisez ses journaux.

## Limites

- Seules les 50 demandes les plus récentes sont suivies jusqu'à leur arrivée :
  dans une installation avec plus de demandes en attente à la fois, les plus
  anciennes ne sont pas annoncées à leur arrivée.
- Une série est annoncée disponible quand toutes les saisons de la demande sont
  dans la médiathèque ; une demande pour une saison d'une série déjà en partie
  présente est annoncée de la même façon.
- Pas de webhook : Overseerr sait pousser des notifications, mais Gladys lance
  l'intégration sans port entrant. Un événement apparaît donc en un intervalle
  de rafraîchissement (l'arrivée d'une saison : en 10 minutes au plus).
- L'approbation agit comme l'administrateur du serveur (la clé d'API) ; un
  refus ne supprime jamais rien. Aucune autre modification n'est faite sur le
  serveur.
- Le filtre sur le demandeur compare le nom exactement tel qu'Overseerr
  l'affiche.
- Sans lien avec les projets Overseerr, Jellyseerr ou Seerr.
