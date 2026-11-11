# Automatische controles en veilige publicatie

De workflow **Kwaliteitscontrole en publicatie** draait bij iedere pull request,
iedere push naar `main` en na een handmatige start. Er zijn geen padfilters die
controles op bijvoorbeeld een wijziging aan HTML of recepten overslaan.

## Wat wordt gecontroleerd?

- Alle `tests/*.test.cjs`, inclusief persoonlijke synchronisatie en de controle
  die publicatie blokkeert. Nieuwe testbestanden worden automatisch meegenomen.
- JavaScript-syntax, receptgegevens, afbeeldingen en receptversies.
- Acht browseronderdelen: de volledige gebruikersroute, schaalbare porties en
  offline gebruik, persoonlijke gegevens, synchronisatie tussen apparaten,
  back-upherstel, automatische maaltijden, toegankelijkheid en mobiele bediening.
- Het websitepakket bevat alleen de expliciet geselecteerde publieke appbestanden
  en afbeeldingen. Ontwikkelbestanden, databasescripts en back-ups gaan niet mee.

De volledige gebruikersroute test het websitepakket onder een subpad op 390 en
1280 pixels breed: zoeken, vier porties kiezen, boodschappen opslaan en afvinken,
koken afronden, feedback bewaren en een halve portie in het dagboek registreren.
De cloudtests gebruiken gesimuleerde accounts en storingen. Ze veranderen geen
productiegegevens en vervangen geen test van echte e-mailaanmelding of een echte
database-restore.

De vaste eindstatus heet **Kwaliteitscontrole**. Deze slaagt uitsluitend wanneer
de regressietests, alle browseronderdelen en het websitepakket zijn geslaagd.
Een mislukte, ontbrekende, afgebroken of overgeslagen controle blokkeert die status.
Browserrapporten blijven zeven dagen beschikbaar bij de workflowuitvoering.

## Eenmalige activering in GitHub

**De workflowcode stelt onderstaande repository-instellingen niet zelf in.**
Totdat de publicatiebron is omgezet, kan de bestaande publicatie vanaf de branch
nog steeds buiten deze controles om plaatsvinden. Zolang branchbeveiliging niet
is ingesteld, kunnen wijzigingen bovendien rechtstreeks naar `main`.

1. Open [Settings → Branches](https://github.com/rikschipper798-lgtm/Mijn-kookboek/settings/branches)
   en voeg een branch protection rule voor exact `main` toe:
   - **Require a pull request before merging** aan; verplichte menselijke
     goedkeuringen mogen uit blijven voor dit persoonlijke project.
   - **Require status checks to pass before merging** aan, met precies
     **Kwaliteitscontrole**, afkomstig van **GitHub Actions**.
   - **Require branches to be up to date before merging** aan.
   - **Do not allow bypassing the above settings** aan, ook voor beheerders.
   - Force pushes en verwijderen van `main` niet toestaan.
2. Open [Settings → Pages](https://github.com/rikschipper798-lgtm/Mijn-kookboek/settings/pages)
   en kies bij **Build and deployment → Source** de optie **GitHub Actions**.
   Voeg geen extra voorbeeldworkflow toe: de bestaande workflow verzorgt dit al.
   Beperk de deployment environment `github-pages` tot de branch `main`.
3. Maak onder [Settings → Secrets and variables → Actions → Variables](https://github.com/rikschipper798-lgtm/Mijn-kookboek/settings/variables/actions)
   de repositoryvariabele **COOKBOOK_PAGES_ENABLED** met waarde **true** aan.
   Dit is een gewone variabele, geen secret. Deze expliciete activering voorkomt
   dat de nieuwe en oude publicatieroute tijdens de overgang door elkaar lopen.
4. Start [Kwaliteitscontrole en publicatie](https://github.com/rikschipper798-lgtm/Mijn-kookboek/actions/workflows/validate-recipes.yml)
   via **Run workflow**, met branch `main`. Controleer de groene eindstatus én
   **Publiceer website**. Controleer daarna de live website.

De vereiste status verschijnt pas in de instellingen nadat de nieuwe workflow
minstens eenmaal heeft gedraaid. De stappen zijn pas afgerond nadat de
repository-instellingen en een succesvolle nieuwe publicatie zijn gecontroleerd.

## Wat gebeurt er bij een fout?

Na activering wordt alleen het pakket uit dezelfde geslaagde workflowuitvoering
gepubliceerd. Pull requests publiceren nooit. Het publicatieonderdeel start pas
na de kwaliteitscontrole; bij een fout blijft de bestaande website beschikbaar.
Een heruitvoering van een oude commit mag de nieuwere `main` niet terugdraaien.
Uitvoeringen op `main` en publicaties worden daarom na elkaar uitgevoerd.

Los een fout op in de pull request en laat de controles opnieuw draaien. Schakel
de verplichte controle niet uit om een wijziging toch te publiceren. Bij een
publicatiestoring kun je de workflow opnieuw op de actuele `main` starten.

## Lokaal testen

Vereist: Node.js 22+, Python 3 en een volledige checkout inclusief afbeeldingen.

```bash
node --test tests/*.test.cjs
node scripts/validate-recipes.cjs
node scripts/check-recipe-revisions.cjs
node scripts/build-site.cjs
npm install --no-save playwright@1.56.1 axe-core@4.10.3
npx playwright install --with-deps chromium
node tests/cookbook-journey-browser.cjs
```

De zeven overige browserscripts staan in de matrix van de workflow. De vroegere
workflows die alleen op specifieke ontwikkelbranches draaiden zijn daarin
samengevoegd. De aparte dagelijkse databaseback-up blijft ongewijzigd.
