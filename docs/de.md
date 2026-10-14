# Overseerr / Jellyseerr

Verfolge in Gladys die Film- und Serienanfragen deines Haushalts: was auf deine
Freigabe wartet, was gerade heruntergeladen wird, was neu in der Mediathek
angekommen ist, und die Probleme, die deine Benutzer melden. Funktioniert mit
**Overseerr** (Plex), **Jellyseerr** (Jellyfin, Emby, Plex) und **Seerr**
(ihrem Nachfolger): Alle drei teilen dieselbe API.

Diese Integration begleitet die Integration „Sonarr & Radarr“, die die Downloads
selbst verfolgt; diese hier verfolgt die Anfragen deiner Benutzer.

> Getestet mit echten Servern Overseerr 1.35.0, Jellyseerr 2.7.3 und
> Seerr 3.5.0, aber noch nicht in einer vollständigen Installation (Plex oder
> Jellyfin, Sonarr, Radarr und Gladys zusammen): Rückmeldungen willkommen auf
> [GitHub](https://github.com/guim31/gladys-seerr/issues).

## Voraussetzungen

- Gladys Assistant 5.1.0 oder neuer.
- Ein Overseerr-, Jellyseerr- oder Seerr-Server, den Gladys in deinem Netzwerk
  erreicht (zum Beispiel `http://192.168.1.2:5055`).
- Sein API-Schlüssel: in der Weboberfläche unter **Settings → General → API
  Key**. Der Schlüssel handelt als Administrator des Servers: Behalte ihn für
  dich.

## Konfiguration

Integrationen → Overseerr / Jellyseerr → Konfiguration:

- **Adresse**: die IP-Adresse oder der Name des Servers mit Port und ggf. die
  URL-Basis hinter einem Reverse-Proxy (`https://example.org/overseerr`). Eine
  aus dem Browser kopierte Adresse funktioniert auch.
- **API-Schlüssel**: siehe oben.
- **Name**: der Name des Geräts in Gladys. Leer: der Name der Anwendung,
  gefolgt von der Adresse.
- Ein **zweiter Server** ist optional: eine 4K-Instanz oder ein Jellyseerr
  neben einem Overseerr.
- **Freigeben und Ablehnen erlauben**: standardmäßig aus. Aktiviert können die
  Szenenaktionen und die Widget-Schaltflächen die neueste wartende Anfrage
  freigeben oder ablehnen. Aus: Gladys liest nur.
- **Selbstsignierte Zertifikate akzeptieren**: für eine `https://`-Adresse mit
  deinem eigenen Zertifikat.
- **Aktualisierungsintervall**: von 30 Sekunden bis 10 Minuten (standardmäßig
  1 Minute).
- **Sprache der Texte**: die Namen der Funktionen (beim Hinzufügen des Geräts
  vergeben, danach von Gladys festgeschrieben), die Titel der Filme und Serien
  und die an Szenen gesendeten Wörter. Standardmäßig Französisch.

**Verbindung testen** liest jeden Server sofort und meldet, was er findet.

Füge anschließend im Tab **Entdecken** das Gerät jedes Servers zu Gladys hinzu.

## Gerät

Ein Gerät pro Server, nur lesend:

| Funktion                             | Was sie anzeigt                                                     |
| ------------------------------------ | ------------------------------------------------------------------- |
| Online                               | 1, solange der Server antwortet                                     |
| Anfragen, die auf Freigabe warten    | Anfragen, die noch niemand freigegeben oder abgelehnt hat           |
| Freigegebene Anfragen in Bearbeitung | Freigegeben, noch nicht in der Mediathek                            |
| Verfügbare Anfragen                  | Freigegeben und in der Mediathek                                    |
| Fehlgeschlagene Anfragen             | Sonarr oder Radarr hat sie abgelehnt                                |
| Anfragen insgesamt                   | Alle Anfragen, egal in welchem Status                               |
| Offene Probleme                      | Von Benutzern gemeldete, noch nicht gelöste Probleme                |
| Letzte Anfrage                       | Titel der neuesten Anfrage                                          |
| Zuletzt angefragt von                | Wer sie gestellt hat                                                |
| Version                              | Version des Servers                                                 |
| Update verfügbar                     | 1, wenn der Server eine neue Version meldet (Overseerr, Jellyseerr) |

Die Zähler behalten ihren Verlauf: Ein Diagramm der wartenden Anfragen zeigt,
wie lange deine Familie wartet.

## Szenenauslöser

- **Neue Anfrage**: Jemand hat einen Film oder eine Serie angefragt. Filter:
  Server, Filme oder Serien, Status (wartet auf Freigabe oder sofort
  freigegeben für Benutzer mit diesem Recht), Anfragender. An die Szene
  übergebene Informationen: Titel, Film oder Serie, Anfragender, Status,
  Staffeln, 4K-Anfrage, Nummer der Anfrage.
- **Angefragter Titel verfügbar**: Ein angefragter Film oder alle Staffeln
  einer Serienanfrage sind jetzt in der Mediathek. Filter: Server, Filme oder
  Serien, Anfragender. Informationen: Titel, Film oder Serie, Anfragender,
  4K-Anfrage.
- **Neues Problem gemeldet**: Ein Benutzer hat ein Problem mit einem Film oder
  einer Episode gemeldet. Filter: Server, Filme oder Serien, Art (Video, Audio,
  Untertitel, Sonstiges). Informationen: Titel, Art, wer es gemeldet hat, seine
  Nachricht, Staffel und Episode.

Jedes Ereignis wird einmal gemeldet, auch nach einem Neustart der Integration:
Was sie schon kannte, wird nicht erneut gemeldet. Eine Anfrage oder ein
Problem, das mehr als eine Stunde vor dem Lesen entstand (die Integration war
gestoppt), wird nicht als neu gemeldet; ein Eingang immer.

## Szenenaktionen

Beide brauchen **Freigeben und Ablehnen erlauben**; sonst schlagen sie mit einer
Nachricht fehl, die sagt, wo du es einschaltest.

- **Neueste Anfrage freigeben**: gibt die neueste wartende Anfrage frei, auf
  einem Server oder einem beliebigen, Filme, Serien oder beides. Der Server
  schickt sie dann an Sonarr oder Radarr, wie bei einer Freigabe in seiner
  Oberfläche.
- **Neueste Anfrage ablehnen**: lehnt sie ab. Eine abgelehnte Anfrage kann
  später noch in der Oberfläche von Overseerr oder Jellyseerr freigegeben
  werden.

An die folgenden Aktionen übergebene Ergebnisse: ob eine Anfrage gefunden
wurde (keine wartende ist kein Fehler), ihr Titel, ihr Anfragender, Film oder
Serie.

## Widget

**Medienanfragen**: drei Kacheln (freizugeben, in Bearbeitung, offene
Probleme), die acht neuesten Anfragen mit Poster, Anfragendem und Status
(wartet, freigegeben, teilweise, verfügbar, abgelehnt, fehlgeschlagen) und eine
Zeile pro Server mit seiner Version. Alle Server oder der in den
Widget-Einstellungen gewählte.

Mit **Freigeben und Ablehnen erlauben** nennt eine Beschriftung die neueste
wartende Anfrage, und zwei Schaltflächen wirken auf sie: **Freigeben** und
**Ablehnen**, jeweils mit vorheriger Bestätigung.

Die Poster kommen vom Server selbst (seinem Bildercache): Weder dein Browser
noch die Integration kontaktieren TMDB.

## Szenenbeispiele

- **Den Anfragenden benachrichtigen**: Auslöser „Angefragter Titel verfügbar“,
  Anfragender `alice`; Aktion „Nachricht senden“ an Alice, mit dem Titel aus
  den Szeneninformationen: „… ist verfügbar, viel Spaß!“.
- **Die Anfragen der Kinder tagsüber freigeben**: Auslöser „Neue Anfrage“,
  Status wartet auf Freigabe, Anfragender `leo`; Bedingung: zwischen 9 und
  20 Uhr; Aktion „Neueste Anfrage freigeben“.
- **Ein Untertitelproblem**: Auslöser „Neues Problem gemeldet“, Art
  Untertitel; Aktion „Nachricht senden“ an den Administrator mit Titel und
  Nachricht.
- **Morgendliche Übersicht**: jeden Tag um 8 Uhr den Wert von „Anfragen, die
  auf Freigabe warten“ senden, wenn er über 0 liegt.

## API-Nutzung

- Alles bleibt in deinem Netzwerk: Die Integration spricht nur mit der lokalen
  API deines Servers, mit dem API-Schlüssel im Header `X-Api-Key` (nie in einer
  Adresse, nie in den Protokollen).
- Ein Lesevorgang = zwei kleine Anfragen (`/request/count`, `/issue/count`).
  Die Liste der 50 neuesten Anfragen und der 20 neuesten Probleme wird nur
  gelesen, wenn sich diese Zähler bewegen, und ohnehin alle 10 Minuten; die
  Version einmal pro Stunde. Jedes Lesen der Liste lässt den Server Sonarr und
  Radarr nach ihren Qualitätsprofilen fragen: Halte das
  Aktualisierungsintervall vernünftig.
- Titel und Poster werden beim Server angefragt (der sie einmal bei TMDB holt
  und behält), nur für die neuesten Anfragen und die Ereignisse.
- Die Integration speichert in `/data/seerr-state.json` die zuletzt gesehenen
  Nummern von Anfragen und Problemen und die Anfragen, die auf ihr Medium
  warten. Kein Passwort, kein Schlüssel.

## Fehlerbehebung

- **„API-Schlüssel abgelehnt“**: Kopiere den Schlüssel erneut aus Settings →
  General. Ein neu erzeugter Schlüssel macht den alten ungültig.
- **„antwortet nicht“**: Prüfe Adresse und Port (standardmäßig 5055) und ob
  Gladys den Server erreicht (gleiches Netzwerk, Firewall, Docker-Netzwerk).
- **„Zertifikat abgelehnt“**: Aktiviere **Selbstsignierte Zertifikate
  akzeptieren** oder verwende die `http://`-Adresse in deinem Netzwerk.
- **„die Adresse leitet um“**: Gib die endgültige Adresse mit ihrer URL-Basis
  ein.
- **Titel als „Film Nr. 550“ angezeigt**: Der Server konnte TMDB in dem Moment
  nicht erreichen; die Titel kommen ein paar Minuten später von selbst zurück.
- **Kein Ereignis**: Die Ereignisse betreffen, was nach dem Start der
  Integration passiert; starte **Verbindung testen**, um zu sehen, was der
  Server antwortet. Für mehr Details setze `LOG_LEVEL=debug` für die
  Integration und lies ihre Protokolle.

## Einschränkungen

- Nur die 50 neuesten Anfragen werden bis zu ihrem Eingang verfolgt: In einer
  Installation mit mehr gleichzeitig wartenden Anfragen werden die ältesten bei
  ihrem Eingang nicht gemeldet.
- Eine Serie wird als verfügbar gemeldet, wenn alle Staffeln der Anfrage in der
  Mediathek sind; eine Anfrage für eine Staffel einer schon teilweise
  vorhandenen Serie wird genauso gemeldet.
- Kein Webhook: Overseerr kann Benachrichtigungen senden, aber Gladys startet
  die Integration ohne eingehenden Port. Ein Ereignis erscheint daher innerhalb
  eines Aktualisierungsintervalls (eine eingehende Staffel: innerhalb von
  10 Minuten).
- Das Freigeben handelt als Administrator des Servers (der API-Schlüssel); ein
  Ablehnen löscht nie etwas. Sonst wird nichts am Server geändert.
- Der Filter nach Anfragendem vergleicht den Namen genau so, wie Overseerr ihn
  anzeigt.
- Keine Verbindung zu den Projekten Overseerr, Jellyseerr oder Seerr.
