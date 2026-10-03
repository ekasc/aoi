"""Small public-figure diagnostic set, with publisher captions and license evidence."""

import argparse
import hashlib
import json
import time
from pathlib import Path
import urllib.parse
import urllib.request
import urllib.error

CATALOG = [
    ("you.jpg", "Barack Obama.jpg", "reference", "Obama Senate portrait, 2005"),
    (
        "partner.jpg",
        "Joe Biden official portrait crop.jpg",
        "reference",
        "Biden vice-presidential portrait, 2009",
    ),
    (
        "extra-you.jpg",
        "President Barack Obama.jpg",
        "extra-reference",
        "Obama presidential portrait, 2012",
    ),
    (
        "extra-partner.jpg",
        "Joe Biden official portrait 2013.jpg",
        "extra-reference",
        "Biden vice-presidential portrait, 2013",
    ),
    (
        "both/cabinet-2009.jpg",
        "President Barack Obama with full cabinet 09-10-09.jpg",
        "both",
        "Publisher lists both in the back row",
    ),
    (
        "both/oval-2012.jpg",
        "Obama Biden and Clinton in the Oval Office.jpg",
        "both",
        "Publisher caption names President, Vice President and Secretary Clinton",
    ),
    (
        "both/oval-2015.jpg",
        "Barack Obama and Joe Biden in the Oval Office - 2015.jpg",
        "both",
        "Publisher title and caption identify both",
    ),
    (
        "both/advisors-2012.jpg",
        "Barack Obama, with Joe Biden and senior advisors, Oval Office (November 2012)(8247639867).jpg",
        "both",
        "Publisher title identifies both among advisors",
    ),
    (
        "both/cabinet-room.jpg",
        "Barack Obama and Joe Biden in the Cabinet Room of the White House.jpg",
        "both",
        "Publisher title identifies both",
    ),
    (
        "not-both/presidents-2009.jpg",
        "President-elect Obama with former Presidents Bush (41), Carter and Clinton and current President Bush.jpg",
        "not-both",
        "Complete five-president caption includes Obama, not Biden",
    ),
    (
        "not-both/clinton-portrait.jpg",
        "Hillary Clinton official Secretary of State portrait crop.jpg",
        "not-both",
        "Solo portrait of Secretary Clinton",
    ),
]


class PublisherRateLimit(RuntimeError):
    pass


def fetch(url, limit):
    request = urllib.request.Request(
        url, headers={"User-Agent": "AoiLocalBenchmark/1.0"}
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(limit + 1)
            break
        except urllib.error.HTTPError as error:
            error.close()
            if error.code != 429 or attempt == 2:
                raise
            retry = error.headers.get("Retry-After", "10")
            delay = int(retry) if retry.isdigit() else 10
            if delay > 30:
                raise PublisherRateLimit(
                    "Publisher requests a longer pause; rerun preparation later"
                ) from error
            time.sleep(max(1, delay))
    if len(data) > limit:
        raise RuntimeError("Public benchmark download exceeded its size limit")
    return data


def prepare(directory, offline=False):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / "sources.json"
    if manifest.exists():
        saved = json.loads(manifest.read_text())
        allowed = {item[0] for item in CATALOG}
        for item in saved["images"]:
            if item["file"] not in allowed:
                raise RuntimeError("Unexpected cached public benchmark file")
            if (
                hashlib.sha256((directory / item["file"]).read_bytes()).hexdigest()
                != item["sha256"]
            ):
                raise RuntimeError("Existing public benchmark checksum mismatch")
        if saved.get("complete") is True:
            print("Reused hash-verified public group-photo benchmark")
            return
    images = saved["images"] if manifest.exists() else []
    unavailable = []
    received = sum(item["bytes"] for item in images)
    for file, title, role, ground_truth in CATALOG:
        if any(item["file"] == file for item in images):
            continue
        if offline:
            unavailable = [
                {"file": item[0], "reason": "Not downloaded; offline preparation"}
                for item in CATALOG
                if not any(image["file"] == item[0] for image in images)
            ]
            break
        query = urllib.parse.urlencode(
            {
                "action": "query",
                "format": "json",
                "titles": "File:" + title,
                "prop": "imageinfo",
                "iiprop": "url|extmetadata|sha1|size",
            }
        )
        metadata = json.loads(
            fetch("https://commons.wikimedia.org/w/api.php?" + query, 2_000_000)
        )
        page = next(iter(metadata["query"]["pages"].values()))
        info = page["imageinfo"][0]
        evidence = info["extmetadata"]
        license_name = evidence.get("LicenseShortName", {}).get("value", "")
        if license_name not in {"Public domain", "CC BY 3.0", "CC BY 4.0"} or (
            license_name == "Public domain"
            and evidence.get("Copyrighted", {}).get("value") != "False"
        ):
            raise RuntimeError(
                "Review changed or missing photo license before downloading"
            )
        url = info["url"]
        if urllib.parse.urlparse(url).hostname != "upload.wikimedia.org":
            raise RuntimeError("Unexpected public benchmark image host")
        output = directory / file
        try:
            data = output.read_bytes() if output.exists() else fetch(url, 20_000_000)
        except (urllib.error.HTTPError, PublisherRateLimit) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code != 429:
                raise
            unavailable = [
                {"file": item[0], "reason": "Publisher rate limit; preparation stopped"}
                for item in CATALOG
                if not any(image["file"] == item[0] for image in images)
            ]
            break
        received += len(data)
        if received > 100_000_000:
            raise RuntimeError("Public benchmark total download budget exceeded")
        if hashlib.sha1(data).hexdigest() != info["sha1"]:
            raise RuntimeError("Publisher image checksum mismatch")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        images.append(
            {
                "file": file,
                "role": role,
                "title": title,
                "source": info["descriptionurl"],
                "groundTruthBasis": ground_truth,
                "publisherMetadata": evidence,
                "sha256": hashlib.sha256(data).hexdigest(),
                "bytes": len(data),
            }
        )
        print(f"Prepared {role}: {title}", flush=True)
        manifest.write_text(
            json.dumps(
                {
                    "publicFiguresOnly": True,
                    "complete": False,
                    "plannedImages": len(CATALOG),
                    "unavailable": [
                        {"file": item[0], "reason": "Preparation pending"}
                        for item in CATALOG
                        if not any(image["file"] == item[0] for image in images)
                    ],
                    "images": images,
                }
            )
        )
        time.sleep(1)
    if len({item["sha256"] for item in images}) != len(images):
        raise RuntimeError("Exact duplicate public benchmark input")
    manifest.write_text(
        json.dumps(
            {
                "publicFiguresOnly": True,
                "complete": not unavailable,
                "unavailable": unavailable,
                "plannedImages": len(CATALOG),
                "purpose": "Local diagnostic testing, not advertising or endorsement",
                "limitations": "One public-figure pair, small hand-selected set, not an accuracy benchmark or untouched validation set",
                "images": images,
            },
            indent=2,
        )
    )
    print(f"Prepared {len(images)} images, {received / 1024 / 1024:.1f} MiB")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    prepare(args.directory, offline=args.offline)
