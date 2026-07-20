import 'tom-select/dist/css/tom-select.default.css';
import './style.css';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { getSummarizerConfig, requestProviderPermission } from '../../lib/summarizer/config';
import {
  capturePageSnapshot,
  extractPageForSummary,
  extractSnapshotWithReadability,
} from '../../lib/summarizer/extract';
import { fetchProviderModels, type ProviderModel } from '../../lib/summarizer/models';
import { createModelPicker } from '../../lib/summarizer/modelPicker';
import {
  SUMMARY_LANGUAGE_OPTIONS,
  SUMMARY_STYLE_OPTIONS,
  SUMMARY_TEMPERATURE,
  buildPageContent,
  buildSummarySystemPrompt,
  type SummaryLanguage,
  type SummaryStyle,
} from '../../lib/summarizer/prompts';
import { createProvider } from '../../lib/summarizer/providers';
import {
  PROVIDER_IDS,
  PROVIDER_NAMES,
  type ExtractedPage,
  type ProviderId,
} from '../../lib/summarizer/types';

const app = document.querySelector<HTMLElement>('#app')!;
const abortController = { current: undefined as AbortController | undefined };
let extracted: ExtractedPage | undefined;
let summary = '';
let status = 'Extracting page text…';
let busy = false;
let renderedConfig: Awaited<ReturnType<typeof getSummarizerConfig>> | undefined;
let selectedProvider: ProviderId | undefined;
let overrideModel = '';
let modelProvider: ProviderId | undefined;
let availableModels: ProviderModel[] = [];
let modelsBusy = false;
let modelError = '';
let summaryModelPicker: ReturnType<typeof createModelPicker> | undefined;
let languageOverrideEnabled = false;
let summaryLanguage: SummaryLanguage = 'English';
let summaryLanguageInitialized = false;
let summaryMeta:
  | {
      durationMs: number;
      provider: ProviderId;
      model: string;
    }
  | undefined;

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  options: { className?: string; text?: string; type?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (options.className) node.className = options.className;
  if (options.text != null) node.textContent = options.text;
  if (options.type && node instanceof HTMLButtonElement) node.type = options.type as 'button';
  return node;
}

function markdownOutput(markdown: string): HTMLDivElement {
  const output = element('div', { className: 'summary-markdown' });
  const parsed = marked.parse(markdown, { gfm: true, breaks: false }) as string;
  output.innerHTML = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'del',
      'h1',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'hr',
    ],
    ALLOWED_ATTR: ['href', 'title'],
  });
  for (const link of output.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  return output;
}

async function copyRichSummary(): Promise<void> {
  const rendered = app.querySelector<HTMLElement>('.summary-markdown');
  if (!rendered) throw new Error('The rendered summary is unavailable.');
  const plainText = rendered.innerText.trim();
  if (typeof ClipboardItem === 'function' && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([rendered.innerHTML], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plainText);
}

function showCopiedState(button: HTMLButtonElement): void {
  const originalLabel = button.dataset.copyLabel || button.textContent || '';
  button.textContent = 'COPIED';
  button.classList.add('copied');
  button.setAttribute('aria-label', `${originalLabel} copied`);
  window.setTimeout(() => {
    if (!button.isConnected) return;
    button.textContent = originalLabel;
    button.classList.remove('copied');
    button.setAttribute('aria-label', originalLabel);
  }, 3000);
}

function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = element('label', { className: 'field' });
  control.setAttribute('aria-label', labelText);
  label.append(element('span', { text: labelText }), control);
  return label;
}

function detectedSummaryLanguage(language?: string): SummaryLanguage {
  const code = language?.trim().toLocaleLowerCase().split(/[-_]/)[0];
  return (
    (
      {
        en: 'English',
        nl: 'Dutch',
        pt: 'Portuguese',
        es: 'Spanish',
        de: 'German',
        ru: 'Russian',
      } as Partial<Record<string, SummaryLanguage>>
    )[code || ''] || 'English'
  );
}

function formatSeconds(durationMs: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: durationMs < 10_000 ? 2 : 1,
  }).format(durationMs / 1000);
}

async function render(): Promise<void> {
  const config = await getSummarizerConfig();
  renderedConfig = config;
  selectedProvider ??= config.provider;
  summaryModelPicker?.destroy();
  summaryModelPicker = undefined;
  app.replaceChildren();
  const header = element('header', { className: 'page-header' });
  const announcement = element('div', {
    className: 'announcement',
    text: 'Private by design · Nothing is sent until you choose a summary',
  });
  const brand = element('div', { className: 'brand' });
  const brandMark = document.createElement('picture');
  const darkIcon = document.createElement('source');
  darkIcon.media = '(prefers-color-scheme: dark)';
  darkIcon.srcset = '/icon/dark-theme-48.png';
  const icon = document.createElement('img');
  icon.src = '/icon/48.png';
  icon.width = 48;
  icon.height = 48;
  icon.alt = '';
  brandMark.append(darkIcon, icon);
  brand.append(
    brandMark,
    element('span', { className: 'brand-name', text: 'Linchpin' }),
    element('span', { className: 'brand-context', text: 'AI page summary' }),
  );
  const heading = element('div', { className: 'heading-copy' });
  heading.append(
    element('p', { className: 'eyebrow', text: 'AI page summary' }),
    element('h1', { text: 'Summarize this page' }),
    element('p', {
      className: 'lead',
      text: 'Review the extracted source, choose a model, and send it only when you are ready.',
    }),
  );
  header.append(announcement, brand, heading);
  app.append(header);

  const notice = element('div', { className: busy ? 'notice working' : 'notice', text: status });
  notice.setAttribute('role', 'status');
  app.append(notice);

  const workspace = element('div', { className: 'workspace' });
  if (extracted) {
    const preview = element('section', { className: 'card source-card' });
    preview.append(
      element('p', { className: 'eyebrow', text: 'Source page' }),
      element('h2', { text: extracted.title || 'Untitled page' }),
    );
    const metadata = element('dl', { className: 'metadata' });
    const rows: Array<[string, string]> = [
      ['Site', extracted.site || 'Unknown'],
      [
        'Length',
        `${extracted.content.length.toLocaleString()} characters${extracted.truncated ? ` (truncated from ${extracted.originalLength.toLocaleString()})` : ''}`,
      ],
    ];
    if (extracted.byline) rows.push(['Byline', extracted.byline]);
    if (extracted.language) rows.push(['Language', extracted.language]);
    for (const [term, value] of rows) {
      const item = element('div', { className: 'metadata-item' });
      item.append(element('dt', { text: term }), element('dd', { text: value }));
      metadata.append(item);
    }
    preview.append(metadata);
    const url = element('a', { className: 'url', text: extracted.url });
    url.href = extracted.url;
    url.target = '_blank';
    url.rel = 'noreferrer';
    preview.append(url);
    workspace.append(preview);
  }

  const controls = element('section', { className: 'card controls' });
  const controlsHeading = element('div', { className: 'card-heading' });
  controlsHeading.append(
    element('p', { className: 'eyebrow', text: 'Summary settings' }),
    element('h2', { text: 'Choose a summary' }),
    element('p', {
      text: overrideModel
        ? `Using a one-time ${PROVIDER_NAMES[selectedProvider]} model override. Your defaults will not change.`
        : `Using ${PROVIDER_NAMES[config.provider]} with your saved per-format model defaults.`,
    }),
  );
  controls.append(controlsHeading);

  const providerSelect = element('select');
  providerSelect.id = 'provider';
  for (const id of PROVIDER_IDS) {
    const option = element('option', { text: PROVIDER_NAMES[id] });
    option.value = id;
    option.selected = id === selectedProvider;
    providerSelect.append(option);
  }
  const modelSelect = element('select');
  modelSelect.id = 'model-override';
  if (modelsBusy) {
    const option = element('option', { text: 'Loading models…' });
    option.value = '';
    modelSelect.append(option);
    modelSelect.disabled = true;
  } else {
    if (selectedProvider === config.provider) {
      const option = element('option', { text: 'Use each format’s saved default' });
      option.value = '';
      modelSelect.append(option);
    }
    if (modelProvider === selectedProvider) {
      for (const item of availableModels) {
        const option = element('option', { text: item.label });
        option.value = item.id;
        modelSelect.append(option);
      }
    }
    modelSelect.value = overrideModel;
    if (!availableModels.length) {
      modelSelect.replaceChildren(element('option', { text: 'Models unavailable' }));
      modelSelect.disabled = true;
    }
  }
  const modelControls = element('div', { className: 'model-controls' });
  modelControls.append(field('Provider', providerSelect), field('Model override', modelSelect));
  controls.append(modelControls);
  const modelStatus = element('p', {
    className: modelError ? 'warning' : 'model-status',
    text:
      modelError ||
      (modelsBusy
        ? `Loading models from ${PROVIDER_NAMES[selectedProvider]}…`
        : overrideModel
          ? 'This model applies only to this summary page. Type to search for another.'
          : 'Each format will use its saved default model. Type to search for a one-time override.'),
  });
  controls.append(modelStatus);

  const languageControls = element('div', { className: 'language-controls' });
  const languageToggle = element('label', { className: 'language-toggle' });
  const languageCheckbox = element('input');
  languageCheckbox.type = 'checkbox';
  languageCheckbox.id = 'language-override';
  languageCheckbox.checked = languageOverrideEnabled;
  languageCheckbox.disabled = busy;
  languageToggle.append(languageCheckbox, element('span', { text: 'Override language' }));
  const languageSelect = element('select');
  languageSelect.id = 'summary-language';
  languageSelect.disabled = !languageOverrideEnabled || busy;
  for (const language of SUMMARY_LANGUAGE_OPTIONS) {
    const option = element('option', { text: language });
    option.value = language;
    option.selected = language === summaryLanguage;
    languageSelect.append(option);
  }
  const languageField = field('Output language', languageSelect);
  languageField.classList.add('language-field');
  languageControls.append(languageToggle, languageField);
  languageControls.append(
    element('p', {
      className: 'language-help',
      text: languageOverrideEnabled
        ? `This summary will be requested in ${summaryLanguage}.`
        : `Automatic: use the article text and detected language${extracted?.language ? ` (${extracted.language})` : ''}.`,
    }),
  );
  controls.append(languageControls);

  if (!overrideModel && selectedProvider === config.provider) {
    const defaults = element('dl', { className: 'format-defaults' });
    for (const { id, label } of SUMMARY_STYLE_OPTIONS) {
      const formatDefault = element('div', { className: 'format-default' });
      formatDefault.append(
        element('dt', { text: label.split(' — ')[0] }),
        element('dd', { text: config.models[id] }),
      );
      defaults.append(formatDefault);
    }
    controls.append(defaults);
  }
  const buttons = element('div', { className: 'summary-actions' });
  const hasUsableModel = selectedProvider === config.provider || Boolean(overrideModel);
  for (const { id, label } of SUMMARY_STYLE_OPTIONS) {
    const button = element('button', {
      className: 'primary summary-option',
      text: label.split(' — ')[0],
      type: 'button',
    });
    button.dataset.summaryStyle = id;
    button.disabled = busy || !hasUsableModel || !extracted?.content;
    buttons.append(button);
  }
  const cancel = element('button', { text: 'Cancel', type: 'button' });
  cancel.id = 'cancel';
  cancel.className = 'cancel-action';
  cancel.disabled = !busy;
  controls.append(buttons, cancel);
  workspace.append(controls);
  app.append(workspace);

  if (!modelsBusy && availableModels.length) {
    summaryModelPicker = createModelPicker(modelSelect, (value) => {
      const canUseDefaults = selectedProvider === renderedConfig?.provider;
      if (!value && canUseDefaults) {
        overrideModel = '';
        modelError = '';
      } else if (availableModels.some((item) => item.id === value)) {
        overrideModel = value;
        modelError = '';
      } else {
        modelError = 'Choose a model from the filtered list.';
      }
      void render();
    });
  }

  if (summary) {
    const result = element('section', { className: 'card result' });
    const resultHeading = element('div', { className: 'result-heading' });
    const resultCopy = element('div');
    resultCopy.append(
      element('p', { className: 'eyebrow', text: 'Generated result' }),
      element('h2', { text: 'Summary' }),
    );
    const copyGroup = element('div', { className: 'copy-group' });
    copyGroup.setAttribute('role', 'group');
    copyGroup.setAttribute('aria-label', 'Copy summary');
    const copyRich = element('button', { text: 'Copy as rich text', type: 'button' });
    copyRich.dataset.copyFormat = 'rich';
    copyRich.dataset.copyLabel = 'Copy as rich text';
    const copyMarkdown = element('button', { text: 'Copy as Markdown', type: 'button' });
    copyMarkdown.dataset.copyFormat = 'markdown';
    copyMarkdown.dataset.copyLabel = 'Copy as Markdown';
    copyGroup.append(copyRich, copyMarkdown);
    resultHeading.append(resultCopy, copyGroup);
    const output = markdownOutput(summary);
    result.append(resultHeading, output);
    if (summaryMeta) {
      const timing = element('footer', { className: 'summary-meta' });
      timing.append(
        element('span', { text: 'API response' }),
        element('span', { text: PROVIDER_NAMES[summaryMeta.provider] }),
        element('span', { text: `${formatSeconds(summaryMeta.durationMs)} seconds` }),
      );
      timing.title = `Model: ${summaryMeta.model}`;
      result.append(timing);
    }
    app.append(result);
  }
}

async function loadModels(provider: ProviderId, askForPermission = false): Promise<void> {
  const permissionGranted = askForPermission ? await requestProviderPermission(provider) : true;
  modelProvider = provider;
  availableModels = [];
  modelError = '';
  modelsBusy = true;
  await render();
  try {
    if (!permissionGranted) {
      throw new Error(
        'Provider access was not granted. Configure this provider in the Linchpin popup.',
      );
    }
    const config = await getSummarizerConfig();
    const models = await fetchProviderModels(provider, config.apiKeys[provider] || '');
    if (selectedProvider !== provider) return;
    availableModels = models;
    if (overrideModel && !models.some((item) => item.id === overrideModel)) {
      overrideModel = '';
    }
    if (provider !== config.provider && !overrideModel) {
      overrideModel = models[0].id;
    }
  } catch (error) {
    if (selectedProvider !== provider) return;
    modelError = error instanceof Error ? error.message : 'Could not load provider models.';
  } finally {
    if (selectedProvider === provider) {
      modelsBusy = false;
      await render();
    }
  }
}

async function extractLiveDocument(tabId: number): Promise<ExtractedPage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ExtractedPage | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      browser.runtime.onMessage.removeListener(receive);
      resolve(value);
    };
    const receive = (message: unknown, sender: Browser.runtime.MessageSender) => {
      if (
        sender.tab?.id === tabId &&
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'linchpin:summary-extraction-result'
      ) {
        const page = 'page' in message ? message.page : null;
        finish(page && typeof page === 'object' ? (page as ExtractedPage) : null);
      }
      return undefined;
    };
    const timeout = globalThis.setTimeout(() => finish(null), 15_000);
    browser.runtime.onMessage.addListener(receive);
    void browser.scripting
      .executeScript({
        target: { tabId },
        files: ['/summarizer-extractor.js'],
      })
      .catch(() => finish(null));
  });
}

async function extract(tabId: number): Promise<void> {
  try {
    let value = await extractLiveDocument(tabId);
    if (!value) {
      const snapshots = await browser.scripting.executeScript({
        target: { tabId },
        func: capturePageSnapshot,
      });
      const snapshot = snapshots[0]?.result;
      value = snapshot ? await extractSnapshotWithReadability(snapshot) : null;
    }
    if (!value) {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: extractPageForSummary,
      });
      value = (results[0]?.result as ExtractedPage | undefined) ?? null;
    }
    if (!value?.content) throw new Error('No readable text was found on this page.');
    extracted = value;
    if (!summaryLanguageInitialized) {
      summaryLanguage = detectedSummaryLanguage(value.language);
      summaryLanguageInitialized = true;
    }
    status = value.truncated
      ? 'Preview ready. The page was capped at 80,000 characters.'
      : 'Preview ready. Nothing has been sent yet.';
  } catch (error) {
    status =
      error instanceof Error
        ? error.message
        : 'Could not extract this page. Restricted browser pages cannot be summarized.';
  }
  await render();
}

app.addEventListener('change', async (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'provider') {
    selectedProvider = target.value as ProviderId;
    overrideModel = '';
    await loadModels(selectedProvider, true);
  } else if (target instanceof HTMLInputElement && target.id === 'language-override') {
    languageOverrideEnabled = target.checked;
    await render();
  } else if (target instanceof HTMLSelectElement && target.id === 'summary-language') {
    if (SUMMARY_LANGUAGE_OPTIONS.includes(target.value as SummaryLanguage)) {
      summaryLanguage = target.value as SummaryLanguage;
    }
    await render();
  }
});

app.addEventListener('click', async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!button) return;
  if (button.id === 'cancel') {
    abortController.current?.abort();
    return;
  }
  const copyFormat = button.dataset.copyFormat;
  if (copyFormat === 'rich' || copyFormat === 'markdown') {
    if (button.classList.contains('copied')) return;
    try {
      if (copyFormat === 'rich') {
        await copyRichSummary();
      } else {
        await navigator.clipboard.writeText(summary);
      }
      showCopiedState(button);
    } catch {
      status = `Copy as ${copyFormat === 'rich' ? 'rich text' : 'Markdown'} failed. Select the summary below to copy it manually.`;
      await render();
    }
    return;
  }
  const style = button.dataset.summaryStyle as SummaryStyle | undefined;
  if (!style || !SUMMARY_STYLE_OPTIONS.some((item) => item.id === style) || !extracted || busy)
    return;
  const providerId = selectedProvider;
  const currentConfig = renderedConfig;
  const model =
    overrideModel ||
    (currentConfig && providerId === currentConfig.provider ? currentConfig.models[style] : '');
  if (!providerId || !model) return;
  if (!(await requestProviderPermission(providerId))) {
    status = 'Provider access was not granted. Linchpin cannot contact this API.';
    await render();
    return;
  }
  const config = await getSummarizerConfig();
  const apiKey = config.apiKeys[providerId] || '';
  busy = true;
  summary = '';
  summaryMeta = undefined;
  status = `Creating a ${style} summary with ${PROVIDER_NAMES[providerId]}…`;
  await render();
  const controller = new AbortController();
  abortController.current = controller;
  try {
    const responseStartedAt = performance.now();
    summary = await createProvider(providerId, apiKey).summarize({
      model,
      systemPrompt: buildSummarySystemPrompt(
        style,
        extracted.language,
        languageOverrideEnabled ? summaryLanguage : undefined,
      ),
      temperature: SUMMARY_TEMPERATURE,
      content: buildPageContent(extracted),
      signal: controller.signal,
    });
    summaryMeta = {
      durationMs: performance.now() - responseStartedAt,
      provider: providerId,
      model,
    };
    status = 'Summary complete. Linchpin does not save summary history.';
  } catch (error) {
    status = error instanceof Error ? error.message : 'Summary request failed.';
  } finally {
    busy = false;
    abortController.current = undefined;
    await render();
  }
});

addEventListener('pagehide', () => {
  abortController.current?.abort();
  extracted = undefined;
  summary = '';
});

const rawTabId = new URL(location.href).searchParams.get('tabId');
const tabId = rawTabId && /^\d+$/.test(rawTabId) ? Number(rawTabId) : NaN;
void render().then(() => {
  if (selectedProvider) void loadModels(selectedProvider);
  if (Number.isSafeInteger(tabId) && tabId >= 0) void extract(tabId);
  else {
    status = 'No source tab was provided. Reopen this page from the Linchpin popup.';
    void render();
  }
});
