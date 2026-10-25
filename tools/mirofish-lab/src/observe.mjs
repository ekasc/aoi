import { TEMPLATES } from './templates.mjs';

function flatten(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value).map(flatten).join(' ');
  }
  return '';
}

function textOf(record) {
  const candidates = [
    record.content,
    record.text,
    record.body,
    record.title,
    record.action_args?.content,
    record.action_args?.text,
    record.action_args?.post,
    record.action_args?.comment,
    record.result,
    record.response,
  ];
  return candidates.map(flatten).find((value) => typeof value === 'string' && value.trim().length >= 20) ?? '';
}

function agentIdOf(record) {
  const candidates = [
    record.agent_id,
    record.user_id,
    record.author_id,
    record.userId,
    record.agentId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return Number(candidate);
  }
  const key = typeof record.user_id === 'string' ? record.user_id.match(/(\d+)/) : null;
  return key ? Number(key[1]) : null;
}

function profilesById(profilesResponse) {
  const profiles = profilesResponse?.data?.profiles ?? [];
  const map = new Map();
  for (const profile of profiles) {
    const id = agentIdOf(profile) ?? profile.user_id ?? profile.id;
    if (id === null || id === undefined) continue;
    map.set(Number(id), profile);
  }
  return map;
}

function personaForProfile(profile, personas) {
  if (!profile) return null;
  const haystack = [profile.name, profile.username, profile.bio, profile.persona]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const person of personas.personas) {
    const tokens = person.displayName.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
    const score = tokens.filter((token) => haystack.includes(token)).length;
    if (score > bestScore) {
      best = person;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

export function classifyText(text) {
  const haystack = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const template of TEMPLATES) {
    let score = 0;
    for (const keyword of template.keywords) {
      if (haystack.includes(keyword.toLowerCase())) score += 2;
    }
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

function pushCandidate(list, { text, agentId, round, source, platform, profiles, personas }) {
  if (!text || text.trim().length < 20) return;
  const template = classifyText(text);
  if (!template) return;
  const profile = profiles.get(agentId);
  const persona = personaForProfile(profile, personas);
  if (!persona) return;
  const key = text.trim().slice(0, 240).toLowerCase();
  if (list.some((entry) => entry.key === key)) return;
  list.push({
    key,
    text: text.trim().slice(0, 3900),
    agentId: agentId ?? 0,
    round: Number.isFinite(round) ? round : 0,
    source,
    platform,
    template,
    persona,
  });
}

function reportText(report) {
  if (!report) return { summary: '', findings: [] };
  const data = report.data ?? report;
  const sections = data.sections ?? data.report?.sections ?? [];
  const findings = [];
  if (Array.isArray(sections)) {
    for (const section of sections) {
      const title = section.title ?? section.heading ?? '';
      const content = flatten(section.content ?? section.body ?? '').trim();
      if (title || content) findings.push(`${title}${title && content ? ': ' : ''}${content}`.slice(0, 900));
    }
  }
  const summary =
    data.summary ??
    data.report?.summary ??
    data.markdown?.slice(0, 3000) ??
    (findings.length ? findings[0] : 'MiroFish report returned without a summary field.');
  return { summary: String(summary).slice(0, 3000), findings: findings.slice(0, 20) };
}

/**
 * Normalize raw MiroFish responses into a lab simulation bundle.
 * Nothing here invents data: empty responses produce an empty observation
 * list, and extraction will then fail its minimum-scenario check.
 */
export function normalizeLiveBundle({
  simulationId,
  aoiCommit,
  mirofishCommit,
  seedVersion,
  baseUrl,
  model,
  roundsRun,
  repeatIndex,
  personas,
  profilesResponse,
  actionsResponse,
  postsResponse,
  commentsResponse,
  interviewsResponse,
  reportResponse,
}) {
  const profiles = profilesById(profilesResponse);
  const candidates = [];

  for (const post of postsResponse?.data?.posts ?? []) {
    pushCandidate(candidates, {
      text: textOf(post),
      agentId: agentIdOf(post),
      round: post.round_num ?? post.round ?? 0,
      source: 'post',
      platform: 'reddit',
      profiles,
      personas,
    });
  }
  for (const comment of commentsResponse?.data?.comments ?? []) {
    pushCandidate(candidates, {
      text: textOf(comment),
      agentId: agentIdOf(comment),
      round: comment.round_num ?? comment.round ?? 0,
      source: 'comment',
      platform: 'reddit',
      profiles,
      personas,
    });
  }
  for (const action of actionsResponse?.data?.actions ?? []) {
    pushCandidate(candidates, {
      text: textOf(action),
      agentId: agentIdOf(action),
      round: action.round_num ?? 0,
      source: 'post',
      platform: action.platform ?? 'reddit',
      profiles,
      personas,
    });
  }

  const interviewResults = interviewsResponse?.data?.result?.results ?? {};
  for (const [key, value] of Object.entries(interviewResults)) {
    const agentId = Number(String(key).split('_').pop());
    if (!Number.isFinite(agentId)) continue;
    pushCandidate(candidates, {
      text: textOf(value),
      agentId,
      round: 0,
      source: 'interview',
      platform: 'interview',
      profiles,
      personas,
    });
  }

  const observations = candidates.slice(0, 120).map((candidate, index) => ({
    id: `obs-${String(index + 1).padStart(3, '0')}`,
    source: candidate.source,
    round: candidate.round,
    platform: candidate.source === 'interview' ? 'interview' : candidate.platform,
    agent_id: candidate.agentId,
    persona_id: candidate.persona.id,
    text: candidate.text,
    theme: candidate.template.experiment,
    signals: [candidate.template.key, ...candidate.template.signals.slice(0, 3)],
  }));

  const report = reportText(reportResponse);
  return {
    schemaVersion: 'aoi-simulation-bundle/1',
    mode: 'live',
    live: true,
    provenance: {
      simulation_id: simulationId,
      aoi_commit: aoiCommit,
      mirofish_commit: mirofishCommit,
      seed_version: seedVersion,
      generated_at: new Date().toISOString(),
      label: 'Live MiroFish simulation output, normalized by tools/mirofish-lab.',
      base_url: baseUrl,
      model,
      rounds_run: roundsRun,
      repeat_index: repeatIndex,
    },
    observations,
    report: {
      summary: report.summary || 'MiroFish report was empty.',
      findings: report.findings,
    },
  };
}


/**
 * Normalize a raw OASIS Reddit run (produced by oasis/run_oasis.py) into the
 * same bundle shape the extractor consumes. This is a local OASIS run, not a
 * MiroFish run, and it does not use Zep.
 */
export function normalizeOasisRaw(raw, { personas, aoiCommit, mirofishCommit, seedVersion, focus }) {
  if (raw?.schemaVersion !== 'aoi-oasis-raw/1') {
    throw new Error('OASIS raw output has an unsupported schemaVersion');
  }
  const personaById = new Map(personas.personas.map((person) => [person.id, person]));
  const agentMap = raw.agent_map ?? {};
  const candidates = [];

  const push = (item, source) => {
    const text = textOf(item);
    if (!text || text.trim().length < 20) return;
    const template = classifyText(text);
    if (!template) return;
    const agentId = agentIdOf(item);
    const personaId = agentMap[String(agentId)];
    const persona = personaById.get(personaId);
    if (!persona) return;
    const key = text.trim().slice(0, 240).toLowerCase();
    if (candidates.some((entry) => entry.key === key)) return;
    candidates.push({
      key,
      text: text.trim().slice(0, 3900),
      agentId: agentId ?? 0,
      persona,
      template,
      source,
    });
  };

  for (const post of raw.posts ?? []) push(post, 'post');
  for (const comment of raw.comments ?? []) push(comment, 'comment');

  const observations = candidates.slice(0, 60).map((candidate, index) => ({
    id: `obs-${String(index + 1).padStart(3, '0')}`,
    source: candidate.source,
    round: 0,
    platform: 'reddit',
    agent_id: candidate.agentId,
    persona_id: candidate.persona.id,
    text: candidate.text,
    theme: candidate.template.experiment,
    signals: [candidate.template.key, ...candidate.template.signals.slice(0, 3)],
  }));

  return {
    schemaVersion: 'aoi-simulation-bundle/1',
    mode: 'local_oasis',
    live: false,
    provenance: {
      simulation_id: raw.simulation_id,
      aoi_commit: aoiCommit,
      mirofish_commit: mirofishCommit,
      seed_version: seedVersion,
      generated_at: raw.finished_at ?? new Date().toISOString(),
      label:
        focus === 'security'
          ? 'Local OASIS security-focused discussion via MiroFish\'s upstream runner. This is not a MiroFish/Zep run.'
          : 'Local OASIS discussion via MiroFish\'s upstream runner. This is not a MiroFish/Zep run.',
      backend: 'oasis',
      model: raw.model,
      rounds_run: raw.rounds,
      couple_id: raw.couple_id,
      focus: focus ?? null,
    },
    observations,
    report: {
      summary: `Local OASIS discussion for ${raw.couple_id}; ${observations.length} classifiable observation(s).`,
      findings: [],
    },
  };
}
