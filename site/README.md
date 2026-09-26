# Gradara website

Static product site served by Firebase Hosting at **https://gradara-web.web.app**. Plain HTML and CSS with self-hosted fonts: no build step, no cookies, no analytics, and no third-party requests (enforced by the Content-Security-Policy in `firebase.json`).

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

1. In the [Firebase console](https://console.firebase.google.com/), create a project with the ID `gradara-web`. If that ID is taken, pick another and replace `gradara-web` in `.firebaserc`, `.github/workflows/site.yml`, the canonical URLs in `public/*.html`, and the app links (`desktop/main.cjs`, `desktop/package.json`, `components/gradara/settings-dialog.tsx`, `cloud/gateway/app.py`, `cloud/gateway/pages/activate.html`, `README.md`).
2. Deploy once from your computer:

   ```sh
   npm install -g firebase-tools
   firebase login
   cd site && firebase deploy --only hosting
   ```

3. For automatic deploys, run `firebase init hosting:github` in `site/` or create a service account with the Firebase Hosting Admin role, and store its JSON key as the repository secret `FIREBASE_SERVICE_ACCOUNT_GRADARA_WEB`. The **Website** workflow then deploys `main` and posts preview links on pull requests.

A custom domain can be added later in Firebase Hosting; update the canonical URLs and app links when it is.

## Content rules

- Keep claims true to the shipped app: prices must match the gateway's `CREDIT_PRICES` and `CREDIT_PACKS`, and privacy statements must match [docs/PRIVACY.md](../docs/PRIVACY.md).
- Download links point to `releases/latest/download/<file>` on GitHub; keep them in sync with `artifactName` in `desktop/electron-builder.yml`.
- Font licenses (SIL OFL 1.1) are in `public/assets/fonts/`.
