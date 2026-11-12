/**
 * Connection settings form (Global or per-project override): endpoint + API key.
 * The key is never displayed or requested back: only `apiKeyMasked` from the server is
 * shown; an empty key field on save means "keep the stored key".
 * "Save & test" PUTs and shows the probe TestResult; "Test" probes without saving.
 */
import { h, clear, button } from './dom-helpers.js';
import { api, enc } from './api-client.js';
import { reportError, showToast } from './toast-notifications.js';
import { confirmAction } from './modal-dialogs.js';
import { formatMs } from './format-helpers.js';

const KIND_LABELS = {
  ok: 'Connected — key accepted',
  invalid_key: 'Invalid API key',
  wrong_path: 'Wrong endpoint path',
  unreachable: 'Endpoint unreachable',
  unexpected: 'Unexpected response',
};

/** Inline TestResult display: kind, HTTP status, latency and server message. */
export function renderTestResult(result) {
  if (!result || typeof result !== 'object') return null;
  const kind = result.kind ?? (result.ok ? 'ok' : 'unexpected');
  const facts = [
    result.httpStatus ? `HTTP ${result.httpStatus}` : null,
    result.latencyMs !== undefined && result.latencyMs !== null ? formatMs(result.latencyMs) : null,
  ].filter(Boolean).join(' · ');
  return h('div', { class: `test-result kind-${kind}`, role: 'status' },
    h('strong', {}, KIND_LABELS[kind] ?? kind),
    facts ? h('span', { class: 'muted' }, ` · ${facts}`) : null,
    result.message ? h('div', { class: 'small' }, result.message) : null);
}

/**
 * Normalise a GET response. Global: `{global, effective?}`. Project: the override is read
 * from `override`/`project` (falling back to `effective.source`) so either naming works.
 */
export function readConnection(data, scope) {
  const effective = data?.effective ?? null;
  if (scope === 'global') return { own: data?.global ?? null, effective, source: data?.global ? 'global' : 'none' };
  const own = data?.override ?? data?.project ?? null;
  const source = own ? 'override'
    : effective?.source === 'project' || effective?.source === 'override' ? 'override'
      : (effective?.hasKey || data?.global?.hasKey) ? 'global' : 'none';
  return { own, effective: effective ?? data?.global ?? null, source };
}

export function createConnectionSettingsForm({ scope, projectId, onChanged }) {
  const base = scope === 'global' ? '/api/credentials' : `/api/projects/${enc(projectId)}/credentials`;
  const endpoint = h('input', {
    type: 'text', autocomplete: 'off', spellcheck: false,
    placeholder: 'https://dashscope-intl.aliyuncs.com or https://ws-xxx.ap-southeast-1.maas.aliyuncs.com',
  });
  const apiKey = h('input', { type: 'password', autocomplete: 'new-password', spellcheck: false, placeholder: 'Paste API key' });
  const keyNote = h('p', { class: 'field-note' });
  const sourceNote = h('p', { class: 'field-note source-note', hidden: scope === 'global' });
  const resultHost = h('div', { class: 'test-result-host', 'aria-live': 'polite' });
  const saveBtn = button('Save & test', null, { variant: 'primary', type: 'submit' });
  const testBtn = button('Test', () => void test(), { title: 'Probe the endpoint without saving (no image is generated)' });
  const clearBtn = button('Clear override', () => void clearOverride(), { variant: 'ghost danger' });
  clearBtn.hidden = true;
  let own = null;

  const el = h('form', { class: 'creds-form stack', onSubmit: (e) => { e.preventDefault(); void save(); } },
    sourceNote,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Endpoint'), endpoint,
      h('span', { class: 'field-note' }, 'Full URL or bare host; a host without /api/ gets the multimodal-generation path appended.')),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'API key'), apiKey, keyNote),
    h('div', { class: 'row' }, saveBtn, testBtn, clearBtn),
    resultHost);

  function setBusy(busy, text) {
    saveBtn.disabled = busy;
    testBtn.disabled = busy;
    clearBtn.disabled = busy;
    if (busy) clear(resultHost).append(h('div', { class: 'test-result kind-pending' }, h('span', { class: 'spinner' }), ` ${text}`));
  }

  function apply(data) {
    const info = readConnection(data, scope);
    own = info.own;
    endpoint.value = own?.endpoint ?? '';
    apiKey.value = '';
    apiKey.placeholder = own?.hasKey ? `Stored: ${own.apiKeyMasked ?? '••••'} (leave empty to keep)` : 'Paste API key';
    keyNote.textContent = own?.hasKey ? `Stored key: ${own.apiKeyMasked ?? '(masked)'}` : 'No key stored yet.';
    if (scope === 'project') {
      const eff = info.effective;
      sourceNote.textContent = info.source === 'override'
        ? 'This project uses its own override (endpoint + key).'
        : info.source === 'global'
          ? `This project uses Global settings${eff?.endpoint ? ` (${eff.endpoint}, key ${eff.apiKeyMasked ?? 'masked'})` : ''}. Saving here creates an override.`
          : 'No Global endpoint/key is set and this project has no override.';
      clearBtn.hidden = info.source !== 'override';
    }
  }

  async function load() {
    try { apply(await api.get(base)); } catch (err) { reportError(err, 'Could not load endpoint settings'); }
  }

  async function save() {
    const body = { endpoint: endpoint.value.trim() };
    const key = apiKey.value.trim();
    if (key) body.apiKey = key;
    if (!body.endpoint) { showToast('Endpoint is required.', 'error'); endpoint.focus(); return; }
    if (!key && !own?.hasKey) { showToast('API key is required.', 'error'); apiKey.focus(); return; }
    setBusy(true, 'Saving and testing…');
    let test = null;
    try {
      const res = await api.put(base, body);
      test = res?.test ?? null;
      apiKey.value = '';
      showToast('Saved.', 'success');
      await load();
      onChanged?.();
    } catch (err) {
      reportError(err, 'Could not save');
    } finally {
      setBusy(false);
      clear(resultHost).append(renderTestResult(test) ?? '');
    }
  }

  async function test() {
    const body = {};
    if (scope === 'project') body.projectId = projectId;
    if (endpoint.value.trim()) body.endpoint = endpoint.value.trim();
    if (apiKey.value.trim()) body.apiKey = apiKey.value.trim();
    setBusy(true, 'Testing connection…');
    let result = null;
    try { result = await api.post('/api/credentials/test', body); } catch (err) { reportError(err, 'Connection test failed'); }
    setBusy(false);
    clear(resultHost).append(renderTestResult(result) ?? '');
  }

  async function clearOverride() {
    const ok = await confirmAction({ title: 'Clear override', message: 'Remove this project\'s override and use the Global endpoint and key?', confirmLabel: 'Clear override' });
    if (!ok) return;
    try {
      await api.del(base);
      showToast('Override cleared; using Global settings.', 'success');
      clear(resultHost);
      await load();
      onChanged?.();
    } catch (err) { reportError(err, 'Could not clear override'); }
  }

  void load();
  return el;
}
