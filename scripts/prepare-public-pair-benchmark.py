"""Build a natural-photo identity-pair benchmark from Wikimedia Commons.

Ground truth comes from curated Commons categories, not filenames or search
terms. Each pair gets an isolated dataset so one pair's enrollment cannot
contaminate another. Downloads are cached, resumable, throttled, and checked
against the publisher's SHA-1. Nothing here is committed.

    python3 scripts/prepare-public-pair-benchmark.py --probe
    python3 scripts/prepare-public-pair-benchmark.py --build --pairs obama-michelle
"""

import argparse
import hashlib
import json
import time
from pathlib import Path
import urllib.parse
import urllib.request
import urllib.error

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "aoi-face-pair-benchmark/1.0 (local research; https://github.com/ekasc/aoi)"
DESTINATION = Path(".expo/face-benchmark/public-natural")
REQUEST_PAUSE = 1.1
DOWNLOAD_PAUSE = 0.4
ACCEPTED_LICENSES = {
    "Public domain",
    "CC0",
    "CC BY 2.0",
    "CC BY 2.5",
    "CC BY 3.0",
    "CC BY 4.0",
    "CC BY-SA 2.0",
    "CC BY-SA 2.5",
    "CC BY-SA 3.0",
    "CC BY-SA 4.0",
}

# Category membership is the ground-truth basis. `both` must name both people,
# `soloA`/`soloB` are curated portrait categories, `negative` is a different
# person, and `groups` is one target with other people.
PAIRS = [
    {
        "key": "bush-laura",
        "nameA": "George W. Bush",
        "nameB": "Laura Bush",
        "matchA": ["George W. Bush"],
        "matchB": ["Laura Bush"],
        "both": ["Category:Laura and George Bush"],
        "soloA": ["Category:George W. Bush in 2005"],
        "soloB": ["Category:Laura Bush in 2005"],
        "negative": ["Category:Dick Cheney in 2005", "Category:John Kerry in 2005"],
        "groups": ["Category:George W. Bush and Dick Cheney in 2008", "Category:George W. Bush and Dick Cheney in 2004"],
    },
    {
        "key": "clinton-hillary",
        "nameA": "Bill Clinton",
        "nameB": "Hillary Clinton",
        "matchA": ["Bill Clinton"],
        "matchB": ["Hillary Clinton", "Hillary Rodham Clinton"],
        "both": ["Category:Bill and Hillary Clinton in 1993", "Category:Bill and Hillary Clinton in 1994"],
        "soloA": ["Category:Bill Clinton in 1993"],
        "soloB": ["Category:Hillary Rodham Clinton in 1993", "Category:Portrait photographs of Hillary Rodham Clinton"],
        "negative": ["Category:Al Gore in 1993", "Category:George H. W. Bush in 1993"],
        "groups": ["Category:Bill Clinton and Al Gore"],
    },
    {
        "key": "obama-michelle",
        "nameA": "Barack Obama",
        "nameB": "Michelle Obama",
        "matchA": ["Barack Obama"],
        "matchB": ["Michelle Obama"],
        "both": ["Category:Michelle and Barack Obama in 2010"],
        "soloA": ["Category:Portraits of Barack Obama"],
        "soloB": ["Category:Michelle Obama in March 2010", "Category:Michelle Obama in July 2010", "Category:Michelle Obama in April 2010"],
        "negative": ["Category:Hillary Rodham Clinton in 2009"],
        "groups": ["Category:Barack Obama and Joe Biden"],
    },
]


class RateLimited(RuntimeError):
    pass


def fetch(url, limit):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(limit + 1)
            if len(data) > limit:
                raise RuntimeError("Download exceeded its size limit")
            return data
        except urllib.error.HTTPError as error:
            error.close()
            if error.code != 429 or attempt == 3:
                raise
            retry = error.headers.get("Retry-After", "8")
            delay = int(retry) if retry.isdigit() else 8
            if delay > 60:
                raise RateLimited("Publisher asked for a long pause; rerun later")
            time.sleep(delay)
    raise RateLimited("Publisher rate limit")


def api(params):
    time.sleep(REQUEST_PAUSE)
    query = urllib.parse.urlencode({"action": "query", "format": "json", **params})
    return json.loads(fetch(API + "?" + query, 8_000_000))


def category_files(category, limit):
    """File titles in a category, most recent first, paginated."""
    titles = []
    continuation = None
    while len(titles) < limit:
        params = {
            "list": "categorymembers",
            "cmtitle": category,
            "cmtype": "file",
            "cmlimit": "200",
        }
        if continuation:
            params["cmcontinue"] = continuation
        data = api(params)
        titles.extend(item["title"] for item in data.get("query", {}).get("categorymembers", []))
        continuation = data.get("continue", {}).get("cmcontinue")
        if not continuation:
            break
    return titles[:limit]


def image_info(titles):
    """Imageinfo for up to 50 file titles per request. Asks for a 1600px derivative."""
    info = {}
    for start in range(0, len(titles), 50):
        batch = titles[start : start + 50]
        data = api({
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|sha1|size|mime",
            "iiurlwidth": "1600",
        })
        for page in data.get("query", {}).get("pages", {}).values():
            if "imageinfo" in page:
                info[page["title"]] = page["imageinfo"][0]
    return info


def license_ok(extmetadata):
    name = extmetadata.get("LicenseShortName", {}).get("value", "")
    if name not in ACCEPTED_LICENSES:
        return False
    if name == "Public domain" and extmetadata.get("Copyrighted", {}).get("value") != "False":
        return False
    return True


def role_matches(label, metadata, pair):
    """Cross-check the image's own categories against the expected people.

    Category membership alone puts group photos in solo folders and document
    scans in negative folders. Requiring the image to carry the right person
    categories, and not the wrong ones, excludes the obvious contradictions.
    Third-party contamination can still survive this check, so it is a filter,
    not a guarantee.
    """
    text = metadata.get("Categories", {}).get("value", "").lower()
    has_a = any(name.lower() in text for name in pair["matchA"])
    has_b = any(name.lower() in text for name in pair["matchB"])
    if label in ("reference-a", "solo-a"):
        return has_a and not has_b
    if label in ("reference-b", "solo-b"):
        return has_b and not has_a
    if label == "positive":
        return has_a and has_b
    if label == "groups":
        return has_a != has_b
    if label == "negative":
        return not has_a and not has_b
    return True


def probe():
    for pair in PAIRS:
        print(f"== {pair['key']} ({pair['nameA']} + {pair['nameB']})")
        for role in ["both", "soloA", "soloB", "negative", "groups"]:
            for category in pair[role]:
                try:
                    data = api({
                        "prop": "categoryinfo",
                        "catinfo": "size|files|subcats",
                        "titles": category,
                    })
                    page = next(iter(data.get("query", {}).get("pages", {}).values()))
                    if "missing" in page:
                        print(f"   MISSING  {role:8} {category}")
                    else:
                        counts = page.get("categoryinfo", {})
                        print(f"   files={counts.get('files', 0):>5} subcats={counts.get('subcats', 0):>3}  {role:8} {category}")
                except (urllib.error.HTTPError, RateLimited) as error:
                    print(f"   ERROR    {role:8} {category}: {error}")
                    return


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def build_pair(pair, limits, offline):
    directory = DESTINATION / pair["key"]
    directory.mkdir(parents=True, exist_ok=True)
    manifest_path = directory / "sources.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"version": 1, "pair": pair["key"], "complete": False, "images": [], "unavailable": []}
    used_hashes = {item["sha256"] for item in manifest["images"]}
    reference_hashes = {item["sha256"] for item in manifest["images"] if item["role"].startswith("reference")}

    roles = [
        ("references/a", "soloA", limits["references"], "reference-a"),
        ("references/b", "soloB", limits["references"], "reference-b"),
        ("positive", "both", limits["positive"], "positive"),
        ("solo-a", "soloA", limits["solo-a"], "solo-a"),
        ("solo-b", "soloB", limits["solo-b"], "solo-b"),
        ("negative", "negative", limits["negative"], "negative"),
        ("groups", "groups", limits["groups"], "groups"),
    ]

    for folder, role, limit, label in roles:
        existing = [item for item in manifest["images"] if item["role"] == label]
        if len(existing) >= limit:
            print(f"   {pair['key']} {label}: {len(existing)} cached")
            continue
        candidates = []
        for category in pair[role]:
            try:
                candidates.extend(category_files(category, limit * 6))
            except (urllib.error.HTTPError, RateLimited) as error:
                manifest["unavailable"].append({"role": label, "category": category, "reason": str(error)})
                print(f"   {pair['key']} {label}: {category} failed: {error}")
        candidates = list(dict.fromkeys(candidates))
        if label.startswith("reference"):
            # Prefer titles that say portrait so a reference is more likely solo.
            candidates.sort(key=lambda title: (0 if "portrait" in title.lower() else 1))
        if not candidates:
            print(f"   {pair['key']} {label}: no candidates")
            continue
        try:
            info = image_info(candidates)
        except (urllib.error.HTTPError, RateLimited) as error:
            manifest["unavailable"].append({"role": label, "reason": str(error)})
            print(f"   {pair['key']} {label}: imageinfo failed: {error}")
            continue
        picked = 0
        for title in candidates:
            if picked + len(existing) >= limit:
                break
            entry = info.get(title)
            if not entry:
                continue
            metadata = entry.get("extmetadata", {})
            if entry.get("mime") != "image/jpeg":
                continue
            if not license_ok(metadata):
                continue
            if not role_matches(label, metadata, pair):
                continue
            output = directory / folder / f"{label}-{entry['sha1'][:12]}.jpg"
            output.parent.mkdir(parents=True, exist_ok=True)
            original = entry.get("size", 0) <= 12_000_000 and entry.get("url")
            source_url = entry["url"] if original else (entry.get("thumburl") or entry["url"])
            try:
                data = output.read_bytes() if output.exists() else fetch(source_url, 20_000_000)
                time.sleep(DOWNLOAD_PAUSE)
            except (urllib.error.HTTPError, RateLimited) as error:
                manifest["unavailable"].append({"role": label, "title": title, "reason": str(error)})
                break
            if original and hashlib.sha1(data).hexdigest() != entry["sha1"]:
                raise RuntimeError(f"Publisher checksum mismatch for {title}")
            digest = sha256(data)
            if digest in used_hashes:
                continue
            if label.startswith("reference") and digest in reference_hashes:
                continue
            if label == "reference-a" and digest in reference_hashes:
                continue
            output.write_bytes(data)
            used_hashes.add(digest)
            if label.startswith("reference"):
                reference_hashes.add(digest)
            manifest["images"].append({
                "file": str(output.relative_to(directory)),
                "role": label,
                "title": title,
                "source": entry.get("descriptionurl"),
                "license": metadata.get("LicenseShortName", {}).get("value", ""),
                "artist": metadata.get("Artist", {}).get("value", ""),
                "sha256": digest,
                "publisherSha1": entry["sha1"],
                "scaled": not original,
                "bytes": len(data),
            })
            picked += 1
            print(f"   {pair['key']} {label}: {len(existing) + picked}/{limit} {title}", flush=True)
        manifest_path.write_text(json.dumps(manifest, indent=2))
    # A reference must never also be an evaluation photo.
    evaluation = {item["sha256"] for item in manifest["images"] if not item["role"].startswith("reference")}
    overlap = reference_hashes & evaluation
    manifest["referenceEvaluationOverlap"] = len(overlap)
    manifest["complete"] = len(manifest["images"]) > 0 and not manifest["unavailable"]
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"   {pair['key']}: {len(manifest['images'])} images, overlap {len(overlap)}, unavailable {len(manifest['unavailable'])}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--pairs", default="")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--references", type=int, default=4)
    parser.add_argument("--positive", type=int, default=20)
    parser.add_argument("--solo-a", type=int, default=15)
    parser.add_argument("--solo-b", type=int, default=15)
    parser.add_argument("--negative", type=int, default=25)
    parser.add_argument("--groups", type=int, default=15)
    args = parser.parse_args()
    if args.probe:
        probe()
        return
    if not args.build:
        parser.error("Use --probe or --build")
    selected = {key for key in args.pairs.split(",") if key}
    limits = {"references": args.references, "positive": args.positive, "solo-a": args.solo_a, "solo-b": args.solo_b, "negative": args.negative, "groups": args.groups}
    for pair in PAIRS:
        if selected and pair["key"] not in selected:
            continue
        print(f"== {pair['key']}")
        build_pair(pair, limits, args.offline)


if __name__ == "__main__":
    main()
