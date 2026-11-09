# Schaalbaarheid en migratiepad · Mijn Kookboek

## Huidige productiekeuze

De website wordt als statische PWA via GitHub Pages gepubliceerd. Inloggen en
dagboekgegevens lopen via Supabase Auth en PostgreSQL met Row Level Security.

Het dagelijkse voedingsdagboek blijft voorlopig in één JSONB-document per
account (`nutrition_diaries`). Een `revision`-kolom voorkomt stille
overschrijvingen en `schema_version=1` maakt latere gegevensmigratie expliciet.
Een trigger bewaart maximaal **drie eerdere versies** per account in
`nutrition_diary_history`.

Dit ontwerp beperkt het aantal netwerkverzoeken en werkt goed voor een
persoonlijk dagboek met een beperkt aantal gebruikers. Een volledige
normalisatie nu zou het aantal writes en synchronisatierisico's verhogen zonder
dat er momenteel gebruikersdata zijn. Er is nog geen productietest met echte
gebruikers uitgevoerd.

## Huidige preventieve limieten

De browser berekent vóór het opslaan het aantal UTF-8-bytes van het JSON-
dagboek en weigert een wijziging zodra dit meer dan 1.800.000 bytes zou
opleveren. Vanaf 1.200.000 bytes wordt de gebruiker gewaarschuwd.
PostgreSQL bewaakt daarnaast de bestaande limiet van 2 MiB per dagboek.
Hierdoor worden onnodige synchronisatieconflicten bij zeer grote bestanden
voorkomen. Administratieve statistieken staan in
[monitoring.sql](monitoring.sql).

## Wat we periodiek moeten meten

- **Documentgrootte per account**: `octet_length(diary::text)`. De huidige
  maximale grootte per document is 2 MiB. Waarschuw ruim vóór die grens.
- **Aantal gelijktijdige accounts en updates**: monitor verzoekfouten en
  conflicten bij revisiecontrole.
- **Databasegrootte inclusief drie herstelversies**: voorkom ongewenste groei
  op het Free-abonnement.
- **Synchronisatieduur en foutpercentage**: denk aan mobiele netwerken en
  langere dagboekhistorie.
- **Operationele behoefte**: rapportages over individuele maaltijden,
  historische trends, filters en veel gelijktijdige bewerkingen.

## Voorgesteld genormaliseerd doelmodel

Gebruik bij verdere groei afzonderlijke tabellen:

| Tabel | Belangrijkste velden | Toegangsbeperking |
| --- | --- | --- |
| `nutrition_settings` | `user_id`, doelen, versie | RLS op eigen `user_id` |
| `nutrition_presets` | `user_id`, `slot`, titel, macro's, ingangsdatum | RLS op eigen `user_id` |
| `nutrition_entries` | `user_id`, `entry_id`, `eaten_on`, voedingswaarden, bron | RLS op eigen `user_id` |
| `nutrition_sync_state` | `user_id`, revisie, gewijzigd op | RLS en transactionele controle |

Indices bijvoorbeeld op `(user_id, eaten_on)`, met unieke
`(user_id, entry_id)`. Dat maakt individuele dagupdates en analyse
eenvoudiger, maar vraagt om een **transactionele server-API** die gelijktijdige
wijzigingen behandelt. Alleen opsplitsen zonder nieuwe synchronisatie is geen
verbetering.

## Veilige migratie zonder gegevensverlies

1. Maak expliciete datamodel- en integratietests met echte, geanonimiseerde
   exportbestanden en meerdere accountscenario's.
2. Introduceer genormaliseerde tabellen met RLS en kleinste vereiste rechten.
3. Schrijf een gecontroleerde, herhaalbare eenmalige backfill van JSONB naar
   de nieuwe tabellen; behoud de bestaande JSONB-versie als terugvalmogelijkheid.
4. Vergelijk per account het aantal dagen, maaltijden en macro-totalen.
   Stop bij verschillen.
5. Schakel eerst leesacties om achter een featureflag; behoud rollback.
6. Schakel daarna transactionele schrijf- en synchronisatielogica om.
7. Stop pas met JSONB als de datacontrole, accountisolatie en cross-device tests
   volledig geslaagd zijn.

**Status:** ontwerp en voorbereidend schema-versiebeheer zijn vastgelegd;
deze genormaliseerde tabellen zijn **niet aangemaakt of in productie
geactiveerd**. Dat is bewust: zonder bewezen noodzaak en integratietesten
levert zo'n migratie nu vooral extra risico op.

## Continuïteit

De drie terugzetbare versies zijn **applicatiegeschiedenis**, geen onafhankelijke
databaseback-up. Exporteer geregeld een JSON-bestand. Voor meerdere externe
gebruikers is een eigen SMTP-provider voor de inlogmails nodig en moet het
herstelbeleid bij dataverlies worden vastgesteld. Op Supabase Free is geen
gegarandeerde automatische point-in-time back-up beschikbaar.
