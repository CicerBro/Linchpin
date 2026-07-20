import TomSelect from 'tom-select';
import type { ProviderModel } from './models';

export type ModelPickerOption = ProviderModel & { defaultOption?: boolean };

export function createModelPicker(
  select: HTMLSelectElement,
  onChange: (value: string) => void,
): TomSelect {
  return new TomSelect(select, {
    plugins: ['dropdown_input'],
    valueField: 'id',
    labelField: 'label',
    searchField: ['label', 'id'],
    maxItems: 1,
    maxOptions: null,
    create: false,
    openOnFocus: true,
    closeAfterSelect: true,
    hideSelected: false,
    allowEmptyOption: true,
    onChange: (value: string | number) => onChange(String(value)),
    render: {
      option: (
        data: Record<string, unknown>,
        escape: (value: string) => string,
      ) => {
        const id = String(data.id || '');
        const label = String(data.label || id);
        const detail = id && id !== label && !label.includes(id)
          ? `<span class="model-option-id">${escape(id)}</span>`
          : '';
        return `<div class="model-option"><span>${escape(label)}</span>${detail}</div>`;
      },
    },
  });
}

export function setModelPickerOptions(
  picker: TomSelect,
  options: ModelPickerOption[],
  value: string,
  placeholder: string,
): void {
  picker.clear(true);
  picker.clearOptions();
  picker.addOptions(options.map((option) => ({
    id: option.id,
    label: option.label,
    defaultOption: option.defaultOption,
  })));
  picker.control_input.placeholder = placeholder;
  picker.setValue(value, true);
  picker.enable();
  picker.refreshOptions(false);
}

export function setModelPickerMessage(picker: TomSelect, message: string): void {
  picker.clear(true);
  picker.clearOptions();
  picker.control_input.placeholder = message;
  picker.disable();
}
