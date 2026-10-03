import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchPairByScores } from '../features/album/face-pipeline.ts';

export function classifyDlibDistances(distances) {
  const scores = distances.map(({ you, partner }) => {
    assert(Number.isFinite(you) && Number.isFinite(partner) && you >= 0 && partner >= 0, 'Invalid dlib distance');
    return { you: you < 0.6 ? 1 - you : -1, partner: partner < 0.6 ? 1 - partner : -1 };
  });
  // Keep the shared pair policy and the publisher's strict distance < 0.6 boundary.
  return matchPairByScores(scores, 0.4);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  assert(input && output, 'Use input-report.json and output-report.json');
  const report = JSON.parse(await readFile(input, 'utf8'));
  assert(report.metric === 'Euclidean distance, unnormalized descriptors' && report.experimentalDistanceCutoff === 0.6 && report.publicOnly === true, 'Use the pinned public dlib baseline report');
  const rows = report.rows.filter((row) => row.role === 'both').map((row) => ({ id: row.id, single: classifyDlibDistances(row.singleReferenceDistances), multiple: classifyDlibDistances(row.multipleReferenceDistances) }));
  const result = { experimentalOnly: true, distanceCutoff: 0.6, distanceBoundary: 'strictly less than', scoreMapping: '1 - distance for qualifying faces; -1 otherwise', sharedPairPolicyUsed: true, appCutoffChanged: false, negativeCases: report.negativeCasesAvailable, rows };
  await writeFile(output, JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
