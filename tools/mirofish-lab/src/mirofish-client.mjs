import { readFile } from 'node:fs/promises';

export class MiroFishError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'MiroFishError';
    this.status = status;
    this.body = body;
  }
}

export class MiroFishClient {
  constructor({ baseUrl, timeoutMs = 60000 }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body, headers = {}, timeoutMs } = {}) {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !(body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 2000) };
    }
    if (!response.ok) {
      throw new MiroFishError(`MiroFish ${method} ${path} returned ${response.status}`, {
        status: response.status,
        body: parsed,
      });
    }
    if (parsed && parsed.success === false) {
      throw new MiroFishError(`MiroFish ${method} ${path} reported failure: ${parsed.error ?? 'unknown'}`, {
        status: response.status,
        body: parsed,
      });
    }
    return parsed;
  }

  async health() {
    return this.request('/health');
  }

  async generateOntology({ files, simulationRequirement, projectName, additionalContext }) {
    const form = new FormData();
    for (const file of files) {
      const bytes = await readFile(file.path);
      form.append('files', new Blob([bytes], { type: 'text/markdown' }), file.name);
    }
    form.append('simulation_requirement', simulationRequirement);
    form.append('project_name', projectName);
    if (additionalContext) form.append('additional_context', additionalContext);
    return this.request('/api/graph/ontology/generate', {
      method: 'POST',
      body: form,
      timeoutMs: Math.max(this.timeoutMs, 180000),
    });
  }

  async buildGraph(projectId, { graphName, chunkSize = 500, chunkOverlap = 50 } = {}) {
    return this.request('/api/graph/build', {
      method: 'POST',
      body: { project_id: projectId, graph_name: graphName, chunk_size: chunkSize, chunk_overlap: chunkOverlap },
      timeoutMs: Math.max(this.timeoutMs, 120000),
    });
  }

  async getTask(taskId) {
    return this.request(`/api/graph/task/${encodeURIComponent(taskId)}`);
  }

  async getProject(projectId) {
    return this.request(`/api/graph/project/${encodeURIComponent(projectId)}`);
  }

  async createSimulation({ projectId, graphId, enableTwitter = false, enableReddit = true }) {
    return this.request('/api/simulation/create', {
      method: 'POST',
      body: {
        project_id: projectId,
        ...(graphId ? { graph_id: graphId } : {}),
        enable_twitter: enableTwitter,
        enable_reddit: enableReddit,
      },
    });
  }

  async prepareSimulation({ simulationId, useLlmForProfiles = true, parallelProfileCount = 4 }) {
    return this.request('/api/simulation/prepare', {
      method: 'POST',
      body: {
        simulation_id: simulationId,
        use_llm_for_profiles: useLlmForProfiles,
        parallel_profile_count: parallelProfileCount,
      },
      timeoutMs: Math.max(this.timeoutMs, 120000),
    });
  }

  async getPrepareStatus({ taskId, simulationId }) {
    return this.request('/api/simulation/prepare/status', {
      method: 'POST',
      body: {
        ...(taskId ? { task_id: taskId } : {}),
        ...(simulationId ? { simulation_id: simulationId } : {}),
      },
    });
  }

  async getSimulation(simulationId) {
    return this.request(`/api/simulation/${encodeURIComponent(simulationId)}`);
  }

  async getProfiles(simulationId) {
    return this.request(`/api/simulation/${encodeURIComponent(simulationId)}/profiles`);
  }

  async startSimulation({ simulationId, maxRounds, platform = 'reddit' }) {
    return this.request('/api/simulation/start', {
      method: 'POST',
      body: {
        simulation_id: simulationId,
        platform,
        ...(maxRounds ? { max_rounds: maxRounds } : {}),
        enable_graph_memory_update: false,
        force: false,
      },
      timeoutMs: Math.max(this.timeoutMs, 120000),
    });
  }

  async getRunStatus(simulationId) {
    return this.request(`/api/simulation/${encodeURIComponent(simulationId)}/run-status/detail`);
  }

  async getActions(simulationId, { limit = 500, offset = 0 } = {}) {
    return this.request(
      `/api/simulation/${encodeURIComponent(simulationId)}/actions?limit=${limit}&offset=${offset}`
    );
  }

  async getPosts(simulationId, { platform = 'reddit', limit = 200, offset = 0 } = {}) {
    return this.request(
      `/api/simulation/${encodeURIComponent(simulationId)}/posts?platform=${platform}&limit=${limit}&offset=${offset}`
    );
  }

  async getComments(simulationId, { platform = 'reddit', limit = 500, offset = 0 } = {}) {
    return this.request(
      `/api/simulation/${encodeURIComponent(simulationId)}/comments?platform=${platform}&limit=${limit}&offset=${offset}`
    );
  }

  async interviewBatch({ simulationId, interviews, platform = 'reddit', timeout = 120 }) {
    return this.request('/api/simulation/interview/batch', {
      method: 'POST',
      body: { simulation_id: simulationId, interviews, platform, timeout },
      timeoutMs: Math.max(this.timeoutMs, (timeout + 30) * 1000),
    });
  }

  async generateReport({ simulationId, forceRegenerate = false }) {
    return this.request('/api/report/generate', {
      method: 'POST',
      body: { simulation_id: simulationId, force_regenerate: forceRegenerate },
      timeoutMs: Math.max(this.timeoutMs, 120000),
    });
  }

  async getReportStatus({ taskId, simulationId }) {
    return this.request('/api/report/generate/status', {
      method: 'POST',
      body: {
        ...(taskId ? { task_id: taskId } : {}),
        ...(simulationId ? { simulation_id: simulationId } : {}),
      },
    });
  }

  async getReportBySimulation(simulationId) {
    return this.request(`/api/report/by-simulation/${encodeURIComponent(simulationId)}`);
  }

  async closeEnvironment(simulationId) {
    return this.request('/api/simulation/close-env', {
      method: 'POST',
      body: { simulation_id: simulationId },
    });
  }
}

export async function pollUntil({
  check,
  timeoutMs,
  intervalMs = 5000,
  label = 'operation',
  isDone,
  isFailed,
}) {
  const started = Date.now();
  let last = null;
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await check();
      lastError = null;
      if (isDone(last)) return last;
      if (isFailed(last)) {
        throw new MiroFishError(`${label} failed: ${JSON.stringify(last).slice(0, 1000)}`);
      }
    } catch (error) {
      if (error instanceof MiroFishError) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : ` Last state: ${JSON.stringify(last).slice(0, 800)}`;
  throw new MiroFishError(`${label} timed out after ${timeoutMs}ms.${suffix}`);
}
