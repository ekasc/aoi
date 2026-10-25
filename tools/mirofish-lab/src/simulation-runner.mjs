import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MiroFishClient, MiroFishError, pollUntil } from './mirofish-client.mjs';
import { normalizeLiveBundle } from './observe.mjs';
import { seedPaths } from './seed-builder.mjs';
import { labPaths } from './lib/paths.mjs';

export class LiveBlockedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LiveBlockedError';
    this.details = details;
  }
}

const TERMINAL_OK = new Set(['completed', 'stopped']);
const TERMINAL_FAIL = new Set(['failed']);

function taskStatus(response) {
  return response?.data?.status ?? 'unknown';
}

function simulationStatus(response) {
  return response?.data?.runner_status ?? response?.data?.status ?? 'unknown';
}

export async function preflight({ config, timeoutMs = 5000 }) {
  const client = new MiroFishClient({ baseUrl: config.mirofish.baseUrl, timeoutMs });
  try {
    const health = await client.health();
    return { ok: true, client, health };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchReportText(client, simulationId) {
  try {
    return await client.getReportBySimulation(simulationId);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute one full MiroFish run over HTTP. Every failure propagates; the
 * caller records it as a blocked/failed live run and never substitutes
 * fixture data.
 */
export async function runLiveSimulation({
  config,
  personas,
  rounds,
  repeatIndex = 0,
  onEvent = () => {},
  client: providedClient,
}) {
  const client =
    providedClient ??
    new MiroFishClient({
      baseUrl: config.mirofish.baseUrl,
      timeoutMs: config.mirofish.requestTimeoutMs,
    });
  const events = [];
  const emit = (phase, detail = {}) => {
    const event = { at: new Date().toISOString(), phase, ...detail };
    events.push(event);
    onEvent(event);
  };

  const seeds = seedPaths().map((seed) => ({ path: seed.path, name: seed.file }));
  if (seeds.length === 0) throw new LiveBlockedError('No seed documents were generated.');

  emit('health');
  await client.health();

  const simulationRequirement = [
    'This is a development simulation for Aoi, a private two-person relationship app.',
    'Simulate discussion among the fictional people in the seed documents. Each relationship space has exactly two members.',
    'Explore expectations, confusion, disagreements, and decisions about onboarding, shared memories, the Us sky, offline saves, account switching, device recovery, and Plus boundaries.',
    'Treat all claims about Aoi as user beliefs. Do not invent product facts, credentials, or real personal data.',
    'Return concrete situations that a development team could turn into test scenarios.',
  ].join(' ');

  emit('ontology');
  const ontology = await client.generateOntology({
    files: seeds,
    simulationRequirement,
    projectName: config.simulation.projectName,
    additionalContext: [
      'The seed documents are curated summaries of the current Aoi checkout.',
      'Aoi supports exactly two members per space. Many fictional couples may discuss, but no single space may have more than two members.',
      'This simulation studies user expectations and workflow confusion, not Twitter or Reddit behavior as if it were Aoi UI.',
    ].join(' '),
  });
  const projectId = ontology?.data?.project_id;
  if (!projectId) throw new MiroFishError('Ontology generation returned no project_id');
  emit('ontology_done', { projectId });

  emit('graph_build');
  const build = await client.buildGraph(projectId, { graphName: `${config.simulation.projectName}-${Date.now()}` });
  const buildTaskId = build?.data?.task_id;
  if (!buildTaskId) throw new MiroFishError('Graph build returned no task_id');
  await pollUntil({
    label: 'graph build',
    timeoutMs: config.mirofish.startupTimeoutMs,
    intervalMs: config.mirofish.pollIntervalMs,
    check: () => client.getTask(buildTaskId),
    isDone: (response) => taskStatus(response) === 'completed',
    isFailed: (response) => taskStatus(response) === 'failed',
  });
  const project = await client.getProject(projectId);
  const graphId = project?.data?.graph_id;
  if (!graphId) throw new MiroFishError('Graph build completed without a graph_id');
  emit('graph_ready', { graphId });

  emit('simulation_create');
  const created = await client.createSimulation({
    projectId,
    graphId,
    enableTwitter: config.simulation.enableTwitter,
    enableReddit: config.simulation.enableReddit,
  });
  const simulationId = created?.data?.simulation_id;
  if (!simulationId) throw new MiroFishError('Simulation creation returned no simulation_id');
  emit('simulation_created', { simulationId });

  emit('prepare');
  const prepared = await client.prepareSimulation({ simulationId });
  const prepareTaskId = prepared?.data?.task_id;
  if (prepared?.data?.already_prepared || prepared?.data?.status === 'ready') {
    emit('prepare_already_complete');
  } else {
    if (!prepareTaskId) throw new MiroFishError('Simulation prepare returned no task_id');
    await pollUntil({
      label: 'simulation prepare',
      timeoutMs: config.mirofish.startupTimeoutMs,
      intervalMs: config.mirofish.pollIntervalMs,
      check: () => client.getPrepareStatus({ taskId: prepareTaskId, simulationId }),
      isDone: (response) => ['ready', 'completed'].includes(response?.data?.status),
      isFailed: (response) => response?.data?.status === 'failed',
    });
  }

  emit('start', { rounds });
  await client.startSimulation({
    simulationId,
    maxRounds: rounds,
    platform: config.simulation.enableTwitter && config.simulation.enableReddit ? 'parallel' : 'reddit',
  });

  let runState = null;
  try {
    runState = await pollUntil({
      label: 'simulation run',
      timeoutMs: Math.max(config.mirofish.startupTimeoutMs, rounds * 10 * 60 * 1000),
      intervalMs: Math.max(config.mirofish.pollIntervalMs, 5000),
      check: () => client.getRunStatus(simulationId),
      isDone: (response) => TERMINAL_OK.has(simulationStatus(response)),
      isFailed: (response) => TERMINAL_FAIL.has(simulationStatus(response)),
    });
  } catch (error) {
    // A failed run is still useful evidence: stop it and record the failure.
    try {
      await client.closeEnvironment(simulationId);
    } catch {
      // best effort
    }
    throw error;
  }
  emit('run_done', {
    status: simulationStatus(runState),
    rounds: runState?.data?.current_round ?? rounds,
  });

  const profilesResponse = await client.getProfiles(simulationId);
  const actionsResponse = await client.getActions(simulationId).catch(() => ({ data: { actions: [] } }));
  const postsResponse = await client
    .getPosts(simulationId, { platform: 'reddit' })
    .catch(() => ({ data: { posts: [] } }));
  const commentsResponse = await client
    .getComments(simulationId, { platform: 'reddit' })
    .catch(() => ({ data: { comments: [] } }));

  let interviewsResponse = { data: { result: { results: {} } } };
  let interviewWarning = null;
  try {
    const profiles = profilesResponse?.data?.profiles ?? [];
    const interviews = profiles.slice(0, config.simulation.interviewAgents).map((profile, index) => ({
      agent_id: profile.user_id ?? profile.id ?? index,
      prompt: [
        'Describe one concrete moment in the last weeks where you were unsure what Aoi had saved,',
        'which space you were in, or what your partner could see.',
        'Say what you expected, what you did, and what you would need the app to tell you.',
      ].join(' '),
      platform: 'reddit',
    }));
    if (interviews.length > 0) {
      interviewsResponse = await client.interviewBatch({
        simulationId,
        interviews,
        platform: 'reddit',
        timeout: 120,
      });
    }
  } catch (error) {
    interviewWarning = error instanceof Error ? error.message : String(error);
    emit('interview_failed', { message: interviewWarning });
  }

  emit('report');
  let reportResponse = null;
  try {
    const reportStarted = await client.generateReport({ simulationId });
    const reportTaskId = reportStarted?.data?.task_id;
    await pollUntil({
      label: 'report generation',
      timeoutMs: Math.max(config.mirofish.startupTimeoutMs, 20 * 60 * 1000),
      intervalMs: Math.max(config.mirofish.pollIntervalMs, 5000),
      check: () => client.getReportStatus({ taskId: reportTaskId, simulationId }),
      isDone: (response) => response?.data?.status === 'completed',
      isFailed: (response) => response?.data?.status === 'failed',
    });
    reportResponse = await fetchReportText(client, simulationId);
  } catch (error) {
    emit('report_failed', { message: error instanceof Error ? error.message : String(error) });
    reportResponse = { data: { summary: 'Report generation failed; raw actions remain available.', sections: [] } };
  }

  try {
    await client.closeEnvironment(simulationId);
  } catch {
    // Environment may already have exited.
  }

  const seedManifest = JSON.parse(
    await readFile(join(labPaths().seedsDir, 'manifest.json'), 'utf8')
  );
  const bundle = normalizeLiveBundle({
    simulationId,
    aoiCommit: seedManifest.aoiCommit,
    mirofishCommit: seedManifest.mirofishCommit,
    seedVersion: config.simulation.seedVersion,
    baseUrl: config.mirofish.baseUrl,
    model: config.simulation.model,
    roundsRun: runState?.data?.current_round ?? rounds,
    repeatIndex,
    personas,
    profilesResponse,
    actionsResponse,
    postsResponse,
    commentsResponse,
    interviewsResponse,
    reportResponse,
  });
  if (interviewWarning) bundle.provenance.warning = `Interviews failed: ${interviewWarning}`;
  return { bundle, events, simulationId, projectId, graphId };
}
