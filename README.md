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
