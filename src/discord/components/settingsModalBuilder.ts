import { Report } from '../../db/database.js';

export interface SettingsModalOptions {
  currentReportsChannelId?: string | null;
  currentActionLogChannelId?: string | null;
  requireEvidence?: boolean;
}

/**
 * Builds the /settings configuration modal with Channel Selects and Checkbox.
 * Wraps inputs inside ComponentType.LABEL (18).
 */
export function buildSettingsModal(options: SettingsModalOptions = {}) {
  const reportsDefault = options.currentReportsChannelId
    ? [{ id: options.currentReportsChannelId, type: 'channel' as const }]
    : undefined;

  const actionLogDefault = options.currentActionLogChannelId
    ? [{ id: options.currentActionLogChannelId, type: 'channel' as const }]
    : undefined;

  return {
    title: 'Report Module Settings',
    custom_id: 'verity:modal:settings',
    components: [
      {
        type: 18, // ComponentType.LABEL
        label: 'Report Channel',
        description: 'Channel where submitted reports and investigation threads are posted',
        component: {
          type: 8, // ComponentType.CHANNEL_SELECT
          custom_id: 'verity:field:reports_channel',
          channel_types: [0], // ChannelType.GuildText
          placeholder: 'Select a channel for incoming reports',
          min_values: 1,
          max_values: 1,
          required: true,
          default_values: reportsDefault
        }
      },
      {
        type: 18, // ComponentType.LABEL
        label: 'Action Log Channel',
        description: 'Channel where moderation actions (Warn, Timeout, Kick, Ban) are logged',
        component: {
          type: 8, // ComponentType.CHANNEL_SELECT
          custom_id: 'verity:field:action_log_channel',
          channel_types: [0], // ChannelType.GuildText
          placeholder: 'Select a channel for moderation action logs (Optional)',
          min_values: 0,
          max_values: 1,
          required: false,
          default_values: actionLogDefault
        }
      },
      {
        type: 18, // ComponentType.LABEL
        label: 'Require Evidence',
        description: 'Require users to attach evidence when submitting a report',
        component: {
          type: 23, // ComponentType.CHECKBOX
          custom_id: 'verity:field:require_evidence',
          default: options.requireEvidence ?? false
        }
      }
    ]
  };
}

export interface TakeActionModalOptions {
  report: Report;
  defaultReason?: string;
}

/**
 * Builds the Take Action modal presenting punishment selection, duration,
 * pre-filled editable reason, and optional evidence/context notes.
 * Evidence is never required from moderators.
 */
export function buildTakeActionModal(options: TakeActionModalOptions) {
  const { report, defaultReason } = options;
  const prefillReason = (defaultReason || report.reason || '').slice(0, 1000);

  return {
    title: `Take Action: ${report.reportCode}`,
    custom_id: `verity:modal:take_action:${report.id}`,
    components: [
      {
        type: 18, // ComponentType.LABEL
        label: 'Punishment Action',
        description: 'Select the moderation action to enforce on the reported member',
        component: {
          type: 3, // ComponentType.STRING_SELECT
          custom_id: 'verity:field:action_type',
          placeholder: 'Choose moderation action (Warn, Timeout/Mute, Kick, Ban)',
          min_values: 1,
          max_values: 1,
          required: true,
          options: [
            {
              label: 'Warn Member',
              value: 'warn',
              description: 'Issue an official recorded warning notice to the member'
            },
            {
              label: 'Mute / Timeout',
              value: 'timeout',
              description: 'Temporarily mute and restrict member from communicating'
            },
            {
              label: 'Kick Member',
              value: 'kick',
              description: 'Remove member from the server'
            },
            {
              label: 'Ban Member',
              value: 'ban',
              description: 'Permanently ban member from the server'
            }
          ]
        }
      },
      {
        type: 18, // ComponentType.LABEL
        label: 'Duration (Mute / Timeout only)',
        description: 'Duration for Timeout (e.g. 10m, 1h, 24h, 7d). Default: 24h. Ignored for others.',
        component: {
          type: 4, // ComponentType.TEXT_INPUT
          custom_id: 'verity:field:action_duration',
          style: 1, // Short
          value: '24h',
          placeholder: '10m, 1h, 24h, 7d (max 28d)',
          required: false,
          max_length: 20
        }
      },
      {
        type: 18, // ComponentType.LABEL
        label: 'Moderation Reason',
        description: 'Official reason recorded in database and sent in notification',
        component: {
          type: 4, // ComponentType.TEXT_INPUT
          custom_id: 'verity:field:action_reason',
          style: 2, // Paragraph
          value: prefillReason,
          min_length: 5,
          max_length: 1000,
          placeholder: 'Specify the official violation reason...',
          required: true
        }
      },
      {
        type: 18, // ComponentType.LABEL
        label: 'Evidence & Notes (Optional)',
        description: 'Optional links, screenshots, or context notes for records',
        component: {
          type: 4, // ComponentType.TEXT_INPUT
          custom_id: 'verity:field:action_evidence',
          style: 2, // Paragraph
          min_length: 0,
          max_length: 1000,
          placeholder: 'Optional additional proof or context notes...',
          required: false
        }
      }
    ]
  };
}
