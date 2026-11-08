# Mijn Kookboek

Persoonlijk online kookboek met recepten, kookmodus en boodschappenlijst.

**Website:** https://rikschipper798-lgtm.github.io/Mijn-kookboek/

## Voedingswaarden per recept

Alle recepten en hun varianten hebben een eigen `nutrition`-object in `recepten.json`.
De website toont de voedingswaarden bij het gerecht en een compact kcal-label in het overzicht.

```json
"nutrition": {
  "per": "portie",
  "kcal": 740,
  "proteinG": 41,
  "carbsG": 85,
  "fatG": 27,
  "fiberG": 9.3,
  "estimated": true
}
```

De vijf waarden gelden **per standaardportie** zoals omschreven door `servings` en
`servingUnit`. Bij het aanpassen van het aantal porties veranderen de hoeveelheden
in het recept en het geschatte **totaal** aan calorieën; de voedingswaarde **per portie**
blijft gelijk. Voor het stokbroodrecept is de eenheid één stokbrood.

De waarden zijn **benaderingen**, berekend uit de hoeveelheden in de recepten en
gangbare gemiddelde voedingswaarden per ingrediënt. Ze zijn niet individueel
laboratoriumbepaald of geverifieerd aan de hand van merkverpakkingen. Aannames:

- Optionele ingrediënten tellen niet mee; bij het toevoegen ervan moeten de waarden
  opnieuw worden bepaald.
- Gerapporteerde eetbare hoeveelheden zijn uitgangspunt; voor stuks en lepels
  worden praktische gemiddelde omrekengewichten gebruikt.
- Voor ruime hoeveelheden zonnebloemolie bij het bakken van gepaneerde kip
  wordt ongeveer 38% van de opgegeven olie als geconsumeerd meegerekend; de
  rest kan in de pan achterblijven. Overige toegevoegde bakolie telt in beginsel mee.
- Ingrediënten zoals wraps, sauzen, yoghurt, vlees en kaas verschillen per merk
  en vetpercentage. Bij gerechten met alcohol telt de energie uit alcohol mee,
  ook wanneer die niet in de getoonde macronutriënten is terug te vinden.
- Voedingswaarden worden op een praktische precisie afgerond en zijn niet
  geschikt als gegarandeerde dieet-, allergenen- of medische voedingsinformatie.

**Bij een nieuw of gewijzigd recept:** actualiseer ook `nutrition` (en waar
nodig de variant). Leg de inhoudelijke wijziging vast via de bestaande
`version`, `updatedAt` en `changeLog`-velden.

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


## Receptversies, wijzigingsdatum en geschiedenis

Alle 27 bestaande recepten en de 2 varianten zijn bij invoering van het versiebeheer gestart op **versie 1**. De eerdere `date` blijft de bestaande **opnamedatum**; eerdere bewerkingen zijn niet betrouwbaar terug te halen en worden dus niet achteraf als revisies gepresenteerd.

Per recept en variant staan deze velden in `recepten.json`:

```json
{
  "version": 1,
  "updatedAt": null,
  "changeLog": []
}
```

Bij iedere **inhoudelijke wijziging** (ingrediënten, hoeveelheden, stappen, titel, tijden, afbeelding, enz.) wordt `version` met precies één verhoogd en een logregel toegevoegd. Bijvoorbeeld:

```json
{
  "version": 2,
  "updatedAt": "2026-11-07",
  "changeLog": [
    {
      "version": 2,
      "date": "2026-11-07",
      "description": "Kruidenhoeveelheden bijgesteld en bereiding verduidelijkt."
    }
  ]
}
```

De `date` van het bestaande recept blijft ongewijzigd. **Bewaar oude logregels**; bij versie 3 komt er een nieuwe regel bij, zodat eerdere wijzigingen zichtbaar blijven. Receptvarianten hebben een **eigen versie**. Als een aanpassing in het hoofdrecept ook een variant beïnvloedt, verhoog dan ook de variantversie en voeg bij beide een passende logregel toe.

### Wijziging registreren

Werk eerst de receptinhoud in `recepten.json` bij. Daarna kun je met Node.js versie, datum en logregel laten bijwerken:

```bash
node scripts/bump-recipe-version.cjs piripiri "Kruiding aangescherpt en baktijd verduidelijkt"
node scripts/bump-recipe-version.cjs pasta-rundergehakt-groenten "Romige variant verbeterd" --variant=romig
```

De datum wordt standaard bepaald in de tijdzone **Europe/Amsterdam**. Optioneel kun je `--date=YYYY-MM-DD` toevoegen. Leg inhoud en versiemetadata vast **in dezelfde Git-commit**. Verhoog de versie niet als uitsluitend technische bestanden buiten `recepten.json` zijn aangepast.

De website toont de actuele versie en opnamedatum, een eventuele laatste wijzigingsdatum en een uitklapbare wijzigingsgeschiedenis. De sorteermogelijkheden **Recent toegevoegd** en **Recent gewijzigd** zijn apart; bij recent gewijzigd tellen wijzigingen aan varianten mee.

De workflow draait `tests/recipe-revisions.test.cjs`, de inhoudsvalidator en `scripts/check-recipe-revisions.cjs`. De laatste vergelijkt `recepten.json` met de vorige Git-commit en keurt een ontbrekende versieverhoging, weggelaten logregel of stille herschrijving van bestaande geschiedenis af. De website toont de **wijzigingssamenvattingen**, niet de volledige oude receptinhoud. Voorgaande volledige versies zijn zo nodig via de GitHub-commitgeschiedenis terug te vinden.

## Persoonlijke beoordelingen en kookervaringen

Persoonlijke informatie blijft **uitsluitend in de browser op het eigen apparaat**, onder \`mijn-kookboek-persoonlijke-notities\`. Er wordt niets naar \`recepten.json\` of GitHub geüpload.

De receptenkaart toont — **alleen als er eigen gegevens zijn ingevuld** — een blok *Mijn kookervaring* met jouw beoordeling (1–5 sterren), laatst vastgelegde kookdatum en de aanwezigheid van notities. Bij recepten met meerdere varianten wordt de **naam van de getoonde variant** vermeld. Er wordt geen gemiddelde van verschillende varianten of gebruikers verzonnen.

Op de receptpagina verschijnt direct boven de ingrediënten een samenvatting met de beoordeling, laatste kookdatum en een ingekort voorbeeld van feedback en persoonlijke aanpassingen. Via **Beoordeel dit recept** of **Bewerk mijn ervaring** ga je naar het bestaande formulier. Bewerken, automatisch opslaan en de knop **Vandaag gekookt** verversen deze samenvatting zonder de tekstvelden opnieuw op te bouwen.

In het receptenoverzicht zijn twee sorteermogelijkheden beschikbaar: **Mijn beoordeling** en **Laatst gekookt**. De knop **Eerder gekookt** toont alleen recepten met een persoonlijk vastgelegde kookdatum; een rating zonder kookdatum telt daarvoor niet mee. De filter- en sorteerfuncties werken ook als een kookervaring bij een variant hoort.

Kooknotities en persoonlijke beoordelingen blijven meegenomen worden in de bestaande lokale back-up. Er is **geen** publiek ratingsysteem, geen onzichtbare automatische kookregistratie en geen synchronisatie tussen apparaten.

Tests: \`node --test tests/personal-experience.test.cjs\`. Deze regressietests worden ook uitgevoerd in de workflow \`Controleer kookboekrecepten\`.

## Maaltijden, overige recepten en basisrecepten (punt 9)

Elk hoofdrecept heeft een verplicht veld `recipeType` in `recepten.json`. De indeling is **onafhankelijk van de bestaande categorie** (`Kip`, `Brood & basis`, `Dranken`, enz.) en de bestaande `kind`-aanduiding. Zo blijft een pizzagerecht in de categorie `Brood & basis` een maaltijd, terwijl een recept voor alleen een stokbrood een basisrecept is.

| Waarde | Websitegroep | Betekenis |
| --- | --- | --- |
| `maaltijd` | Maaltijden | Een gerecht dat bedoeld is als maaltijd, eventueel met bijgerechten |
| `overig` | Hapjes, desserts & dranken | Zelfstandig hapje, dessert of drankje; niet bedoeld als volledige maaltijd |
| `onderdeel` | Basisrecepten & onderdelen | Een onderdeel zoals kruidenboter, stokbrood of een losse kipschnitzel |

De collectie bevat bij invoering **19 maaltijden, 5 overige recepten en 3 basisrecepten/onderdelen**. In het overzicht staat boven de bestaande categorie- en tijdfilters een aparte rij met vier knoppen: Alle recepten, Maaltijden, Hapjes/desserts/dranken, en Basisrecepten/onderdelen. De knoppen tonen het aantal recepten, combineren met zoeken en overige filters, en worden gereset met **Wis filters**. De indeling verschijnt ook op receptkaarten en receptpagina's. Basisrecepten krijgen daar een korte uitleg dat ze een onderdeel van een maaltijd kunnen vormen.

### Nieuwe recepten en varianten

Voeg bij een nieuw hoofdrecept de passende `recipeType` toe; ontbrekende of onbekende waarden worden door `scripts/validate-recipes.cjs` afgekeurd. Een variant **erft** het type van het hoofdrecept en mag zelf geen `recipeType` vastleggen. Het verwijzen naar een ander recept met `componentRecipeId` mag uitsluitend als het doelrecept het type `onderdeel` heeft. De bestaande koppeling van gevuld kruidenboterstokbrood naar kruidenboter blijft intact.

Voor de invoering van de indeling zijn de versienummers van alle 27 recepten en de 2 varianten volgens het bestaande revisiebeleid verhoogd en van een nieuwe logregel voorzien. Inhoud, recept-ID's, porties en boodschappen blijven ongewijzigd. Toekomstige inhoudelijke aanpassingen volgen dezelfde versieregels.

Automatische tests: `node --test tests/recipe-types.test.cjs`; opgenomen in GitHub Actions, naast de bestaande tests voor recepten, varianten, offline gebruik en boodschappen.
