# Beheer en continuïteit – persoonlijk voedingsdagboek

Status: 9 november 2026. De website draait op GitHub Pages, het voedingsdagboek op
Supabase Auth/PostgreSQL (EU-regio). Dit document is een operationeel draaiboek,
geen vastgestelde juridische privacyverklaring.

## E-mailaanmelding voor andere personen

**Niet gereed voor onbeperkte externe aanmeldingen:** de standaardmaildienst
van Supabase is bedoeld voor testen, is beperkt tot vooraf toegestane e-mailadressen
en heeft lage verzendlimieten. Zie
[Supabase – Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Eigenaar moet daarom:
1. Een SMTP-provider en afzenderdomein kiezen (bijv. Resend, Brevo of Postmark).
2. Bij die provider het afzenderdomein verifiëren, inclusief SPF, DKIM en DMARC.
3. In Supabase > Authentication > SMTP de host, poort, gebruikersnaam,
   wachtwoord en het afzenderadres instellen. **Nooit** SMTP-wachtwoorden in
   `cloud-config.js`, `recepten.json` of GitHub opslaan.
4. Een Magic Link naar een **niet aan het projectteam gekoppeld testadres**
   versturen en bevestigen dat de link na inloggen in `voeding.html` landt.
5. De verzendlimiet en botbeveiliging beoordelen onder Authentication >
   Rate Limits/CAPTCHA; de limiet pas na aantoonbare behoefte aanpassen.
6. De algemene bevestigingsmail kort en neutraal houden en niet voorzien
   van persoonlijke voedingsgegevens.

De Supabase Security Advisor meldt momenteel dat bescherming tegen
gelekte wachtwoorden is uitgeschakeld. De website gebruikt nu Magic Links,
maar als je daarnaast wachtwoordaanmeldingen toestaat, beoordeel en activeer
deze optie via Supabase Authentication > Security and Protection.
De waarschuwing is niet hetzelfde als een gevonden datalek.

Deze stappen zijn nog **niet uitgevoerd**. Zonder keuze van provider, domein
en eigen SMTP-inloggegevens kan deze koppeling niet veilig worden geactiveerd.

## Externe, herstelbare back-ups

**Op het Supabase Free-abonnement staan geen automatisch herstelbare
databaseback-ups klaar.** De drie oudere dagboekversies zijn een
applicatiegeschiedenis in dezelfde database en beschermen niet tegen verlies
van de gehele Supabase-database.

Nu beschikbaar:
- Een onbeveiligde JSON-export, bedoeld voor tijdelijk lokaal gebruik.
- Een **versleutelde JSON-export** (AES-256-GCM, PBKDF2-SHA256 met eigen
  wachtzin). De wachtzin wordt niet door de website bewaard.
- Import van beide formaten, met inhoudscontrole en expliciete bevestiging.
- Maximale omvangcontrole om niet herstelbare uploads te voorkomen.

**Praktische werkwijze zolang er geen externe back-updienst is:**
1. Download bij voorkeur wekelijks een versleutelde back-up via
   Voedingsdagboek > Privacy en back-up.
2. Bewaar het bestand op een tweede, privé beheerd opslagmedium of
   cloudaccount buiten GitHub en Supabase.
3. Bewaar de wachtzin apart van het bestand, bijvoorbeeld in een wachtwoordbeheerder.
4. Controleer maandelijks of een back-up wordt herkend en ontsleuteld voordat je
   ooit bestaande registraties overschrijft.
5. Verwijder oude back-ups volgens een later vast te stellen bewaartermijn.

**Nog open:** voor een automatische, onafhankelijke back-up zijn een gekozen
externe opslagbestemming en beveiligd beheer van authenticatiesleutels
nodig, of een betaald Supabase-plan met automatische herstelopties.
Zonder die keuze is automatische off-site back-up **niet actief**.

Referentie:
[Supabase – Database Backups](https://supabase.com/docs/guides/platform/backups).

## Schaalbaarheid en monitoring

Het actuele model bewaart één JSONB-dagboek per account en maximaal drie oudere
versies. Dit is bewust gehandhaafd om onnodige migratierisico's te vermijden.
De volgende maatregelen zijn genomen:
- JSONB-structuurvalidatie en `schema_version`.
- PostgreSQL Row Level Security op beide dagboektabellen.
- Revisiecontrole bij gelijktijdige updates.
- Limiet in de browser van 1.800.000 UTF-8-bytes; PostgreSQL heeft daarnaast
  een harde limiet van 2 MiB per dagboek.
- Zichtbare weergave van de dagboekgrootte en waarschuwing vanaf 1.200.000 bytes.
- Read-only beheerquery in [monitoring.sql](monitoring.sql).

Controleer periodiek omvang, mutatiefouten, accountaantallen en verzoeklimieten.
Voer geen omvangrijke schema-normalisatie uit voordat een transactiegericht
synchronisatieontwerp en echte migratietests beschikbaar zijn.
Het ontwerp voor later staat in [SCALING.md](SCALING.md).

## Privacy en verantwoordelijkheid

De publieke pagina [privacy.html](../privacy.html) beschrijft de huidige
werking, gegevenscategorieën, inlogdienst, synchronisatie, export,
herstelkopieën, bewaargedrag en zelfverwijdering.

Voor formele beschikbaarheid voor derden moet de eigenaar nog invullen:
- Naam en contactadres van de verwerkingsverantwoordelijke;
- Grondslag en eventueel aanvullende vereisten voor bijzondere persoonsgegevens;
- Verwerkersafspraken en internationale doorgiften voor alle leveranciers;
- Concrete bewaartermijnen voor accounts, logboeken en gedownloade back-ups;
- Procedure voor verzoeken tot inzage, correctie, verwijdering en datalekken.

Dit zijn governance-taken; ik heb geen persoonlijke contactgegevens of
privacygrondslagen ingevuld zonder jouw keuze.

## Operationele controle

Na nieuwe releases:
1. Test aanmelden en uitloggen met een testaccount.
2. Test toevoegen, wijzigen en synchroniseren op twee apparaten.
3. Maak een versleutelde export en ontsleutel die zonder een bestaand dagboek
   te overschrijven.
4. Test een netwerkonderbreking en conflict (zonder echte voedingsdata te verliezen).
5. Controleer Supabase Security, Performance en Health Advisors.
6. Controleer GitHub Actions regressietests en PWA-cacheversie.
7. Controleer via [monitoring.sql](monitoring.sql) of geen dagboek dicht bij
   de opslaglimiet komt.
