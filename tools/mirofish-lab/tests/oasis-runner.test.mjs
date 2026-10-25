import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { labPaths } from '../src/lib/paths.mjs';

const python = process.env.PYTHON ?? 'python3';
const available = spawnSync(python, ['--version'], { encoding: 'utf8' }).status === 0;

test('OASIS wrapper invokes the upstream runner and dumps posts/comments', { skip: !available }, () => {
  const root = mkdtempSync(join(tmpdir(), 'aoi-oasis-wrapper-'));
  try {
    const home = join(root, 'MiroFish');
    const scripts = join(home, 'backend', 'scripts');
    mkdirSync(scripts, { recursive: true });
    const fakeRunner = join(scripts, 'run_reddit_simulation.py');
    writeFileSync(
      fakeRunner,
      `import argparse, os, sqlite3
parser = argparse.ArgumentParser()
parser.add_argument('--config')
parser.add_argument('--no-wait', action='store_true')
parser.add_argument('--max-rounds', type=int)
args = parser.parse_args()
sim_dir = os.path.dirname(os.path.abspath(args.config))
db = os.path.join(sim_dir, 'reddit_simulation.db')
if os.path.exists(db):
    os.remove(db)
conn = sqlite3.connect(db)
conn.executescript('''
create table post (post_id integer primary key autoincrement, user_id integer, content text, created_at text);
create table comment (comment_id integer primary key autoincrement, post_id integer, user_id integer, content text, created_at text);
''')
conn.execute("insert into post (user_id, content, created_at) values (0, 'I shared the invitation and assumed we were connected.', '2026-10-23T00:01:00Z')")
conn.execute("insert into comment (post_id, user_id, content, created_at) values (1, 1, 'I did not know I had to join the space.', '2026-10-23T00:02:00Z')")
conn.commit()
conn.close()
print('fake oasis complete')
`,
      'utf8'
    );
    const coupleDir = join(root, 'couple');
    mkdirSync(coupleDir, { recursive: true });
    const profilesPath = join(coupleDir, 'profiles.json');
    const configPath = join(coupleDir, 'config.json');
    const outPath = join(coupleDir, 'raw.json');
    writeFileSync(
      profilesPath,
      JSON.stringify([
        { user_id: 0, persona_id: 'p-alice' },
        { user_id: 1, persona_id: 'p-bob' },
      ]),
      'utf8'
    );
    writeFileSync(configPath, JSON.stringify({ simulation_id: 'test' }), 'utf8');

    const wrapper = join(labPaths().labRoot, 'oasis', 'run_oasis.py');
    const result = spawnSync(
      python,
      [
        wrapper,
        '--profiles',
        profilesPath,
        '--config',
        configPath,
        '--out',
        outPath,
        '--couple-id',
        'couple-01',
        '--rounds',
        '1',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          MIROFISH_HOME: home,
          LLM_API_KEY: 'test-key',
          LLM_BASE_URL: 'http://127.0.0.1:1/v1',
          LLM_MODEL_NAME: 'test-model',
        },
        timeout: 30000,
      }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const raw = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(raw.schemaVersion, 'aoi-oasis-raw/1');
    assert.equal(raw.couple_id, 'couple-01');
    assert.equal(raw.agent_map['0'], 'p-alice');
    assert.equal(raw.posts.length, 1);
    assert.equal(raw.comments.length, 1);
    assert.match(raw.posts[0].content, /invitation/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
