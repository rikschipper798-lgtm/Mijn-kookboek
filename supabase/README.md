# Persoonlijke accounts en cloudsync voor het voedingsdagboek

**Status 9 november 2026:** De eigenaar heeft bevestigd dat de Auth Redirect URL is ingesteld; daarop is de cloudkoppeling geactiveerd via `cloud-config.js` (`active: true`). Supabase-project, beveiligde database en RLS zijn ingericht en gecontroleerd. De **echte magic-link-login en synchronisatie op twee apparaten** moeten nog met een gebruikersaccount worden getest.

## Betrouwbaarheid van cloudsync – herstelbare wachtrij

De implementatie bewaart iedere nieuwe dagboekstand vooraf als complete,
gebruikersgebonden herstelkopie in `localStorage`. De opslagcode gebruikt de
Supabase-project-URL en het ID van de ingelogde gebruiker als sleutel, zodat
de herstelstatus van accounts gescheiden blijft.

1. Een nieuwe of aangepaste maaltijd wordt eerst synchroon in de lokale
   herstelkopie opgeslagen; alleen bij succes wordt de wijziging getoond.
2. De browser synchroniseert daarna met Supabase via `revision`-controle.
   Niet bevestigde wijzigingen blijven lokaal aanwezig.
3. Na bevestigde upload wordt de lokale kopie pas gewist als de juiste
   opgeslagen versie nog dezelfde is. Verandert de inhoud tijdens de upload,
   dan wordt de nieuwe versie opnieuw veilig ingepland.
4. Na een browserherstart leest de app eerst de cloudversie en kijkt daarna
   naar een bestaande herstelkopie van dit account. Bij een verschil tussen
   server- en lokale revisie wordt geen automatische overschrijving gedaan.
5. Als de cloud niet bereikbaar is maar er een geldige opgeslagen sessie én
   herstelkopie zijn, kan het lokale dagboek worden geopend. Voor de
   eerstvolgende upload wordt de serverrevisie opnieuw gecontroleerd.
6. Bij een conflict exporteert de gebruiker eerst het dagboek en kan daarna
   bewust de cloudversie herstellen. De knop **Download dagboekback-up**
   staat ook direct bovenaan bij het persoonlijke account. Er vindt
   **geen automatische samenvoeging** van verschillende apparaten plaats.

Een browser kan lokale gegevens verwijderen (bijvoorbeeld door
privémodus, opslagopschoning of apparaatverlies). Een lokale herstelkopie is
daarom **geen volledige back-up**. Bewaar waar nodig een exportbestand.
Andere tabbladen worden gecontroleerd op wijzigingen aan dezelfde
herstelkopie; bij een conflict wordt het bewerken geweigerd in plaats van
een nieuwere lokale kopie zonder waarschuwing te vervangen.

De oplossing werkt zonder nieuwe database- of API-tabellen en behoudt
de bestaande RLS-rechten. Dit beperkt het risico bij bestaande accounts.

**Tests:** `tests/cloud-diary.test.cjs` bevat scenario's voor opslagfouten,
tijdelijke netwerkuitval, herstart tijdens offline gebruik, oude revisies,
twee apparaten, twee tabbladen, accountisolatie en browsercrashes na
serverbevestiging. Deze tests gebruiken een gesimuleerde Supabase-client;
een echte end-to-end-test met e-mailaanmelding is aanvullend nodig.

## Architectuur

- De receptenwebsite blijft statisch op GitHub Pages.
- Supabase Auth stuurt een eenmalige inloglink per e-mail.
- Na inloggen laadt de browser de eigen rij uit `public.nutrition_diaries`.
- PostgreSQL Row Level Security (RLS) beschermt de data per `auth.uid()`.
- De app bewaart een revisienummer en voert updates alleen uit bij de
  verwachte revisie. Bij gelijktijdige wijzigingen op twee apparaten wordt
  geen stille overschrijving gedaan: de gebruiker ziet een waarschuwing en
  kan zijn lokale gegevens exporteren voordat de cloudversie wordt herladen.
- De inhoud wordt **niet** toegevoegd aan `recepten.json` of de openbare repository.

**Inbegrepen in cloudsync:** voedingsdoelen, dagregistraties en vaste
werkdagmaaltijden uit het voedingsdagboek.

**Niet inbegrepen:** recepten, favorieten, boodschappenlijsten, voorraad,
persoonlijke kooknotities en de kookmodus. Die zijn nu nog lokaal.

## Ingestelde Auth Redirect URL (nog live te testen)

Open in het bestaande project **Mijn Kookboek** het Supabase-dashboard:
[Authentication > URL Configuration](https://supabase.com/dashboard/project/usppeputwknbxayekufe/auth/url-configuration).

Stel in en bewaar:

- **Site URL:** `https://rikschipper798-lgtm.github.io/Mijn-kookboek/voeding.html`
- **Redirect URL:** `https://rikschipper798-lgtm.github.io/Mijn-kookboek/voeding.html`

De gebruiker heeft gemeld deze instelling te hebben opgeslagen. De URL voor de inloglink moet exact worden toegestaan; anders kan Supabase
de gebruiker naar een verkeerde pagina sturen. Controleer vervolgens onder
**Authentication > Sign In / Providers** dat **Email** ingeschakeld is.
Deze instellingen kunnen niet via de beschikbare databaseconnector worden
uitgelezen of gewijzigd. De accountfunctie is inmiddels geactiveerd; controleer de
redirect door zelf een inloglink aan te vragen en te openen.

De overige stappen zijn uitgevoerd:
- Supabase-project: `usppeputwknbxayekufe` (EU-central-1).
- `public.nutrition_diaries` met `user_id`, JSONB-dagboek en revisienummer.
- RLS ingeschakeld met eigen-accountbeleid voor SELECT/INSERT/UPDATE.
- Geen anonieme API-toegang tot deze tabel.
- Publieke URL en **publishable key** staan al in de GitHub-configuratie.
- De activeringsschakelaar in `cloud-config.js` staat op `active: true`.
- Security Advisors leverden na het toepassen van de configuratie geen meldingen.

**Na activering**: maak eerst vanuit het lokale dagboek een JSON-back-up en
log vervolgens eenmalig in. Voor een nieuw account zonder cloudgegevens
vraagt de pagina of het huidige lokale dagboek moet worden meegenomen.

**BELANGRIJK:** Gebruik nooit een Supabase secret key, service_role key,
databasewachtwoord of persoonlijke API-token in JavaScript op GitHub Pages,
in GitHub-code of in screenshots. Alleen de publieke publishable key hoort
in `cloud-config.js`. Veiligheid komt uit Supabase Auth + database-RLS,
niet uit het verbergen van de publieke sleutel.

## Bestaande lokale gegevens overnemen

- **Maak eerst een back-up** vanuit het bestaande voedingsdagboek.
- Bij de eerste login op een nieuw account **zonder cloudgegevens** vraagt
  de app expliciet of je het bestaande lokale dagboek wilt overnemen.
- Als er al een cloud-dagboek is, heeft de cloudversie voorrang; de lokale
  gegevens worden niet stilzwijgend overgeschreven of vermengd met een
  andere account.
- Als je ooit op hetzelfde apparaat van account wisselt, wordt het vorige
  persoonlijke dagboek uit het actieve scherm verwijderd.
- Na uitloggen moet je opnieuw inloggen om het clouddagboek te openen.

## Betrouwbaarheid en beperkingen

- Voor synchronisatie is internet nodig. De recepten kunnen via de bestaande
  PWA offline beschikbaar zijn, maar **cloudregistraties niet gegarandeerd**.
- Bij een mislukte synchronisatie staan nog niet opgeslagen wijzigingen
  voorlopig alleen op het open scherm. De app waarschuwt bij het verlaten
  van de pagina en laat de status zien. Gebruik dan de exportfunctie.
- Bij een updateconflict tussen apparaten wordt niet automatisch samengevoegd;
  exporteer eerst de lokale versie en kies daarna bewust de cloudversie.
- De gebruiker moet toegang hebben tot zijn e-mail om in te loggen.
- Er is nog geen zelfbedieningsknop om het cloudaccount en alle persoonlijke
  gegevens definitief te verwijderen. Richt een verwijderprocedure in
  vóórdat je anderen uitnodigt om hun data op te slaan.
- Een account zorgt niet voor automatische synchronisatie van andere
  persoonlijke kookboekgegevens zoals favorieten en kookervaringen.

## Technische controle

```sh
node --test tests/cloud-diary.test.cjs
```

Deze test controleert accountisolatie in de client, eenmalige migratie,
optimistische revisiecontrole en de aanwezigheid van RLS-beleid in
`schema.sql`. Het zijn **geen echte integratietests op een Supabase-project**.
Controleer de daadwerkelijk toegepaste RLS-policies altijd afzonderlijk
met twee ingelogde testaccounts.

Officiële referenties:
- [Supabase Auth: passwordless](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Auth: redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase JS installeren](https://supabase.com/docs/reference/javascript/installing)
