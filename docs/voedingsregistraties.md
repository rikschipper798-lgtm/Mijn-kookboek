# Voedingsregistraties aanpassen

Bij elke maaltijd in het voedingsdagboek staat na openklappen **Aanpassen**.
De gegeten hoeveelheid en datum zijn te wijzigen. Bij eigen invoer, automatische
maaltijden en oudere receptregistraties zijn ook omschrijving en voedingswaarden
te corrigeren. Een automatische aanname wordt bij opslaan bevestigd. Een wijziging
in het dagboek verandert een opgeslagen standaardmaaltijd niet.

## Porties en voedingswaarden

- Een nieuwe receptregistratie vermeldt wat één portie betekent. Saucijzenbroodjes:
  twee broodjes; poesta: twee poestabroodjes; stokbrood: één heel stokbrood.
- Andere recepten tonen hun aandeel van het basisrecept, bijvoorbeeld 1/4 van
  het basisrecept voor één persoon. `nutrition.portionLabel` kan dit nader omschrijven.
- Hoeveelheden lopen van 0,25 tot 20 in stappen van 0,25. Opslaggrenzen blijven
  gelden: maximaal 20.000 kcal en 2.000 g per macro per registratie.
- Elke nieuwe receptregistratie bewaart de eigen voedingswaarden per portie.
  Een latere wijziging of verwijdering van het kookboekrecept wijzigt de historie
  niet. Aanpassen gebruikt de opgeslagen basis en rondt pas het nieuwe totaal af.
- Oudere receptregistraties hebben geen betrouwbare receptversie of portiegrootte.
  Die worden niet achteraf afgeleid uit een titel of het huidige recept. Bij zulke
  registraties is hoeveelheid 1 de volledige oorspronkelijk opgeslagen maaltijd.
  De uitleg in het formulier maakt dit verschil duidelijk.

## Gegevensmodel

De bestaande velden `id`, `title`, `source` en `nutrition` blijven bestaan.
`nutrition` bevat altijd de totale waarden voor de werkelijk geregistreerde
hoeveelheid. Bestaande dagtotalen blijven daarmee werken.

| Veld | Betekenis |
| --- | --- |
| `portion.quantity` | Gegeten aantal porties, of aantal oorspronkelijke maaltijden bij eigen/oudere invoer |
| `portion.label` | Bewaarde omschrijving van één portie of hoeveelheid |
| `portion.nutrition` | Bewaarde voedingswaarden voor hoeveelheid 1; onbekende macro's blijven `null` |
| `recipe.id` | Stabiele ID van het basisrecept |
| `recipe.variantId` | `klassiek` of de gekozen variant-ID |
| `recipe.version` | Versie van de gebruikte variant of het basisrecept |
| `recipe.baseVersion` | Versie van het basisrecept ten tijde van registreren |
| `recipe.title` | De toen gebruikte receptnaam, inclusief variantomschrijving |

`portion` en `recipe` zijn optioneel voor oudere data. `recipe` wordt alleen bij
nieuwe receptregistraties gezet. Eigen invoer krijgt portiegegevens zodra deze
wordt aangepast. Versies en porties worden gevalideerd bij laden, importeren en
opslaan. Ongeldige of tegenstrijdige gegevens worden geweigerd. Export, versleutelde
back-up en de bestaande cloudopslag nemen de complete registratie mee.

De cloud blijft hetzelfde persoonlijke `diary`-JSON-document gebruiken; er is
geen databasewijziging of migratie nodig. De bestaande accountafscherming,
revisiecontrole en lokale herstelkopie blijven actief.

## Veilig aanpassen

Een datumwijziging verplaatst dezelfde registratie met behoud van ID in één
opslaghandeling. Een mislukte opslag of volle bestemmingsdag herstelt de oude
gegevens en laat de invoer beschikbaar. Het formulier weigert een registratie
te overschrijven die sinds openen is gewijzigd. Uitloggen sluit de editor.
Bij een verplaatste automatische maaltijd blijft de oorspronkelijke werkdag
als verwerkt gemarkeerd, zodat de maaltijd daar niet opnieuw verschijnt.

## Controle

`tests/nutrition-entries.test.cjs` toetst porties, historische waarden, oude data,
datumwijzigingen, opslagfouten, grenswaarden en gelijktijdige wijzigingen.
`tests/nutrition-editing-browser.cjs` controleert het publicatiepakket op 390 en
1280 pixels, inclusief export/import en toegankelijkheid. De synchronisatietest
controleert een receptregistratie die op een tweede apparaat wordt aangepast.
Deze controles vallen onder de verplichte `Kwaliteitscontrole`.
