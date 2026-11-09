# Productie-e-mail voor Mijn Kookboek

**Status: voorbereid, niet geactiveerd.** De huidige Supabase Auth-maildienst
is alleen voor ontwikkeling en is niet geschikt voor alle externe gebruikers.
Er is nog geen SMTP-provider of afzenderdomein gekozen.

## Benodigd

1. Een domein dat jij beheert en een SMTP-leverancier (bijvoorbeeld Resend,
   Brevo, Postmark of AWS SES). De leverancier moet een SMTP-host,
   -poort, -gebruikersnaam en -wachtwoord kunnen verstrekken.
2. Verifieer het afzenderdomein via de door de provider opgegeven DNS-records.
   Richt SPF, DKIM en DMARC correct in.
3. Open [Supabase Auth SMTP](https://supabase.com/dashboard/project/usppeputwknbxayekufe/auth/smtp)
   en configureer uitsluitend daar de providergegevens. Zet geen
   SMTP-wachtwoord in GitHub, JavaScript of deze documentatie.
4. Zet een neutraal afzenderadres op je eigen domein, bij voorkeur
   `no-reply@<jouw-domein>`, en afzendernaam `Mijn Kookboek`.
5. Open [e-mailtemplates](https://supabase.com/dashboard/project/usppeputwknbxayekufe/auth/templates)
   en gebruik voor de Magic Link de optionele
   [Nederlandse HTML-template](templates/magic-link.html).
   De Supabase-placeholder `{{ .ConfirmationURL }}` moet ongewijzigd blijven.
   Voorstel onderwerp: **Je inloglink voor Mijn Kookboek**.
6. Controleer onder Authentication > URL Configuration dat de toegestane
   terugkeer-URL `https://rikschipper798-lgtm.github.io/Mijn-kookboek/voeding.html`
   bevat. De site-URL moet naar de juiste publieke site wijzen.
7. Controleer onder Authentication > Rate Limits en Bot/CAPTCHA Protection
   de toegestane aantallen. Een nieuwe SMTP-provider begint met eigen
   verzendlimieten; verhoog die pas na testen.
8. Test vanuit een privévenster met een extern, niet bij het Supabase-team
   aangesloten e-mailadres. Controleer verzenden, ontvangen, aanklikken,
   terugkeer naar het dagboek en beperking tot eigen gegevens.

**De template is alleen opgeslagen als bronbestand.** Dit verandert
geen Supabase-mailinstellingen en verzendt geen e-mails.

## Praktische beveiliging

- Houd emailbevestiging en OTP-vervaltijd ingeschakeld (maximaal één uur).
- Vermeld geen persoonlijke maaltijden of accountgegevens in de e-mail.
- Geef medewerkers geen SMTP-beheersleutels via het dagboek.
- De huidige Supabase Security Advisor meldt dat controle op gelekte
  wachtwoorden uitstaat. Dit raakt vooral wachtwoordaanmelding;
  bij uitsluitend Magic Links heeft dat minder directe impact, maar
  beoordeel het opnieuw als je wachtwoorden inschakelt.
- Voor een publieke aanmeldmogelijkheid: kijk naar CAPTCHA en een
  beheersbaar proces voor abuse en support.

## Statusgrenzen

Ik kan met de gekoppelde Supabase-databasetoegang wel tabellen, policies en
serverfuncties beheren, maar geen eigen SMTP-domein verifiëren, provideraccount
registreren of geheime SMTP-inloggegevens instellen. Dat vereist een actie
in de accounts van de gekozen provider en Supabase Auth.

Bron: [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
