# Onafhankelijke versleutelde database-back-ups

**Status: technisch voorbereid, maar niet geactiveerd.**

De repo bevat een GitHub Actions-workflow die, zodra beide vereiste
GitHub Actions-secrets zijn ingesteld **en een eerste handmatige test is
geslaagd**, kan worden ingepland om iedere dag om **03.17 UTC** een
PostgreSQL-dump te maken van de Supabase-schema's `public`, `auth` en `storage`.
Tot die test is de dagelijkse planning bewust uitgeschakeld om geen
mislukte of schijnbaar geslaagde geplande back-ups te suggereren.
De dump wordt tijdens het streamen met AES-256-GCM versleuteld en alleen
**als versleuteld GitHub Actions-artifact** bewaard, 30 dagen lang.
De originele database en het voedingsdagboek worden niet gewijzigd.

Dit is opslag buiten Supabase. Het is geen dienst met een afzonderlijke
beschikbaarheidsgarantie en is niet hetzelfde als managed PITR of een volledige
verified restore. Een openbaar GitHub-project kan versleutelde artifacts
zichtbaar/downloadbaar maken voor mensen met toegangsrechten tot de workflows.
Zonder de geheime 256-bit sleutel zijn de inhoud en authenticatietag niet
bruikbaar. Bewaar de sleutel ook buiten GitHub, in een wachtwoordbeheerder.

## Eenmalige activatie (twee secrets)

Open het GitHub-project:

[Settings > Secrets and variables > Actions](https://github.com/rikschipper798-lgtm/Mijn-kookboek/settings/secrets/actions)

Voeg **Repository secrets** toe:

| Secret | Waarde | Waar te vinden |
| --- | --- | --- |
| `SUPABASE_BACKUP_DB_URL` | PostgreSQL-connectiestring van het Supabase-project `Mijn Kookboek`, inclusief databasewachtwoord, bij voorkeur de **Session Pooler** over TLS | Supabase Dashboard > Project > Connect |
| `BACKUP_ENCRYPTION_KEY_BASE64` | Nieuw, sterk willekeurig 32-byte encryptiegeheim in Base64-formaat | Genereer uitsluitend op je eigen apparaat: `openssl rand -base64 32` |

Gebruik voor de connection string de Session Pooler die een GitHub Actions-runner
via IPv4 kan bereiken. Een direct database-adres kan in sommige netwerken
alleen IPv6 ondersteunen. Gebruik `sslmode=require` of strengere verificatie
als de provider die ondersteunt; controleer de TLS-instellingen van je provider.

**Deel deze twee geheimen nergens in ChatGPT, openbare code, screenshots,
logbestanden of een GitHub issue.** De actie gebruikt ze alleen tijdens de
geplande runner-uitvoering.

De repository bevat geen cloud-secret, databasewachtwoord of export van
bestaande gebruikersgegevens.

## Eerste test en activeren

1. Open [Actions > Versleutelde databaseback-up](https://github.com/rikschipper798-lgtm/Mijn-kookboek/actions/workflows/backup-database.yml).
2. Kies **Run workflow**, nadat beide secrets zijn ingesteld.
3. Controleer of de job slaagt en **het versleutelde artifact** aanwezig is.
4. Download dit artifact. Het bevat een `.mkbak`-bestand, geen platte
   SQL/JSON-inhoud.
5. Bewaar de Base64-sleutel afzonderlijk en test het `.mkbak`-bestand op
   je eigen apparaat:
   ```bash
   export BACKUP_ENCRYPTION_KEY_BASE64='[je eigen sleutel uit wachtwoordbeheerder]'
   node scripts/backup-database.cjs verify mijn-kookboek-YYYYMMDDTHHMMSSZ.mkbak
   node scripts/backup-database.cjs decrypt mijn-kookboek-YYYYMMDDTHHMMSSZ.mkbak mijn-kookboek.dump
   pg_restore --list mijn-kookboek.dump
   ```
6. Verwijder na controle `mijn-kookboek.dump` van het apparaat; het is
   **niet versleuteld** en bevat mogelijk accounts en gevoelig database-inhoud.
7. Test desgewenst de herstelbaarheid in een **tijdelijk gescheiden Supabase-
   testproject**. Voer geen ongeteste `pg_restore` uit op de live database.
8. Laat na een geslaagde handmatige test de twee uitgecommentarieerde
   `schedule`-regels in `.github/workflows/backup-database.yml`
   activeren. De workflow draait vanaf dan dagelijks op de standaardbranch.
9. Controleer wekelijks of er daadwerkelijk recente artifacts zijn.
   GitHub kan geplande workflows vertragen of bij langdurige inactiviteit
   uitschakelen. Als die controle uitblijft, zijn de back-ups niet gegarandeerd.

De workflow gebruikt `postgres:17.11`, passend bij de huidige
PostgreSQL-majorversie. Update deze image indien de Supabase-database later
naar een nieuwere majorversie wordt gebracht.

## Wat zit er in deze back-up?

Een `pg_dump --format=custom` van de schema's `auth`, `public` en
`storage`, inclusief de app-dagboekrecords en huidige gebruikersidentiteiten.
De dump wordt **niet** aan `recepten.json` toegevoegd of als leesbaar artifact
gepubliceerd.

Niet inbegrepen: GitHub-receptcode (die staat al in de repository),
configuraties/secret values buiten de database, fysieke Supabase Storage-
objecten en mogelijk andere niet-geselecteerde schema's. Een volledig herstel
van een Supabase-project kan aanvullende providerstappen vereisen.

De decryptiesleutel en de GitHub Actions-secrets zijn nodig voor herstel.
Bij sleutelloss of een beschadigd bestand is herstel niet mogelijk. Alleen
cryptografische integriteit controleren is niet hetzelfde als testen of alle
tabellen na restore correct werken.

## Kosten en beperkingen

- Supabase Free levert zelf geen dagelijkse automatische databaseback-ups.
- GitHub Actions-artifacts hebben een tijdelijke bewaartermijn, hier 30 dagen;
  ze zijn bedoeld als tussentijdse, onafhankelijke herstelkopie.
- Gratis gebruik is onderworpen aan GitHub Actions-opslag- en gebruikslimieten.
- Er staat **nog geen werkende automatische back-up** aan zolang de secrets
  niet zijn ingesteld, de eerste workflowrun niet is gecontroleerd en de
  dagelijkse planning niet is ingeschakeld.
- Voor langdurige en onafhankelijke dataretentie of een hogere
  herstelgarantie kies je later een externe storageprovider of Supabase Pro,
  met expliciete kosten- en privacyafspraken.

## Beveiligingskeuzes

- Geen secrets in de repository.
- Minimale GitHub-workflowrechten: `contents: read`.
- AES-256-GCM met nieuw willekeurig IV per dump, 256-bit secret in Actions.
- GCM-integriteitstest vóór het bewaren als artifact.
- Alleen versleutelde bestanden als artifact.
- Geen directe wijzigingen aan de live database.
- Ingrijpende restore alleen na aparte test en autorisatie.

De Node-tool `scripts/backup-database.cjs` bevat de verificatie en decryptie.
De 7 regressietests staan in `tests/backup-database.test.cjs`.
