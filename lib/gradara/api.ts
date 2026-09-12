export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = (data as { detail?: string | { msg: string }[] }).detail;
    throw new Error(
      Array.isArray(detail)
        ? detail.map((x: { msg: string }) => x.msg).join('\n')
        : (detail ?? 'The local service could not complete this request.'),
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
    if (job.status === 'cancelled') throw new Error('Cancelled.');
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
