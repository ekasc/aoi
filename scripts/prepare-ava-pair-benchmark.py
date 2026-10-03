"""Prepare full-frame AVA track pairs from official annotations and videos only."""

import argparse
import csv
import hashlib
import itertools
import json
import re
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path('.expo/face-benchmark/ava-active-speaker')


def category(entities, a, b):
    if a == b:
        raise ValueError('Pair identities must differ')
    present = set(entities)
    if a in present and b in present:
        return 'positive'
    if a in present:
        return 'solo-a' if present == {a} else 'groups'
    if b in present:
        return 'solo-b' if present == {b} else 'groups'
    return 'negative' if present else None


def spaced(timestamps, milliseconds):
    result = []
    for timestamp in sorted(set(timestamps)):
        if not result or timestamp - result[-1] >= milliseconds:
            result.append(timestamp)
    return result


def check_temporal_integrity(references, queries, minimum_gap):
    if not references or not queries:
        raise ValueError('Both sides must contain frames')
    if min(t for t, _ in queries) - max(t for t, _ in references) < minimum_gap:
        raise ValueError('Enrollment/evaluation gap violated')
    reference_hashes = {digest for _, digest in references}
    query_hashes = [digest for _, digest in queries]
    if reference_hashes.intersection(query_hashes):
        raise ValueError('Reference/query content leakage')
    if len(query_hashes) != len(set(query_hashes)):
        raise ValueError('Duplicate query content')


def prepare_annotations():
    access = ROOT / 'access'
    access.mkdir(parents=True, exist_ok=True)
    names = ['ava_speech_file_names_v1.txt', 'ava_activespeaker_train_v1.0.tar.bz2',
             'ava_activespeaker_val_v1.0.tar.bz2']
    sources = []
    for name in names:
        url = ('https://s3.amazonaws.com/ava-dataset/annotations/' if name.endswith('.txt')
               else 'https://research.google.com/ava/download/') + name
        dest = access / name
        if not dest.exists():
            with urllib.request.urlopen(url, timeout=120) as response:
                data = response.read(100_000_001)
                if len(data) > 100_000_000:
                    raise ValueError('Annotation archive exceeds 100 MB limit')
            temporary = dest.with_suffix(dest.suffix + '.part')
            temporary.write_bytes(data)
            temporary.rename(dest)
        sources.append({'url': url, 'file': name, 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest()})
    annotations = ROOT / 'annotations'
    annotations.mkdir(exist_ok=True)
    for name in names[1:]:
        with tarfile.open(access / name) as archive:
            for member in archive.getmembers():
                if member.isfile() and member.name.endswith('-activespeaker.csv'):
                    (annotations / Path(member.name).name).write_bytes(archive.extractfile(member).read())
    (access / 'annotation-provenance.json').write_text(json.dumps(sources, indent=2) + '\n')


def read_frames(path):
    frames = defaultdict(dict)
    expected_video = path.name.removesuffix('-activespeaker.csv')
    for row in csv.reader(path.open()):
        if len(row) != 8:
            raise ValueError('Expected eight AVA CSV columns')
        if row[0] != expected_video or row[6] not in {'NOT_SPEAKING', 'SPEAKING_AUDIBLE', 'SPEAKING_NOT_AUDIBLE'}:
            raise ValueError('Unexpected video or label')
        timestamp = round(float(row[1]) * 1000)
        box = list(map(float, row[2:6]))
        if not (0 <= box[0] < box[2] <= 1 and 0 <= box[1] < box[3] <= 1):
            raise ValueError('Invalid normalized face box')
        if row[7] in frames[timestamp]:
            raise ValueError('Duplicate entity at timestamp')
        frames[timestamp][row[7]] = box
    return dict(frames)


def candidates(video, frames):
    tracks = defaultdict(set)
    together = defaultdict(list)
    for timestamp, entities in frames.items():
        for entity in entities:
            tracks[entity].add(timestamp)
        for pair in itertools.combinations(sorted(entities), 2):
            together[pair].append(timestamp)
    result = []
    for (a, b), overlap in together.items():
        overlap.sort()
        if min(len(overlap), len(tracks[a] - tracks[b]), len(tracks[b] - tracks[a])) < 20:
            continue
        start = overlap[0]
        eligible = [t for t in overlap if t <= start + 2000 and all(
            frames[t][e][2] - frames[t][e][0] >= 0.06 and
            frames[t][e][3] - frames[t][e][1] >= 0.06 for e in [a, b])]
        references = spaced(eligible, 500)[:4]
        positive = spaced([t for t in overlap if t >= start + 4000], 1000)
        if len(references) < 3 or len(positive) < 2:
            continue
        # Keep evaluation within the same pair-track scene plus ten seconds.
        end = max(max(tracks[a]), max(tracks[b])) + 10000
        queries = spaced([t for t in frames if start + 4000 <= t <= end], 1000)
        by_category = defaultdict(list)
        for t in queries:
            label = category(frames[t], a, b)
            if label:
                by_category[label].append(t)
        result.append({'video': video, 'a': a, 'b': b, 'references': references,
                       'queries': queries, 'categories': dict(by_category),
                       'rawPositive': len(overlap), 'rawOnlyA': len(tracks[a] - tracks[b]),
                       'rawOnlyB': len(tracks[b] - tracks[a]), 'start': start})
    return sorted(result, key=lambda p: (-len(p['categories'].get('positive', [])),
                                        -p['rawPositive'], p['a'], p['b']))


def fetch_video(filename):
    directory = ROOT / 'videos'
    directory.mkdir(exist_ok=True)
    dest = directory / filename
    record = directory / (filename + '.json')
    if dest.exists() and record.exists():
        metadata = json.loads(record.read_text())
        if hashlib.sha256(dest.read_bytes()).hexdigest() == metadata['sha256']:
            return dest
        raise ValueError('Cached video hash mismatch')
    url = 'https://s3.amazonaws.com/ava-dataset/trainval/' + filename
    request = urllib.request.Request(url, headers={'User-Agent': 'aoi-ava-local-benchmark/1.0'})
    with urllib.request.urlopen(request, timeout=120) as response:
        expected = int(response.headers.get('Content-Length', '0'))
        if expected > 800_000_000:
            raise ValueError('Video exceeds 800 MB limit')
        part = directory / (filename + '.part')
        digest = hashlib.sha256()
        count = 0
        with part.open('wb') as out:
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > 800_000_000:
                    raise ValueError('Video exceeds 800 MB limit')
                out.write(chunk)
                digest.update(chunk)
        if expected and count != expected:
            raise ValueError('Truncated video')
    part.rename(dest)
    record.write_text(json.dumps({'url': url, 'bytes': count, 'sha256': digest.hexdigest()}, indent=2) + '\n')
    return dest


def extract(video, timestamp, directory):
    dest = directory / (str(timestamp) + '.jpg')
    provenance = dest.with_suffix('.json')
    if dest.exists() and provenance.exists():
        record = json.loads(provenance.read_text())
        if hashlib.sha256(dest.read_bytes()).hexdigest() != record['sha256']:
            raise ValueError('Frame cache hash mismatch')
        if 'sourceStartTime' in record:
            return record
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'info', '-y', '-ss',
               str(timestamp / 1000), '-copyts', '-i', str(video), '-map', '0:v:0',
               '-frames:v', '1', '-fps_mode', 'passthrough', '-vf', 'showinfo',
               '-q:v', '2', str(dest)]
    run = subprocess.run(command, capture_output=True, text=True, timeout=60, check=True)
    match = re.search(r'n:\s*0\s+pts:\s*\S+\s+pts_time:([\d.]+).*?s:(\d+)x(\d+)', run.stderr)
    if not match:
        raise ValueError('No decoded-frame timestamp evidence')
    probe = json.loads(subprocess.check_output(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=start_time', '-of', 'json', str(video)], text=True))
    source_start = float(probe['format'].get('start_time', 0))
    actual = float(match[1]) - source_start
    if abs(actual - timestamp / 1000) > 0.05:
        raise ValueError('Decoded frame is not at the annotation timestamp')
    record = {'file': str(dest.relative_to(ROOT)), 'timestamp': timestamp,
              'decodedTimestamp': actual, 'sourceStartTime': source_start,
              'width': int(match[2]), 'height': int(match[3]),
              'sha256': hashlib.sha256(dest.read_bytes()).hexdigest()}
    provenance.write_text(json.dumps(record, indent=2) + '\n')
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pairs', type=int, default=10)
    options = parser.parse_args()
    if not 1 <= options.pairs <= 20:
        parser.error('--pairs must be between 1 and 20')
    prepare_annotations()
    filenames = {Path(name).stem: name for name in (ROOT / 'access/ava_speech_file_names_v1.txt').read_text().splitlines()}
    ranked = []
    for path in sorted((ROOT / 'annotations').glob('*.csv')):
        video = path.name.removesuffix('-activespeaker.csv')
        options_for_video = candidates(video, read_frames(path))
        if options_for_video and video in filenames:
            ranked.append(options_for_video[0])
    ranked.sort(key=lambda p: (-len(p['categories'].get('positive', [])), -p['rawPositive'], p['video']))
    print('Eligible videos:', len(ranked), flush=True)
    manifest = {'selection': 'One metadata-ranked pair per video; no recognition scores',
                'spacingMs': 1000, 'minimumGapMs': 2000, 'pairs': [], 'unavailable': []}
    for candidate in ranked:
        if len(manifest['pairs']) == options.pairs:
            break
        video_id = candidate['video']
        print('Downloading', video_id, flush=True)
        try:
            video = fetch_video(filenames[video_id])
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError) as error:
            manifest['unavailable'].append({'video': video_id, 'error': str(error)})
            print('Unavailable:', video_id, str(error), flush=True)
            continue
        frames = read_frames(ROOT / 'annotations' / (video_id + '-activespeaker.csv'))
        directory = ROOT / 'frames' / video_id
        directory.mkdir(parents=True, exist_ok=True)
        records = {}
        for t in sorted(set(candidate['references'] + candidate['queries'])):
            records[str(t)] = {**extract(video, t, directory), 'entities': frames[t]}
        ref_hashes = {records[str(t)]['sha256'] for t in candidate['references']}
        query_hashes = set()
        queries = []
        duplicate_queries = 0
        for t in candidate['queries']:
            hash_value = records[str(t)]['sha256']
            if hash_value in ref_hashes or hash_value in query_hashes:
                duplicate_queries += 1
                continue
            query_hashes.add(hash_value)
            queries.append(t)
        check_temporal_integrity(
            [(t, records[str(t)]['sha256']) for t in candidate['references']],
            [(t, records[str(t)]['sha256']) for t in queries], 2000)
        candidate['queries'] = queries
        candidate['pairId'] = f"pair-{len(manifest['pairs']) + 1:03d}"
        candidate['frames'] = records
        candidate['duplicateQueriesRemoved'] = duplicate_queries
        candidate['gapSeconds'] = (min(queries) - max(candidate['references'])) / 1000
        candidate['categories'] = {label: [t for t in queries if category(frames[t], candidate['a'], candidate['b']) == label]
                                   for label in ['positive', 'solo-a', 'solo-b', 'groups', 'negative']}
        # Layout is for inspection; the evaluator uses the identity/box manifest.
        pair_directory = ROOT / 'pairs' / candidate['pairId']
        for label, ts in candidate['categories'].items():
            (pair_directory / label).mkdir(parents=True, exist_ok=True)
            for t in ts:
                target = pair_directory / label / (str(t) + '.jpg')
                if not target.exists():
                    target.hardlink_to(ROOT / records[str(t)]['file'])
        (pair_directory / 'references').mkdir(parents=True, exist_ok=True)
        for person in ['a', 'b']:
            for index, t in enumerate(candidate['references']):
                target = pair_directory / 'references' / f'{person}-{index}.jpg'
                if not target.exists():
                    target.hardlink_to(ROOT / records[str(t)]['file'])
        manifest['pairs'].append(candidate)
        (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print(candidate['pairId'], {k: len(v) for k, v in candidate['categories'].items()}, 'gap', candidate['gapSeconds'], flush=True)
        time.sleep(1)
    if len(manifest['pairs']) < options.pairs:
        print('Pair target shortfall:', len(manifest['pairs']), '/', options.pairs)


if __name__ == '__main__':
    main()
