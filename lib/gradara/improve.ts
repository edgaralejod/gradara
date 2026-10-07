// SPDX-License-Identifier: Apache-2.0
/** Improve Gradara: a structured, public GitHub issue for something Gradara cannot do yet. */

export const ISSUES_URL = 'https://github.com/edgaralejod/gradara/issues/new';

/** Keep a URL a browser and GitHub accept; issue bodies past this are cut with a note. */
const MAX_FIELD = 2500;

function cut(text: string) {
  const clean = text.trim();
  return clean.length > MAX_FIELD ? `${clean.slice(0, MAX_FIELD)}…` : clean;
}

/**
 * The new-issue URL for the "Improve Gradara" form, filled in with the request
 * and Gradara's reason. No model, file, or account detail is included.
 */
export function improveIssueUrl({
  request,
  reason,
  version,
  platform,
}: {
  request: string;
  reason: string;
  version: string;
  platform: string;
}): string {
  const firstLine = request.trim().split('\n')[0] ?? '';
  const title = `Improve Gradara: ${firstLine.length > 70 ? `${firstLine.slice(0, 70)}…` : firstLine}`;
  const query = new URLSearchParams({
    template: 'improve-gradara.yml',
    title,
    request: cut(request),
    reason: cut(reason),
    environment: `Gradara ${version || 'unknown version'} · ${platform || 'unknown platform'}`,
  });
  return `${ISSUES_URL}?${query.toString()}`;
}
