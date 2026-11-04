import { ModalSubmitInteraction } from 'discord.js';

/**
 * Extracts a text string value from a modal submission.
 * Handles inputs wrapped inside ComponentType.LABEL (18).
 */
export function getModalInputValue(
  interaction: ModalSubmitInteraction,
  customId: string
): string {
  try {
    const val = interaction.fields.getTextInputValue(customId);
    if (val) return val.trim();
  } catch {
    // Continue to raw inspection
  }

  const rawComponents = (interaction as any).data?.components;
  if (Array.isArray(rawComponents)) {
    const findValue = (comps: any[]): string | undefined => {
      for (const item of comps) {
        if (item.custom_id === customId && typeof item.value === 'string') {
          return item.value.trim();
        }
        if (item.component) {
          const nested = findValue([item.component]);
          if (nested !== undefined) return nested;
        }
        if (Array.isArray(item.components)) {
          const nested = findValue(item.components);
          if (nested !== undefined) return nested;
        }
      }
      return undefined;
    };

    const found = findValue(rawComponents);
    if (found !== undefined) {
      return found;
    }
  }

  return '';
}

/**
 * Extracts the selected channel ID (or first value) from a select menu component inside a modal.
 * Returns null if not selected or empty.
 */
export function getModalSelectValue(
  interaction: ModalSubmitInteraction,
  customId: string
): string | null {
  const rawComponents = (interaction as any).data?.components;
  if (Array.isArray(rawComponents)) {
    const findSelect = (comps: any[]): string[] | undefined => {
      for (const item of comps) {
        if (item.custom_id === customId) {
          if (Array.isArray(item.values) && item.values.length > 0) {
            return item.values;
          }
          if (typeof item.value === 'string' && item.value.length > 0) {
            return [item.value];
          }
        }
        if (item.component) {
          const nested = findSelect([item.component]);
          if (nested !== undefined) return nested;
        }
        if (Array.isArray(item.components)) {
          const nested = findSelect(item.components);
          if (nested !== undefined) return nested;
        }
      }
      return undefined;
    };

    const found = findSelect(rawComponents);
    if (found && found.length > 0) {
      return found[0];
    }
  }

  return null;
}

/**
 * Extracts the boolean state from a Checkbox component (type 23) in a modal submission.
 */
export function getModalCheckboxValue(
  interaction: ModalSubmitInteraction,
  customId: string,
  defaultValue: boolean = false
): boolean {
  const rawComponents = (interaction as any).data?.components;
  if (Array.isArray(rawComponents)) {
    const findCheckbox = (comps: any[]): boolean | undefined => {
      for (const item of comps) {
        if (item.custom_id === customId) {
          if (typeof item.value === 'boolean') {
            return item.value;
          }
          if (item.value === 'true' || item.value === 1) {
            return true;
          }
          if (item.value === 'false' || item.value === 0) {
            return false;
          }
        }
        if (item.component) {
          const nested = findCheckbox([item.component]);
          if (nested !== undefined) return nested;
        }
        if (Array.isArray(item.components)) {
          const nested = findCheckbox(item.components);
          if (nested !== undefined) return nested;
        }
      }
      return undefined;
    };

    const found = findCheckbox(rawComponents);
    if (found !== undefined) {
      return found;
    }
  }

  return defaultValue;
}
