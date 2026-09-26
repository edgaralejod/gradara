# Gradara website

Static product site served by Firebase Hosting (project `gradara-2e47a`) at **https://gradara.app**, with `www.gradara.app` redirecting to it (the redirect is configured in the Firebase Hosting console, not in `firebase.json`). Plain HTML and CSS with self-hosted fonts: no build step, no cookies, no analytics, and no third-party requests (enforced by the Content-Security-Policy in `firebase.json`).

| Page | File |
| --- | --- |
| Home: features, AI, pricing, download, FAQ | `public/index.html` |
| Privacy notice (draft for legal review) | `public/privacy.html` |
| Terms of use (draft for legal review) | `public/terms.html` |

Preview locally:

```sh
cd site/public && python3 -m http.server 8088
```

## First deploy

1. The Firebase project is `gradara-2e47a` (set in `.firebaserc`). The custom domains `gradara.app` and `www.gradara.app` are configured in Firebase Hosting; their DNS records live in GoDaddy: `A @ 199.36.158.100`, `TXT @ hosting-site=gradara-2e47a`, and `CNAME www gradara-2e47a.web.app`.
2. Deploy once from your computer:

   ```sh
   npm install -g firebase-tools
   firebase login
   cd site && firebase deploy --only hosting
   ```

3. For automatic deploys, run `firebase init hosting:github` in `site/` or create a service account with the Firebase Hosting Admin role, and store its JSON key as the repository secret `FIREBASE_SERVICE_ACCOUNT_GRADARA`. The **Website** workflow then deploys `main` and posts preview links on pull requests.


## Content rules

- Keep claims true to the shipped app: prices must match the gateway's `CREDIT_PRICES` and `CREDIT_PACKS`, and privacy statements must match [docs/PRIVACY.md](../docs/PRIVACY.md).
- Download links point to `releases/latest/download/<file>` on GitHub; keep them in sync with `artifactName` in `desktop/electron-builder.yml`.
- Font licenses (SIL OFL 1.1) are in `public/assets/fonts/`.
