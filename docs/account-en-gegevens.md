# Mijn account en gegevens

De centrale ingang is `voeding.html#account`, bereikbaar via **Mijn gegevens** in beide hoofdnavigaties. Het scherm gebruikt dezelfde inlogsessie voor het voedingsdagboek en de persoonlijke kookboekgegevens. De bestaande Supabase-tabellen en beveiliging per gebruiker blijven gelden.

## Status en koppeling

Elk onderdeel toont zijn eigen status: opgeslagen, synchroniseren, wacht op verbinding of actie nodig. De eerste koppeling van kookboekgegevens blijft een bewuste keuze. De app voegt bestaande lokale en accountgegevens niet automatisch samen. Een volledige export is pas mogelijk als beide onderdelen voor hetzelfde account beschikbaar zijn. De lokale variant zonder cloud blijft ondersteund.

## Back-up en herstel

De gezamenlijke JSON-back-up heeft `app: mijn-kookboek-alle-gegevens`, `version: 1` en `data: {diary, personal}`. Hij omvat het dagboek, doelen, vaste maaltijden, opgeslagen maaltijden, favorieten, boodschappen, afvinkstatussen, voorraad, notities en kookvoortgang. Receptinhoud, afbeeldingen, inlogsessies en sleutels worden niet geëxporteerd.

De bestaande AES-GCM/PBKDF2-envelop ondersteunt ook het gezamenlijke formaat. De wachtzin blijft uitsluitend in het geheugen tijdens de handeling. Oudere losse dagboek- en kookboekback-ups kunnen via hetzelfde herstelscherm worden ingelezen; een bestand vervangt alleen de onderdelen die erin zitten. De oude losse exportknoppen blijven beschikbaar voor compatibiliteit.

Herstel valideert alle onderdelen vóór een preview. Na bevestiging wordt opnieuw gecontroleerd of account of gegevens zijn gewijzigd. Lokale gegevens en per-account hersteljournals worden samen geschreven, met rollback bij een opslagfout. Pas daarna worden uploads ingepland. Cloudopslag van de twee onderdelen blijft afzonderlijk: bij een netwerkfout blijft het nog niet gesynchroniseerde onderdeel in zijn hersteljournal staan. De interface meldt lokale opslag en cloudsynchronisatie afzonderlijk.

## Conflicten

Een vergelijking toont toevoegen, verwijderen en wijzigen per maaltijd, favoriet, notitie, voorraadproduct of instelling. Een keuze geldt voor een volledige versie. De app controleert account, lokale inhoud, journalnonce en cloudrevisie opnieuw voordat de keuze wordt toegepast. Een verouderde vergelijking moet opnieuw worden geopend. Updates naar de cloud behouden de bestaande vergelijking op revisienummer.

## Controle

- Unit- en regressietests voor gedeelde validatie, rollback, oude formaten en racecondities.
- Browserroute op 390 en 1280 pixels met toegankelijkheidscontrole, export, versleuteling, herstel en herladen.
- Browsercontroles voor opslagfouten, accountwisseling, gewijzigd tabblad, offline hervatten en een verouderde conflictkeuze.
- De overige browserroutes blijven onderdeel van de verplichte kwaliteitscontrole.

Deze stap betreft persoonlijke appbestanden. De apart besproken volledige terugzetproef van de database is geen onderdeel van deze wijziging.
