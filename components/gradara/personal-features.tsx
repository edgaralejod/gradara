'use client';
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import {
  CircleAlert,
  Download,
  ExternalLink,
  Hammer,
  KeyRound,
  LoaderCircle,
  Power,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/gradara/api';
import { openExternal } from '@/lib/gradara/ai';
import { improveIssueUrl } from '@/lib/gradara/improve';
import {
  dollars,
  layerBridge,
  progressText,
  saveTracked,
  startWorkshop,
  succeeded,
  trackedRequests,
  type LayerFeature,
  type LayerSnapshot,
  type PublishedLayer,
  type TrackedRequest,
  type WorkshopProgress,
  type WorkshopStatus,
} from '@/lib/gradara/layers';

const DOCS = 'https://github.com/edgaralejod/gradara/blob/main/docs/architecture/LAYERS.md';
const BUDGETS = [2, 5, 10, 20];

/**
 * Settings → Personal features. Ask the workshop for a feature, see its scope and
 * price cap before paying, follow the build, and load the signed result on top of
 * this app. The shipped app is always one restart away.
 */
export default function PersonalFeatures({ initialRequest = '' }: { initialRequest?: string }) {
  const bridge = layerBridge();
  const [snapshot, setSnapshot] = useState<LayerSnapshot | null>(null);
  const [status, setStatus] = useState<WorkshopStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [repository, setRepository] = useState('');
  const [token, setToken] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [request, setRequest] = useState(initialRequest);
  const [title, setTitle] = useState('');
  const [tracked, setTracked] = useState<TrackedRequest[]>(() => trackedRequests());
  const [progress, setProgress] = useState<Record<string, WorkshopProgress>>({});
  const [published, setPublished] = useState<PublishedLayer[] | null>(null);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [installed, setInstalled] = useState('');

  const refreshLayers = useCallback(async () => {
    if (bridge) setSnapshot(await bridge.getState());
  }, [bridge]);
  const refreshStatus = useCallback(async () => {
    try {
      const next = await api<WorkshopStatus>('/workshop');
      setStatus(next);
      setRepository(next.repository);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshLayers();
      void refreshStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [refreshLayers, refreshStatus]);

  const track = (next: TrackedRequest[]) => {
    setTracked(next);
    saveTracked(next);
  };
  // Follow unfinished requests while this tab is open.
  const poll = useEffectEvent(async () => {
    for (const t of tracked) {
      if (progress[t.requestId]?.status === 'completed') continue;
      try {
        const p = await api<WorkshopProgress>(`/workshop/requests/${t.requestId}`);
        setProgress((all) => ({ ...all, [t.requestId]: p }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  });
  const following = !!status?.tokenSaved && tracked.length > 0;
  useEffect(() => {
    if (!following) return;
    const first = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), 15000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [following, tracked.length]);

  const loadPublished = useCallback(async () => {
    try {
      setPublished((await api<{ layers: PublishedLayer[] }>('/workshop/layers')).layers);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const active = snapshot?.state.active ?? null;
  const running = snapshot?.running ?? null;
  const install = (layer: { archiveUrl: string; signatureUrl: string; id: string }) =>
    run('install', async () => {
      if (!bridge || !status) throw new Error('Personal features load only in the installed Gradara app.');
      const result = await bridge.install({
        repository: status.repository,
        archiveUrl: layer.archiveUrl,
        signatureUrl: layer.signatureUrl,
      });
      if (!result.ok) throw new Error(result.error || 'The layer could not be installed.');
      setInstalled(layer.id);
      await refreshLayers();
    });
  const rebuildWithout = (feature: LayerFeature) =>
    run('rebuild', async () => {
      if (!active) return;
      const keep = active.features.filter((f) => f.id !== feature.id);
      if (!keep.length) {
        await bridge?.remove();
        await refreshLayers();
        return;
      }
      const { requestId } = await startWorkshop({ mode: 'rebuild', title: `Without ${feature.title}`, stack: keep });
      track([...tracked, { requestId, mode: 'rebuild', request: '', title: `Without ${feature.title}`, budget: 0, at: Date.now() }]);
    });
  const trusted = !!status && !!snapshot?.trusted.some((k) => k.repository.toLowerCase() === status.repository.toLowerCase());

  return (
    <section className="settings-section personal-features">
      <p className="settings-lead">
        Ask for something Gradara cannot do yet and get it as a personal feature: an AI agent builds it from the public
        source in a workshop repository on GitHub, automated checks test it, and the signed result loads on top of this
        app. Requests and their code are public. The workshop repository’s own Anthropic key pays for each build,
        including attempts that do not pass the checks.{' '}
        <a
          href={DOCS}
          onClick={(e) => {
            e.preventDefault();
            openExternal(DOCS);
          }}
        >
          How it works
        </a>
      </p>
      {error && (
        <div className="composer-error" role="alert">
          {error}
        </div>
      )}

      <div className="settings-card">
        <div className="settings-card-row">
          <Power size={15} />
          <strong>
            {running
              ? `Running with ${running.features.length} personal ${running.features.length === 1 ? 'feature' : 'features'}`
              : active
                ? 'Personal features are switched off'
                : 'No personal features'}
          </strong>
          {snapshot && <span className="settings-pill">Gradara {snapshot.version}</span>}
        </div>
        {!bridge && <p>Personal features load only in the installed app. In a source checkout, your branch is the feature.</p>}
        {snapshot?.notice && (
          <p className="settings-warning">
            <CircleAlert size={13} /> {snapshot.notice}
          </p>
        )}
        {active && (
          <ul className="feature-list">
            {active.features.map((f) => (
              <li key={f.id}>
                <span>{f.title || f.id}</span>
                <button
                  type="button"
                  disabled={!!busy || !status?.tokenSaved}
                  title={status?.tokenSaved ? 'Rebuild the layer without this feature (no model use)' : 'Needs the workshop token'}
                  onClick={() => void rebuildWithout(f)}
                >
                  <Trash2 size={12} /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {bridge && active && (
          <div className="settings-inline">
            {running || (!snapshot?.state.off && installed) ? (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  void run('off', async () => {
                    await bridge.switchOn(false);
                    await bridge.restart();
                  })
                }
              >
                <Power size={14} /> Switch all off and restart
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={!!busy || active.base !== snapshot?.version}
                onClick={() =>
                  void run('on', async () => {
                    await bridge.switchOn(true);
                    await bridge.restart();
                  })
                }
              >
                <Power size={14} /> Switch on and restart
              </Button>
            )}
            {installed && !running && (
              <Button disabled={!!busy} onClick={() => void bridge.restart()}>
                <RefreshCw size={14} /> Restart to use
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-row">
          <Wrench size={15} />
          <strong>Workshop</strong>
          {status?.login && <span className="settings-pill">Signed in to GitHub as {status.login}</span>}
        </div>
        <label className="settings-field">
          Repository
          <span className="settings-inline">
            <input
              value={repository}
              placeholder={status?.defaultRepository}
              onChange={(e) => setRepository(e.target.value)}
              aria-label="Workshop repository (owner/name)"
            />
            <Button
              variant="outline"
              disabled={!!busy || repository === status?.repository}
              onClick={() =>
                void run('repository', async () => {
                  setStatus(await api<WorkshopStatus>('/workshop', { method: 'PUT', body: JSON.stringify({ repository }) }));
                })
              }
            >
              Use
            </Button>
          </span>
        </label>
        <p className="settings-note">
          The repository whose workshop pipeline builds your features: the main repository for its maintainer, or your
          own fork with its own secrets. Layers install only from the repository chosen here.
        </p>
        <label className="settings-field">
          GitHub token
          <span className="settings-inline">
            <input
              type="password"
              value={token}
              autoComplete="off"
              placeholder={status?.tokenSaved ? 'Saved in the system keychain' : 'A fine-grained token for that repository'}
              onChange={(e) => setToken(e.target.value)}
              aria-label="GitHub token"
            />
            <Button
              variant="outline"
              disabled={!!busy || token.length < 20}
              onClick={() =>
                void run('token', async () => {
                  setStatus(await api<WorkshopStatus>('/workshop/token', { method: 'PUT', body: JSON.stringify({ token }) }));
                  setToken('');
                })
              }
            >
              <KeyRound size={14} /> Save
            </Button>
            {status?.tokenSaved && (
              <Button
                variant="ghost"
                disabled={!!busy}
                onClick={() =>
                  void run('forget', async () => {
                    setStatus(await api<WorkshopStatus>('/workshop/token', { method: 'DELETE' }));
                  })
                }
              >
                Remove
              </Button>
            )}
          </span>
        </label>
        <p className="settings-note">
          Needs Actions (read and write) and Contents (read) on that repository. It stays in the system keychain and is
          sent only to GitHub.
        </p>
        {status?.problem && (
          <p className="settings-warning">
            <CircleAlert size={13} /> {status.problem}
          </p>
        )}
        {bridge && status && !trusted && (
          <>
            <label className="settings-field">
              Workshop public key for {status.repository}
              <textarea
                rows={3}
                value={publicKey}
                placeholder="-----BEGIN PUBLIC KEY-----"
                onChange={(e) => setPublicKey(e.target.value)}
              />
            </label>
            <div className="settings-inline">
              <Button
                variant="outline"
                disabled={!!busy || publicKey.length < 40}
                onClick={() =>
                  void run('trust', async () => {
                    const result = await bridge.trust({ repository: status.repository, publicKey });
                    if (!result.ok && result.error) throw new Error(result.error);
                    if (result.ok) setPublicKey('');
                    await refreshLayers();
                  })
                }
              >
                Trust this key
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-row">
          <Hammer size={15} />
          <strong>Ask for a feature</strong>
        </div>
        <textarea
          className="feature-request"
          rows={4}
          maxLength={8000}
          value={request}
          placeholder="What should Gradara do that it cannot do today? Describe the outcome, not the code."
          onChange={(e) => setRequest(e.target.value)}
          aria-label="Feature request"
        />
        <input
          className="feature-title"
          value={title}
          maxLength={120}
          placeholder="Short title (optional)"
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Feature title"
        />
        <div className="settings-inline">
          <Button
            disabled={!!busy || !status?.tokenSaved || request.trim().length < 10}
            onClick={() =>
              void run('scope', async () => {
                const { requestId } = await startWorkshop({ mode: 'scope', request, title });
                track([...tracked, { requestId, mode: 'scope', request, title, budget: 5, at: Date.now() }]);
              })
            }
          >
            {busy === 'scope' ? <LoaderCircle size={14} className="spin" /> : <Hammer size={14} />} Check what would be built
          </Button>
          <span className="settings-note">
            {status?.tokenSaved
              ? 'A small model reads the code first: a few cents on the workshop’s key.'
              : 'Save a GitHub token for the workshop repository first.'}
          </span>
        </div>
      </div>

      {tracked.length > 0 && (
        <div className="settings-card">
          <div className="settings-card-row">
            <RefreshCw size={15} />
            <strong>Requests</strong>
          </div>
          <ul className="workshop-requests">
            {[...tracked].reverse().map((t) => {
              const p = progress[t.requestId];
              const scope = p?.scope;
              const tag = p?.report?.stage === 'published' ? p.report.message : '';
              const budget = budgets[t.requestId] ?? 5;
              return (
                <li key={t.requestId}>
                  <div className="workshop-request-head">
                    <strong>{t.title || t.request.split('\n')[0] || t.requestId}</strong>
                    <span>{t.mode === 'scope' ? 'Scope' : t.mode === 'build' ? `Build · cap ${dollars(t.budget)}` : 'Rebuild'}</span>
                    <span className={`workshop-state${p && p.status === 'completed' && !succeeded(p) ? ' is-error' : ''}`}>
                      {p ? progressText(p) : 'Starting…'}
                    </span>
                    {p?.url && (
                      <button type="button" className="ask-link" onClick={() => openExternal(p.url!)}>
                        <ExternalLink size={11} /> Run on GitHub
                      </button>
                    )}
                  </div>
                  {p?.cost && (
                    <p className="settings-note">
                      Receipt: {dollars(p.cost.totalUsd)} of model use on the workshop’s key
                      {Object.entries(p.cost.runs)
                        .map(([label, r]) => ` · ${label} ${dollars(r.usd)} (${r.turns} turns)`)
                        .join('')}
                      .
                    </p>
                  )}
                  {scope && (
                    <div className="scope-card">
                      <p>{scope.summary}</p>
                      {scope.will.length > 0 && <p>Will: {scope.will.join('; ')}.</p>}
                      {scope.wont.length > 0 && <p>Will not: {scope.wont.join('; ')}.</p>}
                      <p className="settings-note">
                        {scope.personal
                          ? 'Can ship as a personal layer.'
                          : 'Needs a Gradara release: only the maintainer can ship it.'}{' '}
                        Size {scope.estimate}, risk {scope.risk}. Scoping cost {dollars(scope.cost.usd)}.
                        {scope.reason ? ` ${scope.reason}` : ''}
                      </p>
                      {scope.buildable && scope.personal ? (
                        <div className="settings-inline">
                          <label>
                            Spend at most{' '}
                            <select
                              value={budget}
                              onChange={(e) => setBudgets((b) => ({ ...b, [t.requestId]: Number(e.target.value) }))}
                            >
                              {BUDGETS.map((b) => (
                                <option key={b} value={b}>
                                  {dollars(b)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <Button
                            disabled={!!busy}
                            onClick={() =>
                              void run('build', async () => {
                                const { requestId } = await startWorkshop({
                                  mode: 'build',
                                  request: t.request,
                                  title: t.title,
                                  budget,
                                  stack: active?.base === snapshot?.version ? active?.features : [],
                                });
                                track([...tracked, { requestId, mode: 'build', request: t.request, title: t.title, budget, at: Date.now() }]);
                              })
                            }
                          >
                            <Hammer size={14} /> Build it
                          </Button>
                          <span className="settings-note">
                            Charged whether or not it passes the checks, up to this cap. The request, its code and a
                            draft pull request are public.
                          </span>
                        </div>
                      ) : (
                        <div className="settings-inline">
                          <Button
                            variant="outline"
                            onClick={() =>
                              openExternal(
                                improveIssueUrl({
                                  request: t.request,
                                  reason: scope.reason || scope.summary,
                                  version: snapshot?.version ?? '',
                                  platform: navigator.platform,
                                }),
                              )
                            }
                          >
                            Ask for it in a release
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {tag && t.mode !== 'scope' && (
                    <div className="settings-inline">
                      <Button
                        disabled={!!busy || !bridge}
                        onClick={() =>
                          void run('find', async () => {
                            const list = (await api<{ layers: PublishedLayer[] }>('/workshop/layers')).layers;
                            setPublished(list);
                            const layer = list.find((l) => l.tag === tag);
                            if (!layer) throw new Error(`${tag} is not published for this version yet.`);
                            await install(layer);
                          })
                        }
                      >
                        <Download size={14} /> Install
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <button type="button" className="ask-link" onClick={() => track([])}>
            Clear the list
          </button>
        </div>
      )}

      <div className="settings-card">
        <div className="settings-card-row">
          <Download size={15} />
          <strong>Published for this version</strong>
          <Button variant="ghost" disabled={!status?.tokenSaved || !!busy} onClick={() => void loadPublished()}>
            <RefreshCw size={13} /> Look
          </Button>
        </div>
        {published === null ? (
          <p className="settings-note">Layers the workshop repository published for this exact version of Gradara.</p>
        ) : published.length ? (
          <ul className="feature-list">
            {published.map((layer) => (
              <li key={layer.tag}>
                <span>
                  {layer.features.map((f) => f.title || f.id).join(' + ') || layer.title}
                  {active?.id === layer.id && ' · installed'}
                </span>
                <button type="button" disabled={!!busy || !bridge} onClick={() => void install(layer)}>
                  <Download size={12} /> Install
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-note">None yet.</p>
        )}
      </div>
    </section>
  );
}
