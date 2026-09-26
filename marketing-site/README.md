# Aoi marketing site

An independent SvelteKit project for the public Aoi page. The Expo app remains at the repository root.

```sh
cd marketing-site
npm install
npm run check
npm run build
```

`npm run dev` starts local development. The static production output is `build/`.

The **Get Aoi** action uses the `aoi://` scheme verified in the Expo app config. Replace it with a verified store or web entry before publication if visitors without the app need an install path. Set `PUBLIC_PRIVACY_URL` and `PUBLIC_TERMS_URL` to published HTTPS pages to display legal links. No guessed legal destinations are rendered.

The illustrative photographs in `static/images/` are exact copies of the generated images in `assets/marketing/`. Their provenance is recorded in `.taste/assets.json`. The rain-window image and scrim are copies of the existing app assets; see `assets/images/midnight-window.source.md` for its source and license. The illustrations and example memory text do not depict real Aoi customers.

The page uses the app's approved Georgia and system sans stacks. They are operating-system faces and have no bundled font binaries, so browser `FontFace` asset-loading checks do not apply to them.
