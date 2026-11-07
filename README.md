# Mijn Kookboek

Persoonlijk online kookboek met recepten, kookmodus en boodschappenlijst.

**Website:** https://rikschipper798-lgtm.github.io/Mijn-kookboek/

## Automatische receptcontrole

Bij iedere push naar `main`, iedere pull request en via `workflow_dispatch` in GitHub Actions draait de workflow [Controleer kookboekrecepten](.github/workflows/validate-recipes.yml).

De controle bestaat uit twee delen:

1. **Regressietests:** `node --test tests/validate-recipes.test.cjs` — controleert met goede én bewust foutieve testgegevens of de validator correct werkt.
2. **Receptvalidatie:** `node scripts/validate-recipes.cjs` — controleert alle recepten en varianten in `recepten.json`, inclusief afbeeldingsbestanden.

De validator keurt onder andere af: dubbele recept-ID's of conflicterende aliases, ontbrekende velden, ongeldige porties of hoeveelheden, onbekende eenheden, onjuiste ingrediëntverwijzingen in stappen, ontbrekende afbeeldingen, foutieve varianten, onlogische tijdsgegevens en ongeldige afrondstappen bij schaalbare ingrediënten.

Een **fout** laat de GitHub Actions-job mislukken. Een **waarschuwing** maakt een aandachtspunt zichtbaar maar blokkeert de job niet. Een ingrediënt dat niet aan een bereidingsstap is gekoppeld is bijvoorbeeld een waarschuwing.

### Zelf een controle uitvoeren

Vereist: Node.js 22 of nieuwer. Er zijn geen npm-packages nodig.

```bash
node --test tests/validate-recipes.test.cjs
node scripts/validate-recipes.cjs
```

### Wijzigingen veilig publiceren

Gebruik bij voorkeur een **pull request** en controleer of de status `Receptvalidatie` geslaagd is voordat je samenvoegt. Om een foutieve pull request technisch te blokkeren moet je in GitHub een branch protection rule/ruleset instellen met **Require status checks to pass** en deze statuscheck als verplicht kiezen.

**Let op:** de workflow controleert een rechtstreekse push naar `main` pas **nadat** die push is gedaan. Zonder verplichte branch protection voorkomt de workflow dus niet dat een foutieve wijziging rechtstreeks wordt gepubliceerd.

Als je bewust een nieuwe ingrediënteenheid introduceert, pas dan ook de ondersteunde lijst `UNITS` in de validator aan.

## Offline receptafbeeldingen

De serviceworker in `sw.js` leest bij installatie automatisch alle afbeeldingen uit `recepten.json`, inclusief afbeeldingen die alleen bij een variant horen. Er is dus geen handmatig bijgewerkte afbeeldingenlijst meer.

Bij het online ophalen van nieuwe receptgegevens worden afbeeldingen die nog niet offline opgeslagen zijn automatisch toegevoegd. Bestaande afbeeldingen worden niet opnieuw gedownload zolang ze in de afbeeldingscache staan; als een afbeelding zichtbaar wordt in de website wordt deze zoals voorheen online ververst. Een mislukte afbeeldingsdownload blokkeert de overige recepten niet en wordt bij een volgend online bezoek opnieuw geprobeerd.

Het aanmaken van de offline cache is afhankelijk van de browser, de internetverbinding en beschikbare opslagruimte. Voor offline gebruik moet de website eerst met internet geopend zijn.

**Tests:** `node --test tests/offline-images.test.cjs` controleert installatie, varianten, nieuwe afbeeldingen, ontbreken/herproberen, offline terugval, dubbele afbeeldingen en het opruimen van oude serviceworkercaches. De GitHub Actions-workflow voert deze tests automatisch uit.

## Gekoppelde basisrecepten

Een gerecht kan een ingrediënt gebruiken dat ook als zelfstandig recept in het kookboek staat. Voorbeeld: het **gevulde kruidenboterstokbrood** gebruikt het basisrecept **knoflook-kruidenboter**.

In de boodschappenlijst kun je per gekoppeld ingrediënt kiezen:

- **Zelf maken** (standaard): de benodigde hoeveelheid wordt omgerekend naar de ingrediënten van het basisrecept. De boodschappenlijst telt deze op bij ingrediënten uit andere recepten en houdt rekening met porties en optionele ingrediënten.
- **Kant-en-klaar kopen**: de grondstoffen van het basisrecept verdwijnen uit deze receptregel en worden vervangen door het kant-en-klare product. De keuze wordt lokaal bij het geselecteerde recept opgeslagen en meegenomen in back-ups.

In het recept staat een link naar het basisrecept. Een al in huis afgevinkt samengesteld ingrediënt wordt niet alsnog uitgesplitst op de boodschappenlijst.

### Een nieuw basisrecept koppelen

Vermeld bij het **basisrecept** de opbrengst in dezelfde eenheid als het gekoppelde ingrediënt:

\`\`\`json
"outputQty": 40,
"outputUnit": "g"
\`\`\`

Gebruik bij het **ingrediënt in het hoofdrecept**:

\`\`\`json
"qty": 40,
"unit": "g",
"componentRecipeId": "kruidenboter",
"readyMadeName": "Kruidenboter (kant-en-klaar)"
\`\`\`

De validator controleert of het doelrecept bestaat, of de opbrengst en eenheden overeenkomen en of er geen cirkelverwijzingen ontstaan. Receptvarianten blijven ondersteund. De regressietests staan in \`tests/component-recipes.test.cjs\`.

## Persoonlijke standaardvoorraad

Op de website staat bij de recepten een knop **Mijn voorraad**. De knop opent de boodschappenlijst met een uitklapbaar voorraadbeheer. Bij de eerste opening zijn 36 producten uit `Keukenprofiel_Rik.md` als gewoonlijk aanwezig ingesteld (kruiden, smaakmakers en droge voorraad). In het beheer kun je producten aan- of uitvinken, nieuwe producten toevoegen, eigen producten verwijderen en de oorspronkelijke lijst herstellen. Verse kruiden worden niet automatisch gelijkgesteld aan gedroogde kruiden.

De boodschappenlijst toont standaardproducten automatisch bij **Al in huis**. Dat betekent **niet** dat er genoeg voorraad voor het volledige recept is: er worden geen werkelijke hoeveelheden bijgehouden. Met **Toch kopen** voeg je een product alsnog aan de boodschappen toe. Die keuze geldt voor de huidige boodschappenlijst; bij het legen van de lijst verdwijnen de uitzonderingen. Productnamen worden waar mogelijk genormaliseerd (zoals rijst, pasta en olijfolie), zodat meerdere schrijfwijzen als hetzelfde product worden herkend.

De voorraad staat **uitsluitend lokaal in de browser** onder `mijn-kookboek-voorraad`. Nieuwe back-ups bevatten de aangepaste voorraad. Oude back-ups zonder voorraadgegevens blijven herstelbaar en laten de bestaande voorraad ongemoeid. De losse module `pantry.js` is in de serviceworker-cache opgenomen voor offline gebruik.

Testen:

```bash
node --test tests/pantry.test.cjs
node --test tests/offline-images.test.cjs
```
