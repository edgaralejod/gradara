export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error(
      'Cannot reach the local simulation service. Check that the Gradara launcher is running, then try again.',
    );
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `The local simulation service returned an invalid response (${response.status}). Check that the Gradara launcher is running.`,
    );
  }
  if (!response.ok) {
    const detail = (data as { detail?: string | { msg: string }[] }).detail;
    throw new ApiError(
      Array.isArray(detail)
        ? detail.map((x: { msg: string }) => x.msg).join('\n')
        : (detail ?? 'The local service could not complete this request.'),
      response.status,
    );
  }
  return data as T;
}
export type Job<T> = {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  result?: T;
  error?: string;
};
export async function waitForJob<T>(
  id: string,
  signal?: AbortSignal,
): Promise<T> {
  while (!signal?.aborted) {
    const job = await api<Job<T>>(`/jobs/${id}`, { signal });
    if (job.status === 'complete') return job.result!;
    if (job.status === 'failed')
      throw new Error(job.error ?? 'The operation failed.');
    if (job.status === 'cancelled')
      throw new DOMException('Cancelled', 'AbortError');
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        signal?.removeEventListener('abort', abort);
        resolve();
      };
      const timeout = setTimeout(done, 900);
      const abort = () => {
        clearTimeout(timeout);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  throw new DOMException('Cancelled', 'AbortError');
}
export type SimulationResult = {
  snapshot?: import('./model').Project;
  id: string;
  engine: string;
  projectKey: string;
  modelHash: string;
  projectRevision: number;
  duration: number;
  elapsed: number;
  time: number[];
  samples: number;
  series: {
    key: string;
    name: string;
    unit: string;
    blockId: string;
    netId?: string;
    values: number[];
  }[];
  diagnostics: string;
};
export function downloadText(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
