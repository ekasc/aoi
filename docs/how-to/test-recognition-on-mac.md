# Test recognition outside Aoi

To test without supplying any personal photos, run:

```sh
node scripts/test-face-recognition.mjs --public
```

This uses an independently sourced, licensed synthetic dataset and generates the labeled test cases automatically. Read [the public benchmark results and limits](../shape/public-face-benchmark.md). No app server is needed.

## Run the public group-photo diagnostic

For the local public-figure group-photo diagnostic, see [the group-photo investigation](../shape/group-recognition-investigation.md). It compares one and multiple references without changing Aoi:

```sh
python3 -B scripts/prepare-public-group-benchmark.py .expo/face-benchmark/public-groups
node scripts/test-face-recognition.mjs --group-benchmark .expo/face-benchmark/public-groups
```

If the publisher rate-limits preparation, stop further downloads until the requested pause expires. Missing cases remain explicit and cannot count as successful checks.

## Use your own consenting photo batch

Use local photos that both people have agreed to test. The runner does not read your Photos library or your phone's saved enrollment.

1. Create a folder with this layout. Use a clear solo photo for each reference.

   ```text
   aoi-test/
     you.jpg
     partner.jpg
     both/
       photos containing both people
     not-both/
       solo photos, unrelated people, or other negative examples
   ```

   References can also be HEIC, PNG, TIFF, or WebP. Keep the reference basenames `you` and `partner`. Put images directly inside the two test folders.

2. From the Aoi repository, run:

   ```sh
   node scripts/test-face-recognition.mjs "/path/to/aoi-test"
   ```

3. Open the `report.html` path printed by the command. Review missed photos, incorrect matches, and processing failures. Click a filename to open the original locally.

If local prerequisites are missing, run this once, then repeat the test command:

```sh
node scripts/test-face-recognition.mjs --setup
```

Setup downloads the pinned Python dependencies and model. Photo processing does not upload anything. The runner requires macOS, Node 22.18 or newer, Python 3, and Xcode command-line tools.

Use varied lighting, angles, dates, group sizes, and difficult negative examples. Include different photos from the references. Exact file duplicates and reference copies are excluded automatically. Keep re-encoded duplicates and near-identical burst photos out yourself.

Keep the HTML report private because it contains filenames and local links. Share only `diagnostics.json` if you need help investigating scores. That file excludes photos, source paths, filenames, and faceprints.

For a synthetic tools check without personal photos, run:

```sh
node scripts/test-face-recognition.mjs --check
```

For implementation details and test limits, read [the Mac runner verification record](../shape/mac-face-test-runner.md).
