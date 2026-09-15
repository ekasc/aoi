/**
 * Keepsake document builder — a pure function from chapter data to a
 * print-ready HTML document. No network, no storage, no side effects, so it
 * is fully deterministic and unit-testable.
 *
 * Font strategy (provisional faces must NOT ship in exports): zero embedded
 * fonts — no @font-face, no base64, no references to New York / Trebuchet /
 * the unknown mono. The document names only ubiquitous system families
 * (Georgia/serif + system sans); the renderer substitutes locally. Nothing
 * is redistributed or embedded.
 *
 * Pagination honesty: no fixed heights, no overflow clipping anywhere. Entry
 * headers keep together; note bodies flow across pages; photos fit the page
 * (max-height) instead of cropping the source.
 */

export type KeepsakeCoverInput = {
  title: string;
  subtitle: string;
  dateLine: string;
  photoUri: string | null;
};

export type KeepsakeEntryInput =
  | { kind: 'photo'; date: string; title: string | null; uri: string }
  | { kind: 'note'; date: string; title: string | null; body: string }
  | { kind: 'voice'; date: string; title: string | null };

export type KeepsakeDocumentInput = {
  cover: KeepsakeCoverInput;
  entries: KeepsakeEntryInput[];
};

export function escapeKeepsakeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SERIF = `Georgia, 'Times New Roman', serif`;
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

function coverHtml(cover: KeepsakeCoverInput): string {
  const title = escapeKeepsakeHtml(cover.title);
  const subtitle = escapeKeepsakeHtml(cover.subtitle);
  const dateLine = escapeKeepsakeHtml(cover.dateLine);
  if (cover.photoUri) {
    return [
      `<section class="cover">`,
      `<img class="cover-photo" src="${escapeKeepsakeHtml(cover.photoUri)}" alt="" />`,
      `<div class="cover-band">`,
      `<div class="kicker">Aoi keepsake</div>`,
      `<h1 class="cover-title">${title}</h1>`,
      `<div class="cover-meta">${subtitle} &middot; ${dateLine}</div>`,
      `</div>`,
      `</section>`,
    ].join('\n');
  }
  // Paper/type fallback per the cover grammar: oversized numeral, one rule,
  // title, restrained metadata. No filler illustration.
  const numeral = escapeKeepsakeHtml(cover.title.split(' ')[0] ?? cover.title);
  return [
    `<section class="cover cover-fallback">`,
    `<div class="cover-numeral">${numeral}</div>`,
    `<div class="cover-rule"></div>`,
    `<div class="kicker">Aoi keepsake</div>`,
    `<h1 class="cover-title">${title}</h1>`,
    `<div class="cover-meta">${subtitle} &middot; ${dateLine}</div>`,
    `</section>`,
  ].join('\n');
}

function entryHtml(entry: KeepsakeEntryInput, index: number): string {
  const date = escapeKeepsakeHtml(entry.date);
  const title = entry.title ? escapeKeepsakeHtml(entry.title) : null;
  const head = [
    `<div class="entry-head">`,
    `<div class="entry-date">${date}</div>`,
    title ? `<h2 class="entry-title">${title}</h2>` : '',
    `</div>`,
  ].join('\n');

  if (entry.kind === 'photo') {
    return [
      `<section class="entry" data-entry="${index}">`,
      head,
      // Original asset, fitted — CSS never crops the source here.
      `<img class="entry-photo" src="${escapeKeepsakeHtml(entry.uri)}" alt="" />`,
      `</section>`,
    ].join('\n');
  }

  if (entry.kind === 'note') {
    return [
      `<section class="entry" data-entry="${index}">`,
      head,
      `<p class="entry-body">${escapeKeepsakeHtml(entry.body)}</p>`,
      `</section>`,
    ].join('\n');
  }

  // Voice is rendered truthfully: a labeled entry with its date and where
  // to hear it. No fake player, no invented duration, no embedded audio.
  return [
    `<section class="entry" data-entry="${index}">`,
    head,
    `<div class="voice-block">`,
    `<div class="voice-label">Voice memory</div>`,
    `<div class="voice-hint">Listen in Aoi to play this recording.</div>`,
    `</div>`,
    `</section>`,
  ].join('\n');
}

export function buildKeepsakeHtml(input: KeepsakeDocumentInput): string {
  const entries = input.entries.map((entry, index) => entryHtml(entry, index)).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeKeepsakeHtml(input.cover.title)}, Aoi keepsake</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${SANS};
    color: #1e1b16;
    background: #fffdf8;
    /* Export-safe margins (~8%): content never touches the trim edge. */
    padding: 22mm 18mm;
  }
  .kicker {
    font-family: ${SANS};
    font-size: 11pt;
    letter-spacing: 1.5pt;
    text-transform: uppercase;
    color: #8a8175;
  }
  .cover { page-break-after: always; }
  .cover-photo {
    width: 100%;
    aspect-ratio: 4 / 5;
    object-fit: cover;
    display: block;
    border: 0.5pt solid #e3d8c3;
  }
  .cover-band { padding: 12mm 0 0 0; }
  .cover-title {
    font-family: ${SERIF};
    font-size: 30pt;
    line-height: 1.15;
    margin: 4mm 0 3mm 0;
    font-weight: 400;
  }
  .cover-meta { font-size: 11pt; color: #5e564a; }
  .cover-fallback { padding-top: 30mm; }
  .cover-numeral {
    font-family: ${SERIF};
    font-size: 72pt;
    line-height: 1;
    color: #1e1b16;
  }
  .cover-rule { width: 18mm; height: 1mm; background: #8a3e28; margin: 6mm 0; }
  .entry { margin: 0 0 12mm 0; }
  .entry-head { break-inside: avoid; break-after: avoid; }
  .entry-date {
    font-size: 10pt;
    letter-spacing: 0.8pt;
    text-transform: uppercase;
    color: #8a8175;
    margin-bottom: 2mm;
  }
  .entry-title {
    font-family: ${SERIF};
    font-weight: 400;
    font-size: 20pt;
    line-height: 1.25;
    margin: 0 0 4mm 0;
  }
  /* Note bodies flow across pages, never boxed, never clipped. */
  .entry-body {
    font-family: ${SERIF};
    font-size: 12.5pt;
    line-height: 1.65;
    margin: 0;
    overflow: visible;
  }
  .entry-photo {
    width: 100%;
    max-height: 220mm;
    object-fit: contain;
    display: block;
  }
  .voice-block {
    border-top: 0.5pt solid #e3d8c3;
    padding-top: 4mm;
  }
  .voice-label { font-size: 12pt; margin-bottom: 1mm; }
  .voice-hint { font-size: 10pt; color: #5e564a; }
  .closing {
    margin-top: 14mm;
    padding-top: 4mm;
    border-top: 0.5pt solid #e3d8c3;
    font-size: 10pt;
    color: #8a8175;
  }
</style>
</head>
<body>
${coverHtml(input.cover)}
${entries}
<div class="closing">Kept with Aoi, a private relationship archive.</div>
</body>
</html>`;
}
