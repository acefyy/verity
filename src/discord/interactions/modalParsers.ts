import { ModalSubmitInteraction } from 'discord.js';

/**
 * Extracts a text string value from a modal submission.
 * Handles inputs wrapped inside ComponentType.LABEL (18) or ActionRow (1).
 */
export function getModalInputValue(
  interaction: ModalSubmitInteraction,
  customId: string
): string {
  // 1. Try discord.js getTextInputValue
  try {
    const val = interaction.fields?.getTextInputValue?.(customId);
    if (val && typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  } catch {
    // Continue
  }

  // 2. Try discord.js getField
  try {
    const field: any = interaction.fields?.getField?.(customId);
    if (field && typeof field.value === 'string' && field.value.trim().length > 0) {
      return field.value.trim();
    }
  } catch {
    // Continue
  }

  // 3. Try inspecting interaction.fields.fields Collection
  try {
    const field: any = (interaction.fields as any)?.fields?.get?.(customId);
    if (field && typeof field.value === 'string' && field.value.trim().length > 0) {
      return field.value.trim();
    }
  } catch {
    // Continue
  }

  // 4. Inspect interaction.components array
  if (Array.isArray(interaction.components)) {
    const found = findValueInComponentTree(interaction.components, customId);
    if (found !== undefined && found.length > 0) return found;
  }

  // 5. Fallback for raw gateway data or test mocks
  const rawComponents = (interaction as any).data?.components;
  if (Array.isArray(rawComponents)) {
    const found = findValueInComponentTree(rawComponents, customId);
    if (found !== undefined) return found;
  }

  return '';
}

/**
 * Helper to recursively search for a text value in component tree.
 */
function findValueInComponentTree(comps: any[], customId: string): string | undefined {
  for (const item of comps) {
    const id = item.customId || item.custom_id;
    if (id === customId && typeof item.value === 'string') {
      return item.value.trim();
    }
    if (item.component) {
      const nested = findValueInComponentTree([item.component], customId);
      if (nested !== undefined) return nested;
    }
    if (Array.isArray(item.components)) {
      const nested = findValueInComponentTree(item.components, customId);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/**
 * Extracts the selected channel ID (or first value) from a select menu component inside a modal.
 * Returns null if not selected or empty.
 */
export function getModalSelectValue(
  interaction: ModalSubmitInteraction,
  customId: string
): string | null {
  // 1. Try discord.js getField
  try {
    const field: any = interaction.fields?.getField?.(customId);
    if (field) {
      if (Array.isArray(field.values) && field.values.length > 0) {
        return field.values[0];
      }
      if (typeof field.value === 'string' && field.value.length > 0) {
        return field.value;
      }
    }
  } catch {
    // Continue
  }

  // 2. Try discord.js getStringSelectValues
  try {
    const values = interaction.fields?.getStringSelectValues?.(customId);
    if (Array.isArray(values) && values.length > 0) {
      return values[0];
    }
  } catch {
    // Continue
  }

  // 3. Try discord.js getSelectedChannels
  try {
    const channels = interaction.fields?.getSelectedChannels?.(customId);
    if (channels && typeof channels.first === 'function') {
      const firstChannel = channels.first();
      if (firstChannel?.id) return firstChannel.id;
    }
  } catch {
    // Continue
  }

  // 4. Try inspecting interaction.fields.fields Collection
  try {
    const field: any = (interaction.fields as any)?.fields?.get?.(customId);
    if (field) {
      if (Array.isArray(field.values) && field.values.length > 0) {
        return field.values[0];
      }
      if (typeof field.value === 'string' && field.value.length > 0) {
        return field.value;
      }
    }
  } catch {
    // Continue
  }

  // 5. Inspect interaction.components array
  if (Array.isArray(interaction.components)) {
    const found = findSelectInComponentTree(interaction.components, customId);
    if (found && found.length > 0) return found[0];
  }

  // 6. Fallback for raw gateway data or test mocks
  const rawComponents = (interaction as any).data?.components;
  if (Array.isArray(rawComponents)) {
    const found = findSelectInComponentTree(rawComponents, customId);
    if (found && found.length > 0) return found[0];
  }

  return null;
}

/**
 * Helper to recursively search for select menu values in component tree.
 */
function findSelectInComponentTree(comps: any[], customId: string): string[] | undefined {
  for (const item of comps) {
    const id = item.customId || item.custom_id;
    if (id === customId) {
      if (Array.isArray(item.values) && item.values.length > 0) {
        return item.values;
      }
      if (typeof item.value === 'string' && item.value.length > 0) {
        return [item.value];
      }
    }
    if (item.component) {
      const nested = findSelectInComponentTree([item.component], customId);
      if (nested !== undefined) return nested;
    }
    if (Array.isArray(item.components)) {
      const nested = findSelectInComponentTree(item.components, customId);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

/**
 * Extracts the boolean state from a Checkbox component (type 23) in a modal submission.
 */
export function getModalCheckboxValue(
  interaction: ModalSubmitInteraction,
  customId: string,
  defaultValue: boolean = false
): boolean {
  // 1. Try discord.js getCheckbox
  try {
    const val = interaction.fields?.getCheckbox?.(customId);
    if (typeof val === 'boolean') return val;
  } catch {
    // Continue
  }

  // 2. Try discord.js getField
  try {
    const field: any = interaction.fields?.getField?.(customId);
    if (field && typeof field.value === 'boolean') {
      return field.value;
    }
    if (field && (field.value === 'true' || field.value === 1)) {
      return true;
    }
    if (field && (field.value === 'false' || field.value === 0)) {
      return false;
    }
  } catch {
    // Continue
  }

  // 3. Try inspecting interaction.fields.fields Collection
  try {
    const field: any = (interaction.fields as any)?.fields?.get?.(customId);
    if (field && typeof field.value === 'boolean') {
      return field.value;
    }
    if (field && (field.value === 'true' || field.value === 1)) {
      return true;
    }
    if (field && (field.value === 'false' || field.value === 0)) {
      return false;
    }
  } catch {
    // Continue
  }

  // 4. Inspect interaction.components array
  if (Array.isArray(interaction.components)) {
    const found = findCheckboxInComponentTree(interaction.components, customId);
    if (found !== undefined) return found;
  }

  // 5. Fallback for raw gateway data or test mocks
  const rawComponents = (interaction as any).data?.components;
  if (Array.isArray(rawComponents)) {
    const found = findCheckboxInComponentTree(rawComponents, customId);
    if (found !== undefined) return found;
  }

  return defaultValue;
}

/**
 * Helper to recursively search for checkbox value in component tree.
 */
function findCheckboxInComponentTree(comps: any[], customId: string): boolean | undefined {
  for (const item of comps) {
    const id = item.customId || item.custom_id;
    if (id === customId) {
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
      const nested = findCheckboxInComponentTree([item.component], customId);
      if (nested !== undefined) return nested;
    }
    if (Array.isArray(item.components)) {
      const nested = findCheckboxInComponentTree(item.components, customId);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}
