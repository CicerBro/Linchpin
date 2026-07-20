import {
  DEFAULT_MODELS,
  getSummarizerConfig,
  requestProviderPermission,
  saveProviderApiKey,
  saveSummarizerDefaults,
} from '../../lib/summarizer/config';
import { fetchProviderModels, type ProviderModel } from '../../lib/summarizer/models';
import {
  createModelPicker,
  setModelPickerMessage,
  setModelPickerOptions,
} from '../../lib/summarizer/modelPicker';
import { SUMMARY_STYLE_OPTIONS, type SummaryStyle } from '../../lib/summarizer/prompts';
import { PROVIDER_IDS, PROVIDER_NAMES, type ProviderId } from '../../lib/summarizer/types';
import { getSettings, updateSettings } from '../../lib/storage';

function labeled(text: string, input: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';
  input.setAttribute('aria-label', text);
  const caption = document.createElement('span');
  caption.textContent = text;
  label.append(caption, input);
  return label;
}

function sameDefaults(
  left: Record<SummaryStyle, string>,
  right: Record<SummaryStyle, string>,
): boolean {
  return SUMMARY_STYLE_OPTIONS.every(({ id }) => left[id] === right[id]);
}

export async function renderProviderSettings(
  setStatus: (message: string) => void,
  onSettingsChanged?: (settings: Awaited<ReturnType<typeof getSettings>>) => void,
): Promise<HTMLElement> {
  const config = await getSummarizerConfig();
  const settings = await getSettings();
  const section = document.createElement('section');
  section.className = 'panel provider-panel';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Optional';
  const heading = document.createElement('h2');
  heading.textContent = 'AI summarizer';
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = settings.summarizer.enabled;
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'row';
  enabledLabel.append(enabled, document.createTextNode(' Enable tab summarization'));
  enabled.addEventListener('change', async () => {
    const next = await updateSettings({ summarizer: { enabled: enabled.checked } });
    onSettingsChanged?.(next);
    setStatus('Settings saved.');
  });

  const provider = document.createElement('select');
  for (const id of PROVIDER_IDS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = PROVIDER_NAMES[id];
    option.selected = config.provider === id;
    provider.append(option);
  }

  const modelSelects = Object.fromEntries(
    SUMMARY_STYLE_OPTIONS.map(({ id }) => {
      const select = document.createElement('select');
      select.disabled = true;
      select.dataset.summaryStyle = id;
      return [id, select];
    }),
  ) as Record<SummaryStyle, HTMLSelectElement>;
  const modelPickers = {} as Record<SummaryStyle, ReturnType<typeof createModelPicker>>;
  const modelStatus = document.createElement('p');
  modelStatus.className = 'help model-status';
  let selectedDefaults: Record<SummaryStyle, string> = { ...config.models };

  const showModelMessage = (message: string) => {
    for (const { id } of SUMMARY_STYLE_OPTIONS) {
      const picker = modelPickers[id];
      if (picker) {
        setModelPickerMessage(picker, message);
      } else {
        const select = modelSelects[id];
        const option = document.createElement('option');
        option.value = '';
        option.textContent = message;
        select.replaceChildren(option);
        select.disabled = true;
      }
    }
  };

  const showModels = (
    models: ProviderModel[],
    preferred: Record<SummaryStyle, string>,
  ): Record<SummaryStyle, string> => {
    const normalized = { ...preferred };
    for (const { id } of SUMMARY_STYLE_OPTIONS) {
      normalized[id] = models.some((item) => item.id === preferred[id])
        ? preferred[id]
        : models[0].id;
      const picker = modelPickers[id];
      if (picker) {
        setModelPickerOptions(picker, models, normalized[id], 'Search models…');
      }
    }
    selectedDefaults = normalized;
    return normalized;
  };

  let loadGeneration = 0;
  const loadModels = async (id: ProviderId, preferred: Record<SummaryStyle, string>) => {
    const generation = ++loadGeneration;
    const latest = await getSummarizerConfig();
    const apiKey = latest.apiKeys[id] || '';
    if (!apiKey) {
      showModelMessage('Save an API key to load models');
      modelStatus.textContent = `No API key is saved for ${PROVIDER_NAMES[id]}.`;
      return;
    }
    showModelMessage('Loading models…');
    modelStatus.textContent = `Loading models from ${PROVIDER_NAMES[id]}…`;
    try {
      const models = await fetchProviderModels(id, apiKey);
      if (generation !== loadGeneration || provider.value !== id) return;
      const normalized = showModels(models, preferred);
      modelStatus.textContent = `${models.length} compatible ${models.length === 1 ? 'model' : 'models'} available.`;
      if (!sameDefaults(normalized, latest.models) || id !== latest.provider) {
        await saveSummarizerDefaults(id, normalized);
        const next = await updateSettings({
          summarizer: { provider: id, model: normalized.brief, models: normalized },
        });
        onSettingsChanged?.(next);
      }
    } catch (error) {
      if (generation !== loadGeneration || provider.value !== id) return;
      showModelMessage('Models unavailable');
      modelStatus.textContent = error instanceof Error ? error.message : 'Could not load models.';
    }
  };

  showModelMessage('Loading models…');
  const key = document.createElement('input');
  key.type = 'password';
  key.autocomplete = 'off';
  key.maxLength = 1000;
  key.placeholder = config.apiKeys[config.provider] ? 'Saved — paste to replace' : 'API key';

  provider.addEventListener('change', async () => {
    const id = provider.value as ProviderId;
    key.value = '';
    const latest = await getSummarizerConfig();
    key.placeholder = latest.apiKeys[id] ? 'Saved — paste to replace' : 'API key';
    const fallback = DEFAULT_MODELS[id];
    const defaults: Record<SummaryStyle, string> = {
      brief: fallback,
      bullets: fallback,
      detailed: fallback,
    };
    await saveSummarizerDefaults(id, defaults);
    const next = await updateSettings({
      summarizer: { provider: id, model: fallback, models: defaults },
    });
    onSettingsChanged?.(next);
    await loadModels(id, defaults);
  });

  const saveModelDefault = async (style: SummaryStyle, value: string) => {
    if (!value) return;
    const id = provider.value as ProviderId;
    selectedDefaults = { ...selectedDefaults, [style]: value };
    await saveSummarizerDefaults(id, selectedDefaults);
    const next = await updateSettings({
      summarizer: { provider: id, model: selectedDefaults.brief, models: selectedDefaults },
    });
    onSettingsChanged?.(next);
    const label =
      SUMMARY_STYLE_OPTIONS.find((item) => item.id === style)?.label || style;
    modelStatus.textContent = `${label} default set to ${value}.`;
  };

  const warning = document.createElement('p');
  warning.className = 'help warn';
  warning.textContent =
    'API keys stay in extension local storage, which is not strongly encrypted. Linchpin exports never include API keys, account cookies, or TOTP secrets.';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = config.apiKeys[config.provider]
    ? 'Save key / refresh models'
    : 'Save key & load models';
  save.addEventListener('click', async () => {
    const id = provider.value as ProviderId;
    if (!(await requestProviderPermission(id))) {
      setStatus('Provider access was not granted. Linchpin cannot contact this API.');
      return;
    }
    const latest = await getSummarizerConfig();
    const enteredKey = key.value.trim();
    if (!enteredKey && !latest.apiKeys[id]) {
      setStatus(`Enter an API key for ${PROVIDER_NAMES[id]}.`);
      return;
    }
    if (enteredKey) {
      await saveProviderApiKey(id, enteredKey);
      key.value = '';
      key.placeholder = 'Saved — paste to replace';
      setStatus('API key saved. Loading models…');
      await loadModels(id, latest.models);
      return;
    }
    await loadModels(id, latest.models);
  });
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Remove API key';
  clear.addEventListener('click', async () => {
    const id = provider.value as ProviderId;
    await saveProviderApiKey(id, '');
    key.value = '';
    key.placeholder = 'API key';
    showModelMessage('Save an API key to load models');
    modelStatus.textContent = `No API key is saved for ${PROVIDER_NAMES[id]}.`;
    setStatus('API key removed.');
  });
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(save, clear);
  section.append(
    eyebrow,
    heading,
    enabledLabel,
    labeled('Provider', provider),
    ...SUMMARY_STYLE_OPTIONS.map(({ id, label }) =>
      labeled(`${label} default`, modelSelects[id]),
    ),
    modelStatus,
    labeled('API key', key),
    warning,
    actions,
  );
  for (const { id } of SUMMARY_STYLE_OPTIONS) {
    modelPickers[id] = createModelPicker(modelSelects[id], (value) => {
      void saveModelDefault(id, value);
    });
  }
  void loadModels(config.provider, config.models);
  return section;
}
