// SPDX-License-Identifier: Apache-2.0
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Check,
  Cpu,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, waitForJob, type Job } from '@/lib/gradara/api';
import {
  formatPrice,
  notifyAiChanged,
  openExternal,
  type Account,
  type AiProvider,
  type AiStatus,
  type EngineStatus,
} from '@/lib/gradara/ai';

export type SettingsTab = 'engine' | 'ai' | 'privacy';

const OM_DOWNLOAD: Record<string, string> = {
  win32: 'https://openmodelica.org/download/download-windows/',
  linux: 'https://openmodelica.org/download/download-linux/',
};
const DOCKER_HELP = 'https://docs.docker.com/get-started/get-docker/';

export default function SettingsDialog({
  initialTab = 'engine',
  dataDirectory,
  onClose,
  onEngineChange,
}: {
  initialTab?: SettingsTab;
  dataDirectory?: string;
  onClose: () => void;
  onEngineChange?: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="settings-dialog">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Simulation engine, AI features, and how your data is handled.
        </DialogDescription>
        <div className="settings-tabs" role="tablist">
          {(
            [
              ['engine', 'Engine', Cpu],
              ['ai', 'AI', Sparkles],
              ['privacy', 'Privacy & data', ShieldCheck],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'is-active' : ''}
              onClick={() => setTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        {tab === 'engine' && <EngineSettings onChange={onEngineChange} />}
        {tab === 'ai' && <AiSettings />}
        {tab === 'privacy' && <PrivacySettings dataDirectory={dataDirectory} />}
      </DialogContent>
    </Dialog>
  );
}

function ErrorLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="composer-error" role="alert">
      {text}
    </div>
  );
}

function EngineSettings({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(
    async (force = false) => {
      setBusy((b) => b || 'check');
      setError('');
      try {
        setStatus(
          await api<EngineStatus>(force ? '/engine?refresh=true' : '/engine'),
        );
        onChange?.();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy((b) => (b === 'check' ? '' : b));
      }
    },
    [onChange],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function choose(engine: string) {
    setBusy('check');
    try {
      setStatus(
        await api<EngineStatus>('/engine', {
          method: 'PUT',
          body: JSON.stringify({ engine }),
        }),
      );
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function prepare() {
    setBusy('prepare');
    setError('');
    setProgress('Starting…');
    try {
      const job = await api<Job<EngineStatus>>('/engine/prepare', {
        method: 'POST',
      });
      setStatus(await waitForJob<EngineStatus>(job.id, undefined, setProgress));
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      setProgress('');
    }
  }
  const actions = status?.actions ?? [];
  const isMac = status?.platform === 'darwin';
  return (
    <section className="settings-section">
      <div className={`settings-status ${status?.ready ? 'ok' : 'warn'}`}>
        <span className="status-dot-large" />
        <div>
          <strong>
            {status ? status.label : 'Checking the simulation engine…'}
          </strong>
          {status?.detail && <p>{status.detail}</p>}
          {status?.ready && (
            <p>
              Simulations run on this computer using the{' '}
              {status.backend === 'native'
                ? 'OpenModelica installation'
                : 'Gradara container engine'}
              .
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy}
          onClick={() => void refresh(true)}
          aria-label="Check again"
        >
          {busy === 'check' ? <LoaderCircle className="spin" /> : <RefreshCw />}
          Check again
        </Button>
      </div>
      {!status?.ready && status && (
        <div className="settings-steps">
          {actions.includes('install-openmodelica') && (
            <div className="settings-step">
              <strong>1. Install OpenModelica</strong>
              <p>
                Gradara uses OpenModelica, a free open-source simulation
                compiler. Run its official installer with the default options,
                then come back and choose Check again.
              </p>
              <Button
                onClick={() =>
                  openExternal(
                    OM_DOWNLOAD[status.platform] ??
                      'https://openmodelica.org/download/',
                  )
                }
              >
                <ExternalLink />
                Download OpenModelica
              </Button>
              {isMac && (
                <p className="settings-hint">
                  On macOS, choose the Container engine below instead.
                </p>
              )}
            </div>
          )}
          {actions.includes('install-docker') && (
            <div className="settings-step">
              <strong>Install a container runtime</strong>
              <p>
                {isMac
                  ? 'On macOS, Gradara runs OpenModelica in a lightweight Linux container. Install OrbStack, Docker Desktop, or Colima, start it, then choose Check again.'
                  : 'Install Docker, start it, then choose Check again.'}
              </p>
              <Button onClick={() => openExternal(DOCKER_HELP)}>
                <ExternalLink />
                Get Docker
              </Button>
            </div>
          )}
          {(actions.includes('prepare') ||
            actions.includes('start-runtime')) && (
            <div className="settings-step">
              <strong>
                {status.backend === 'native'
                  ? 'Install the Modelica Standard Library'
                  : actions.includes('start-runtime')
                    ? 'Start the container runtime'
                    : 'Download the simulation engine'}
              </strong>
              <p>
                {status.backend === 'native'
                  ? 'A one-time download of the component library Gradara models use (a few minutes).'
                  : 'A one-time download of the OpenModelica engine image (1 to 2 GB).'}
              </p>
              <Button disabled={!!busy} onClick={() => void prepare()}>
                {busy === 'prepare' ? (
                  <LoaderCircle className="spin" />
                ) : (
                  <Cpu />
                )}
                {busy === 'prepare' ? progress || 'Working…' : 'Set up now'}
              </Button>
            </div>
          )}
        </div>
      )}
      <label className="settings-field">
        <span>Engine</span>
        <select
          value={status?.preference ?? 'auto'}
          disabled={!!busy}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="auto">Automatic (recommended)</option>
          <option value="native">
            OpenModelica installed on this computer
          </option>
          <option value="docker">Container engine (Docker)</option>
        </select>
      </label>
      <ErrorLine text={error} />
    </section>
  );
}

const PROVIDERS: {
  id: AiProvider;
  title: string;
  text: string;
}[] = [
  {
    id: 'gradara',
    title: 'Gradara AI',
    text: 'Sign in and use prepaid credits. No API keys or setup.',
  },
  {
    id: 'openai',
    title: 'OpenAI API key',
    text: 'Use your own OpenAI account. Billed by OpenAI.',
  },
  {
    id: 'anthropic',
    title: 'Anthropic API key',
    text: 'Use your own Anthropic account. Billed by Anthropic.',
  },
  {
    id: 'codex',
    title: 'Codex CLI',
    text: 'Developer option: your installed, signed-in Codex CLI.',
  },
  {
    id: 'off',
    title: 'Off',
    text: 'Hide AI generation. Everything else works.',
  },
];

function AiSettings() {
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setAi(await api<AiStatus>('/ai'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function choose(provider: AiProvider) {
    setError('');
    try {
      setAi(
        await api<AiStatus>('/ai', {
          method: 'PUT',
          body: JSON.stringify({ provider }),
        }),
      );
      notifyAiChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!ai)
    return (
      <section className="settings-section">
        <LoaderCircle className="spin" />
        <ErrorLine text={error} />
      </section>
    );
  const visible = PROVIDERS.filter(
    (p) => p.id !== 'codex' || ai.codexAvailable || ai.provider === 'codex',
  );
  return (
    <section className="settings-section">
      <p className="settings-lead">
        AI creates blocks, builds models from a description, and generates C for
        controllers. Editing and simulating never need AI.
      </p>
      <div className="provider-list" aria-label="AI provider">
        {visible.map((p) => (
          <button
            key={p.id}
            aria-pressed={ai.provider === p.id}
            className={`provider-option ${ai.provider === p.id ? 'is-selected' : ''}`}
            onClick={() => void choose(p.id)}
          >
            <span className="provider-radio">
              {ai.provider === p.id && <Check size={12} />}
            </span>
            <span>
              <strong>
                {p.title}
                {p.id === 'gradara' && (
                  <em className="provider-badge">Recommended</em>
                )}
              </strong>
              <small>{p.text}</small>
            </span>
          </button>
        ))}
      </div>
      {ai.provider === 'gradara' && <GradaraAccount onChange={refresh} />}
      {(ai.provider === 'openai' || ai.provider === 'anthropic') && (
        <ApiKeySettings ai={ai} provider={ai.provider} onChange={setAi} />
      )}
      {ai.provider === 'codex' && (
        <p className="settings-hint">
          {ai.codexAvailable
            ? 'Codex CLI found. Requests use your own Codex sign-in.'
            : 'Codex CLI was not found on this computer.'}
        </p>
      )}
      <ErrorLine text={error} />
    </section>
  );
}

function ApiKeySettings({
  ai,
  provider,
  onChange,
}: {
  ai: AiStatus;
  provider: 'openai' | 'anthropic';
  onChange: (ai: AiStatus) => void;
}) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(ai.models[provider]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const name = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  async function save() {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const next = await api<AiStatus>(`/ai/keys/${provider}`, {
        method: 'PUT',
        body: JSON.stringify({ key }),
      });
      setKey('');
      setSaved('Key verified and saved.');
      onChange(next);
      notifyAiChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    onChange(await api<AiStatus>(`/ai/keys/${provider}`, { method: 'DELETE' }));
    notifyAiChanged();
  }
  async function saveModel() {
    onChange(
      await api<AiStatus>('/ai', {
        method: 'PUT',
        body: JSON.stringify({ [`${provider}Model`]: model.trim() }),
      }),
    );
  }
  return (
    <div className="settings-card">
      <div className="settings-card-row">
        <KeyRound size={15} />
        <strong>{name} API key</strong>
        {ai.keys[provider] && <span className="settings-pill">Saved</span>}
      </div>
      <p>
        Stored in your {ai.credentialStorage}. Requests go directly from this
        computer to {name}; Gradara never sees your key.
      </p>
      <div className="settings-inline">
        <input
          type="password"
          autoComplete="off"
          placeholder={
            ai.keys[provider] ? 'Replace the saved key' : 'Paste your API key'
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button
          disabled={busy || key.trim().length < 8}
          onClick={() => void save()}
        >
          {busy ? <LoaderCircle className="spin" /> : <Check />}
          Verify & save
        </Button>
        {ai.keys[provider] && (
          <Button variant="ghost" onClick={() => void remove()}>
            Remove
          </Button>
        )}
      </div>
      <label className="settings-field">
        <span>Model</span>
        <input
          value={model}
          placeholder={ai.defaultModels[provider]}
          onChange={(e) => setModel(e.target.value)}
          onBlur={() => void saveModel()}
        />
      </label>
      {saved && <p className="settings-ok">{saved}</p>}
      <ErrorLine text={error} />
    </div>
  );
}

function GradaraAccount({ onChange }: { onChange: () => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [signin, setSignin] = useState<{
    id: string;
    userCode: string;
    verificationUrl: string;
    interval: number;
  } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const polling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(async () => {
    try {
      setAccount(await api<Account>('/account'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
      setAccount({ signedIn: false });
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      if (polling.current) clearTimeout(polling.current);
    };
  }, [load]);
  async function begin() {
    setBusy('signin');
    setError('');
    try {
      const started = await api<{
        id: string;
        userCode: string;
        verificationUrl: string;
        interval: number;
      }>('/account/signin', { method: 'POST' });
      setSignin(started);
      openExternal(started.verificationUrl);
      const poll = async () => {
        try {
          const result = await api<{ status: string; email?: string }>(
            `/account/signin/${started.id}`,
          );
          if (result.status === 'approved') {
            setSignin(null);
            setBusy('');
            await load();
            onChange();
            notifyAiChanged();
            return;
          }
          if (result.status !== 'pending') {
            setSignin(null);
            setBusy('');
            setError('Sign-in expired. Start again.');
            return;
          }
          polling.current = setTimeout(poll, started.interval * 1000);
        } catch (e) {
          setSignin(null);
          setBusy('');
          setError((e as Error).message);
        }
      };
      polling.current = setTimeout(poll, started.interval * 1000);
    } catch (e) {
      setBusy('');
      setError((e as Error).message);
    }
  }
  function cancel() {
    if (polling.current) clearTimeout(polling.current);
    setSignin(null);
    setBusy('');
  }
  async function buy(pack: string) {
    setBusy(pack);
    setError('');
    try {
      const { url } = await api<{ url: string }>('/account/checkout', {
        method: 'POST',
        body: JSON.stringify({ pack }),
      });
      openExternal(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function signOut() {
    await api('/account/signout', { method: 'POST' });
    await load();
    onChange();
    notifyAiChanged();
  }
  async function remove() {
    setBusy('delete');
    try {
      await api('/account', { method: 'DELETE' });
      setConfirmDelete(false);
      await load();
      onChange();
      notifyAiChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  if (!account)
    return (
      <div className="settings-card">
        <LoaderCircle className="spin" />
      </div>
    );
  if (!account.signedIn)
    return (
      <div className="settings-card">
        {signin ? (
          <>
            <strong>Finish signing in in your browser</strong>
            <p>
              Confirm this code on the page that opened. It matches only this
              computer.
            </p>
            <div className="signin-code">{signin.userCode}</div>
            <div className="settings-inline">
              <Button onClick={() => openExternal(signin.verificationUrl)}>
                <ExternalLink />
                Open sign-in page
              </Button>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </div>
            <p className="settings-hint">
              <LoaderCircle className="spin" size={12} /> Waiting for approval…
            </p>
          </>
        ) : (
          <>
            <strong>Sign in to Gradara AI</strong>
            <p>
              New accounts include free starter credits. Sign in with Google or
              an email link; Gradara never sees a password.
            </p>
            <Button disabled={busy === 'signin'} onClick={() => void begin()}>
              {busy === 'signin' ? (
                <LoaderCircle className="spin" />
              ) : (
                <Sparkles />
              )}
              Sign in
            </Button>
          </>
        )}
        <ErrorLine text={error} />
      </div>
    );
  return (
    <div className="settings-card">
      <div className="settings-card-row">
        <strong>{account.email}</strong>
        <span className="credit-balance">{account.balance} credits</span>
      </div>
      <p>
        Block generation costs {account.prices.component} credits, a full model
        build {account.prices.model}, and a C export {account.prices.export}.
        {account.prices.edit !== undefined && (
          <>
            {' '}
            An assistant edit costs {account.prices.edit}
            {account.surcharges?.edit?.block
              ? `, plus ${account.surcharges.edit.block} per new or rewritten block`
              : ''}
            .
          </>
        )}
        {account.prices.diagnose !== undefined && (
          <>
            {' '}
            Explaining problems costs {account.prices.diagnose}; Fix with AI
            costs that plus the edit.
          </>
        )}{' '}
        Automatic repair attempts are included. If the AI service fails before
        returning a result, you are not charged.
      </p>
      <div className="credit-packs">
        {account.packs.map((pack) => (
          <Button
            key={pack.id}
            variant="outline"
            disabled={!!busy}
            onClick={() => void buy(pack.id)}
          >
            {busy === pack.id ? <LoaderCircle className="spin" /> : null}
            Buy {pack.credits} credits · {formatPrice(pack)}
          </Button>
        ))}
      </div>
      <p className="settings-hint">
        Checkout opens in your browser (Stripe). Your balance updates here when
        you return.
      </p>
      <div className="settings-inline">
        <Button variant="ghost" onClick={() => void load()}>
          <RefreshCw />
          Refresh
        </Button>
        <Button variant="ghost" onClick={() => void signOut()}>
          <LogOut />
          Sign out
        </Button>
        <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
          <Trash2 />
          Delete account
        </Button>
      </div>
      {confirmDelete && (
        <div className="settings-danger" role="alert">
          <p>
            Delete your Gradara AI account? Your email, usage history, and
            sign-ins are erased, and remaining credits are forfeited. Your
            models on this computer are not affected.
          </p>
          <div className="settings-inline">
            <Button
              variant="destructive"
              disabled={busy === 'delete'}
              onClick={() => void remove()}
            >
              Delete account
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep account
            </Button>
          </div>
        </div>
      )}
      <ErrorLine text={error} />
    </div>
  );
}

function PrivacySettings({ dataDirectory }: { dataDirectory?: string }) {
  return (
    <section className="settings-section privacy-list">
      <div>
        <strong>Stays on this computer</strong>
        <p>
          Models, simulation runs, results, and your AI block library are saved
          only in your data folder
          {dataDirectory ? (
            <>
              : <code>{dataDirectory}</code>
            </>
          ) : (
            '.'
          )}{' '}
          Simulations run locally. Gradara has no analytics or tracking.
        </p>
      </div>
      <div>
        <strong>Sent when you use AI</strong>
        <p>
          Only when you ask for AI help, the request and the relevant model data
          are sent to the AI provider you chose. Assistant edits and diagnoses
          send the open model without its layout; a diagnosis of a failed run
          also sends that run&apos;s Modelica source and solver messages. With
          your own API key they go directly to OpenAI or Anthropic under your
          account terms.
        </p>
      </div>
      <div>
        <strong>What Gradara AI keeps</strong>
        <p>
          Your email, credit balance and purchases, and per-request counts (task
          type, model, token counts, time). Gradara AI never stores or logs your
          prompts, models, equations, or AI responses. Usage records are deleted
          after about 13 months, and you can delete your account at any time
          from the AI tab.
        </p>
      </div>
      <div>
        <strong>Payments</strong>
        <p>Stripe processes payments. Gradara never receives card details.</p>
      </div>
      <Button
        variant="outline"
        onClick={() =>
          openExternal('https://gradara.app/privacy')
        }
      >
        <ExternalLink />
        Read the full privacy notice
      </Button>
    </section>
  );
}
