import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

script = (
    Path(__file__).resolve().parents[3] / "scripts/prepare-public-face-benchmark.py"
)
spec = importlib.util.spec_from_file_location("public_face_data", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicFaceDataTests(unittest.TestCase):
    def archive(self, malicious=False, identities=2):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as archive:
            if malicious:
                link = tarfile.TarInfo("root/0/outside.png")
                link.type = tarfile.SYMTYPE
                link.linkname = "/private/outside.png"
                archive.addfile(link)
                data = b"not an image"
                path = tarfile.TarInfo("../../outside.png")
                path.size = len(data)
                archive.addfile(path, io.BytesIO(data))
            for identity in range(identities):
                for sample in range(2):
                    data = f"synthetic-{identity}-{sample}".encode()
                    member = tarfile.TarInfo(f"root/{identity}/{sample}.png")
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))
        return output.getvalue()

    def source(self, license_id="cc-by-sa-4.0", malicious=False, identities=2):
        record = {
            "metadata": {"license": {"id": license_id}},
            "doi": "test-doi",
            "doi_url": "https://example.test/doi",
            "files": [
                {
                    "key": module.ARCHIVE,
                    "checksum": "publisher-checksum",
                    "links": {"self": "https://example.test/archive"},
                }
            ],
        }
        return patch.object(
            module.urllib.request,
            "urlopen",
            side_effect=[
                io.BytesIO(json.dumps(record).encode()),
                io.BytesIO(self.archive(malicious, identities)),
            ],
        )

    def test_validation_skips_source_identities_not_just_renames_them(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            self.source(identities=4),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            module.prepare(directory, identities=2, images=2, skip_identities=2)
            manifest = json.loads((Path(directory) / "manifest.json").read_text())
            self.assertEqual(
                [item["sourceIdentity"] for item in manifest["identities"]], ["2", "3"]
            )
            self.assertEqual(manifest["skippedIdentities"], 2)

    def test_bounded_subset_and_provenance(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            self.source(),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            module.prepare(directory, identities=2, images=2)
            manifest = json.loads((Path(directory) / "manifest.json").read_text())
            self.assertEqual(len(manifest["identities"]), 2)
            self.assertEqual(len(list(Path(directory).rglob("*.png"))), 4)
            self.assertLess(manifest["downloadedBytes"], 1024)
            self.assertEqual(manifest["license"], "CC-BY-SA-4.0")
            self.assertIn("CC BY-SA", (Path(directory) / "ATTRIBUTION.txt").read_text())

    def test_changed_license_stops_before_download(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            self.source("research-only") as source,
        ):
            with self.assertRaisesRegex(RuntimeError, "license changed"):
                module.prepare(directory, identities=2, images=2)
            self.assertEqual(source.call_count, 1)

    def test_bandwidth_limit_cleans_partial_images(self):
        with tempfile.TemporaryDirectory() as directory, self.source():
            with self.assertRaisesRegex(RuntimeError, "limit reached"):
                module.prepare(directory, identities=2, images=2, budget=24)
            self.assertFalse((Path(directory) / "manifest.json").exists())
            self.assertEqual(list(Path(directory).rglob("*.png")), [])

    def test_unsafe_tar_members_are_not_extracted(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            self.source(malicious=True),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            module.prepare(directory, identities=2, images=2)
            self.assertEqual(len(list(Path(directory).rglob("*.png"))), 4)
            self.assertFalse((Path(directory) / "outside.png").exists())


if __name__ == "__main__":
    unittest.main()
