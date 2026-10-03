"""Fetch a bounded synthetic subset, never the complete HyperFace archive."""

import argparse
import shutil
import hashlib
import json
import re
from pathlib import Path, PurePosixPath
import tarfile
import time
import urllib.request

RECORD = "https://zenodo.org/api/records/15087238"
ARCHIVE = "HyperFace_10k_LDM.tar.gz"


class BoundedReader:
    def __init__(self, response, budget):
        self.response = response
        self.budget = budget
        self.received = 0
        self.started = time.monotonic()

    def read(self, size=-1):
        if self.received >= self.budget or time.monotonic() - self.started > 300:
            raise RuntimeError(
                "Subset download limit reached; the full archive was not downloaded"
            )
        chunk = self.response.read(
            min(size if size >= 0 else 65536, self.budget - self.received)
        )
        self.received += len(chunk)
        return chunk


def prepare(
    destination,
    identities=16,
    images=8,
    budget=128 * 1024 * 1024,
    peek=False,
    skip_identities=0,
):
    with urllib.request.urlopen(RECORD, timeout=30) as response:
        record = json.load(response)
    if record["metadata"]["license"]["id"] != "cc-by-sa-4.0":
        raise RuntimeError("Dataset license changed. Review it before downloading.")
    archive = next(item for item in record["files"] if item["key"] == ARCHIVE)
    selected = {}
    seen_identities = set()
    skipped = set()
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    if (destination / "manifest.json").exists():
        raise RuntimeError(
            "This subset already exists. Use its manifest instead of downloading again."
        )
    written = []
    completed = False
    try:
        with urllib.request.urlopen(archive["links"]["self"], timeout=30) as response:
            reader = BoundedReader(response, budget)
            with tarfile.open(fileobj=reader, mode="r|gz") as stream:
                for member in stream:
                    if peek:
                        print(member.name)
                        if len(written) >= 24:
                            break
                        written.append(member.name)
                        continue
                    path = PurePosixPath(member.name)
                    if (
                        not member.isfile()
                        or path.suffix.lower() not in {".jpg", ".jpeg", ".png"}
                        or ".." in path.parts
                    ):
                        continue
                    identity = path.parent.name
                    if identity not in seen_identities:
                        seen_identities.add(identity)
                        if len(skipped) < skip_identities:
                            skipped.add(identity)
                    if identity in skipped:
                        continue
                    if identity not in selected:
                        if len(selected) >= identities:
                            continue
                        selected[identity] = []
                    if len(selected[identity]) >= images:
                        continue
                    if member.size <= 0 or member.size > 2 * 1024 * 1024:
                        raise RuntimeError("Unexpected benchmark image size")
                    data = stream.extractfile(member).read()
                    label = f"identity-{list(selected).index(identity):03d}"
                    output = (
                        destination
                        / label
                        / f"image-{len(selected[identity]):02d}{path.suffix.lower()}"
                    )
                    output.parent.mkdir(exist_ok=True)
                    output.write_bytes(data)
                    written.append(output)
                    selected[identity].append(
                        {
                            "file": str(output.relative_to(destination)),
                            "sha256": hashlib.sha256(data).hexdigest(),
                        }
                    )
                    if len(selected) == identities and all(
                        len(items) >= images for items in selected.values()
                    ):
                        break
            if peek:
                completed = True
                return
            if len(selected) != identities or any(
                len(items) != images for items in selected.values()
            ):
                raise RuntimeError(
                    "Archive ended before the requested subset was complete"
                )
            manifest = {
                "dataset": "HyperFace-10k-LDM",
                "synthetic": True,
                "source": RECORD,
                "doi": record["doi"],
                "license": "CC-BY-SA-4.0",
                "archive": ARCHIVE,
                "archiveChecksumFromPublisher": archive["checksum"],
                "downloadedBytes": reader.received,
                "selection": "First complete identities in archive order; not a representative random sample",
                "skippedIdentities": skip_identities,
                "identities": [
                    {
                        "label": f"identity-{index:03d}",
                        "sourceIdentity": identity,
                        "images": items,
                    }
                    for index, (identity, items) in enumerate(selected.items())
                ],
            }
            (destination / "manifest.json").write_text(json.dumps(manifest, indent=2))
            (destination / "ATTRIBUTION.txt").write_text(
                "HyperFace by Hatef Otroshi Shahreza and Sébastien Marcel, Idiap Research Institute, 2025.\n"
                f"Source: {record['doi_url']}\nLicense: CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/\n"
                "Subset selected from HyperFace-10k-LDM. Renamed files; source labels and per-image hashes are in manifest.json.\n"
            )
            completed = True
            print(
                f"Prepared {identities} synthetic identities, {identities * images} images; downloaded {reader.received / 1024 / 1024:.1f} MiB"
            )
    finally:
        if not completed and not peek:
            for output in written:
                output.unlink(missing_ok=True)


def build_pair_cases(destination):
    import cv2
    import numpy as np

    cv2.setNumThreads(1)
    destination = Path(destination)
    manifest = json.loads((destination / "manifest.json").read_text())
    identities = manifest["identities"]
    if (
        manifest.get("synthetic") is not True
        or manifest.get("dataset") != "HyperFace-10k-LDM"
        or manifest.get("license") != "CC-BY-SA-4.0"
        or len(identities) < 4
        or len(identities) % 2
    ):
        raise RuntimeError("Invalid synthetic subset manifest")
    for identity in identities:
        if (
            not re.fullmatch(r"identity-\d{3}", identity["label"])
            or len(identity["images"]) < 2
        ):
            raise RuntimeError("Invalid synthetic identity")
        for image in identity["images"]:
            if not re.fullmatch(
                re.escape(identity["label"]) + r"/image-\d{2}\.(png|jpe?g)",
                image["file"],
            ):
                raise RuntimeError("Invalid synthetic image path")
            if (
                hashlib.sha256((destination / image["file"]).read_bytes()).hexdigest()
                != image["sha256"]
            ):
                raise RuntimeError("Synthetic image checksum mismatch")
    if "pairCases" in manifest:
        for case in manifest["pairCases"]:
            for photo in case["photos"]:
                if not re.fullmatch(
                    r"pair-\d{2}/(both|not-both)/[a-z-]+-\d{2}\.png", photo["file"]
                ):
                    raise RuntimeError("Invalid synthetic pair path")
                digest = hashlib.sha256(
                    (destination / photo["file"]).read_bytes()
                ).hexdigest()
                if "sha256" in photo and photo["sha256"] != digest:
                    raise RuntimeError("Synthetic pair checksum mismatch")
                photo["sha256"] = digest
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2))
        print(
            "Reused the existing synthetic pair fixtures and verified their checksums"
        )
        return
    cases = []

    def mosaic(paths, output):
        canvas = np.full((176, len(paths) * 160 + 16, 3), 230, dtype=np.uint8)
        for index, path in enumerate(paths):
            image = cv2.imread(str(destination / path))
            if image is None:
                raise RuntimeError("Could not read a downloaded synthetic image")
            canvas[24:152, index * 160 + 24 : index * 160 + 152] = cv2.resize(
                image, (128, 128)
            )
        if not cv2.imwrite(str(output), canvas):
            raise RuntimeError("Could not save a synthetic pair fixture")

    for index in range(0, len(identities), 2):
        a, b = identities[index : index + 2]
        c = identities[(index + 2) % len(identities)]
        d = identities[(index + 3) % len(identities)]
        folder = destination / f"pair-{index // 2:02d}"
        if folder.exists():
            raise RuntimeError(
                "Pair fixtures already exist. Reuse the existing manifest."
            )
        (folder / "both").mkdir(parents=True)
        (folder / "not-both").mkdir()
        shutil.copyfile(destination / a["images"][0]["file"], folder / "you.png")
        shutil.copyfile(destination / b["images"][0]["file"], folder / "partner.png")
        photos = []
        for image_index in range(1, min(len(a["images"]), len(b["images"]))):
            images = [
                identity["images"][image_index]["file"] for identity in [a, b, c, d]
            ]
            specifications = [
                ("both", "pair", images[:2]),
                ("both", "group", images[:3]),
                ("not-both", "one-plus-other", [images[0], images[2]]),
                ("not-both", "other-plus-one", [images[2], images[1]]),
                ("not-both", "unrelated", images[2:]),
            ]
            for category, name, paths in specifications:
                output = folder / category / f"{name}-{image_index:02d}.png"
                mosaic(paths, output)
                photos.append(
                    {
                        "file": str(output.relative_to(destination)),
                        "bothPresent": category == "both",
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "kind": name,
                        "sourceImages": paths,
                    }
                )
            for name, source in [("solo-you", images[0]), ("solo-partner", images[1])]:
                output = folder / "not-both" / f"{name}-{image_index:02d}.png"
                shutil.copyfile(destination / source, output)
                photos.append(
                    {
                        "file": str(output.relative_to(destination)),
                        "bothPresent": False,
                        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
                        "kind": name,
                        "sourceImages": [source],
                    }
                )
        cases.append(
            {
                "label": folder.name,
                "you": a["label"],
                "partner": b["label"],
                "photos": photos,
            }
        )
    manifest["pairCases"] = cases
    manifest["modifications"] = (
        "Pair and group fixtures are artificial mosaics of separate synthetic portraits, resized to 128px with padding. Solo and reference fixtures are copied. Not natural group photos."
    )
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2))
    with (destination / "ATTRIBUTION.txt").open("a") as stream:
        stream.write(
            "Additional modifications: portrait mosaics and resized face tiles used for artificial pair tests. Derivatives remain CC BY-SA 4.0.\n"
        )
    print(
        f"Prepared {len(cases)} reference pairs and {sum(len(case['photos']) for case in cases)} artificial pair-classification cases"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("destination")
    parser.add_argument("--peek", action="store_true")
    parser.add_argument("--build-pairs", action="store_true")
    parser.add_argument("--identities", type=int, default=16)
    parser.add_argument("--skip-identities", type=int, default=0)
    args = parser.parse_args()
    if args.build_pairs:
        build_pair_cases(args.destination)
    else:
        if (
            not 4 <= args.identities <= 48
            or args.identities % 2
            or not 0 <= args.skip_identities <= 48
        ):
            parser.error(
                "Use an even identity count from 4 to 48 and a skip count from 0 to 48"
            )
        prepare(
            args.destination,
            identities=args.identities,
            peek=args.peek,
            skip_identities=args.skip_identities,
        )
