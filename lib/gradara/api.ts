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
  // The local service refuses state-changing requests without this header,
  // which other websites cannot send cross-origin.
  headers.set('X-Gradara-Client', 'workbench');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error(
      'Cannot reach the local Gradara service. Restart Gradara, then try again.',
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
export type Diagnostic = {
  id: string;
  severity: 'error' | 'warning' | 'info';
  source: 'validation' | 'safety' | 'compiler' | 'runtime' | 'engine';
  message: string;
  detail: string;
  blockIds: string[];
  ports: { blockId: string; portId: string }[];
  netIds: string[];
  wireIds: string[];
  hint?: string | null;
};
export type Job<T> = {
  id: string;
  kind?: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  result?: T;
  error?: string;
  diagnostics?: Diagnostic[];
  progress?: string;
};
/** The last failed run of the open model, kept until the next run or model switch. */
export type RunFailure = {
  runId: string;
  modelId?: string;
  signature: string;
  message: string;
  diagnostics: Diagnostic[];
};
/** A failed job; `message` is the readable error, `diagnostics` the structured problems. */
export class JobFailure extends Error {
  constructor(
    message: string,
    public jobId: string,
    public diagnostics: Diagnostic[],
  ) {
    super(message);
    this.name = 'JobFailure';
  }
}
export async function waitForJob<T>(
  id: string,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<T> {
  while (!signal?.aborted) {
    const job = await api<Job<T>>(`/jobs/${id}`, { signal });
    if (job.progress) onProgress?.(job.progress);
    if (job.status === 'complete') return job.result!;
    if (job.status === 'failed')
      throw new JobFailure(
        job.error ?? 'The operation failed.',
        job.id,
        job.diagnostics ?? [],
      );
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
  /** Warnings from a successful run; absent on results saved before diagnostics existed. */
  problems?: Diagnostic[];
  /** Set on an overlay of several configurations' runs (Run all configurations); not a stored run. */
  comparison?: { name: string; runId: string }[];
};
/** A model name as a file name part: letters, digits, dots and dashes, as the service does. */
export function fileSlug(name: string, fallback = 'model'): string {
  const slug = name.replace(/[^A-Za-z0-9.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return slug.slice(0, 60) || fallback;
}
export function downloadText(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
