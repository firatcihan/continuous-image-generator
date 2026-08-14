/** Every HTTP call goes through here; the error body becomes Error.message. */
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body && body.error) message = body.error;
    } catch {
      // body is not JSON; the status text is enough
    }
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  const type = response.headers.get('content-type') ?? '';
  return type.includes('application/json') ? response.json() : response.text();
}

export const api = {
  projects: () => request('/api/projects'),
  project: (id) => request(`/api/projects/${id}`),
  createProject: (name) =>
    request('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  saveProject: (id, project) =>
    request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(project) }),
  deleteProject: (id, deleteImages) =>
    request(`/api/projects/${id}${deleteImages ? '?deleteImages=1' : ''}`, { method: 'DELETE' }),
  preview: (id, basePrompt, rows) =>
    request(`/api/projects/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify({ basePrompt, rows }),
    }),
  gallery: (id) => request(`/api/projects/${id}/gallery`),
  openFolder: (id) => request(`/api/projects/${id}/open-folder`, { method: 'POST' }),

  job: () => request('/api/job'),
  startJob: (projectId) =>
    request('/api/job/start', { method: 'POST', body: JSON.stringify({ projectId }) }),
  pauseJob: () => request('/api/job/pause', { method: 'POST' }),
  resumeJob: () => request('/api/job/resume', { method: 'POST' }),
  stopJob: () => request('/api/job/stop', { method: 'POST' }),
  userReady: () => request('/api/job/user-ready', { method: 'POST' }),

  browser: () => request('/api/browser'),
  openBrowser: () => request('/api/browser/open', { method: 'POST' }),

  // CSV parsing happens on the server; no second parser is kept in the browser
  parseCsv: (content) =>
    request('/api/csv/parse', { method: 'POST', body: JSON.stringify({ content }) }),
  parseScript: (content) =>
    request('/api/script/parse', { method: 'POST', body: JSON.stringify({ content }) }),
};

/** Image URL — for <img src>. */
export function imageUrl(projectId, fileName) {
  return `/api/projects/${projectId}/image/${encodeURIComponent(fileName)}`;
}
