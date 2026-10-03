import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

path = Path(__file__).resolve().parents[3] / "scripts/prepare-public-group-benchmark.py"
spec = importlib.util.spec_from_file_location("public_group_data", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicGroupDataTests(unittest.TestCase):
    def metadata(self, data=b"public photo", license_name="Public domain"):
        return json.dumps(
            {
                "query": {
                    "pages": {
                        "1": {
                            "imageinfo": [
                                {
                                    "url": "https://upload.wikimedia.org/photo.jpg",
                                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Test.jpg",
                                    "sha1": hashlib.sha1(data).hexdigest(),
                                    "extmetadata": {
                                        "LicenseShortName": {"value": license_name},
                                        "Copyrighted": {"value": "False"},
                                    },
                                }
                            ]
                        }
                    }
                }
            }
        ).encode()

    def test_checks_publisher_hash_and_reuses_complete_data_offline(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(
                module,
                "CATALOG",
                [("you.jpg", "Test.jpg", "reference", "Test public-figure caption")],
            ),
            patch.object(module.time, "sleep"),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            with patch.object(
                module.urllib.request,
                "urlopen",
                side_effect=[io.BytesIO(self.metadata()), io.BytesIO(b"public photo")],
            ) as network:
                module.prepare(directory)
                self.assertEqual(network.call_count, 2)
            with patch.object(
                module.urllib.request,
                "urlopen",
                side_effect=AssertionError("Network must not run"),
            ):
                module.prepare(directory)
            saved = json.loads((Path(directory) / "sources.json").read_text())
            self.assertTrue(saved["complete"])
            self.assertEqual(
                saved["images"][0]["publisherMetadata"]["LicenseShortName"]["value"],
                "Public domain",
            )

    def test_missing_rights_and_changed_bytes_stop_preparation(self):
        for metadata, data in [
            (self.metadata(license_name="All rights reserved"), b"public photo"),
            (self.metadata(), b"changed"),
        ]:
            with (
                tempfile.TemporaryDirectory() as directory,
                patch.object(
                    module,
                    "CATALOG",
                    [("you.jpg", "Test.jpg", "reference", "Test caption")],
                ),
                patch.object(
                    module.urllib.request,
                    "urlopen",
                    side_effect=[io.BytesIO(metadata), io.BytesIO(data)],
                ),
            ):
                with self.assertRaises(RuntimeError):
                    module.prepare(directory)
                self.assertFalse((Path(directory) / "you.jpg").exists())

    def test_long_rate_limit_is_not_retried(self):
        error = urllib.error.HTTPError(
            "https://upload.wikimedia.org/photo.jpg",
            429,
            "rate limit",
            {"Retry-After": "3600"},
            None,
        )
        with (
            patch.object(
                module.urllib.request, "urlopen", side_effect=error
            ) as network,
            patch.object(module.time, "sleep") as sleep,
        ):
            with self.assertRaises(module.PublisherRateLimit):
                module.fetch("https://upload.wikimedia.org/photo.jpg", 100)
            self.assertEqual(network.call_count, 1)
            sleep.assert_not_called()

    def test_rate_limit_preserves_explicit_missing_cases_and_stops_downloads(self):
        catalog = [
            ("you.jpg", "Test.jpg", "reference", "Test caption"),
            ("partner.jpg", "Other.jpg", "reference", "Test caption"),
        ]
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(module, "CATALOG", catalog),
            patch.object(
                module,
                "fetch",
                side_effect=[self.metadata(), module.PublisherRateLimit("stop")],
            ) as network,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            module.prepare(directory)
            saved = json.loads((Path(directory) / "sources.json").read_text())
            self.assertFalse(saved["complete"])
            self.assertEqual(len(saved["unavailable"]), 2)
            self.assertEqual(network.call_count, 2)

    def test_complete_cache_cannot_read_arbitrary_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "sources.json").write_text(
                json.dumps(
                    {
                        "complete": True,
                        "images": [{"file": "../private.jpg", "sha256": "0" * 64}],
                    }
                )
            )
            with self.assertRaisesRegex(RuntimeError, "Unexpected cached"):
                module.prepare(directory)


if __name__ == "__main__":
    unittest.main()
