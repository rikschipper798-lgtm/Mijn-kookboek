# Persoonlijke accounts en cloudsync voor het voedingsdagboek

Status: **de broncode is voorbereid**, maar **cloudsync staat standaard uit**
omdat er nog geen Supabase-project/configuratie gekoppeld is.
De bestaande lokale pagina blijft werken.

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

## Eénmalig configureren

1. Maak een eigen [Supabase-project](https://supabase.com/dashboard/projects)
   aan. Kies bij voorkeur een EU-regio en controleer het privacybeleid,
   bewaartermijnen en de voorwaarden van je databaseprovider.
2. Open **SQL Editor** in dat project en voer de complete inhoud van
   [schema.sql](./schema.sql) uit.
3. Controleer dat de tabel `public.nutrition_diaries` bestaat, dat RLS is
   ingeschakeld en dat de policies voor `SELECT`, `INSERT`, `UPDATE` elk
   uitsluitend de eigen `user_id = auth.uid()` toestaan.
4. Open in Supabase **Authentication > URL Configuration** en stel in:

   - **Site URL:** `https://rikschipper798-lgtm.github.io/Mijn-kookboek/voeding.html`
   - **Redirect URL:** `https://rikschipper798-lgtm.github.io/Mijn-kookboek/voeding.html`

5. Laat de e-mailinlogmethode ingeschakeld via **Authentication > Providers**.
   Test de Magic Link-e-mail. Voor productie/meerdere gebruikers kan een
   eigen SMTP-provider nodig zijn vanwege standaard verzendlimieten.
6. Ga naar **Project Settings > API** (of het betreffende Connect-scherm
   voor je Supabase-versie). Neem alleen de **Project URL** en de
   **publishable key** over.
7. Vul in het publieke bestand `cloud-config.js` uitsluitend die twee
   waarden in:

   ```js
   window.COOKBOOK_CLOUD_CONFIG = {
     url: "https://PROJECT-REF.supabase.co",
     publishableKey: "sb_publishable_xxxxxxxxxxx"
   };
   ```

8. Sla dit bestand op in GitHub. De cloud-login verschijnt in
   [voedingsdagboek](https://rikschipper798-lgtm.github.io/Mijn-kookboek/voeding.html)
   nadat de nieuwe versie is geladen. Test met twee verschillende
   e-mailaccounts in twee browsers; ieder account moet uitsluitend zijn
   eigen waarden zien.

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
