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
        description: 'Require proof files or evidence when moderators take action on a report',
        component: {
          type: 23, // ComponentType.CHECKBOX
          custom_id: 'verity:field:require_evidence',
          default: options.requireEvidence ?? false
        }
      }
    ]
  };
}

/**
 * Builds the Action Evidence & Confirmation modal presented when evidence is required
 * before a moderator can complete a moderation action.
 */
export function buildActionEvidenceModal(
  report: Report,
  action: string,
  hasReportEvidence: boolean
) {
  const actionTitle = action.toUpperCase();

  return {
    title: `Evidence Required: ${actionTitle}`,
    custom_id: `verity:modal:action_evidence:${action}:${report.id}`,
    components: [
      {
        type: 18, // ComponentType.LABEL
        label: 'Proof / Evidence (URL or Details)',
        description: hasReportEvidence
          ? 'Evidence files already attached. Enter additional proof or leave as is.'
          : 'Provide image link, message link, or forensic proof (Required by server settings)',
        component: {
          type: 4, // ComponentType.TEXT_INPUT
          custom_id: 'verity:field:action_evidence',
          style: 2, // Paragraph
          min_length: hasReportEvidence ? 0 : 10,
          max_length: 1000,
          placeholder: hasReportEvidence
            ? 'Optional additional proof or context notes...'
            : 'Enter evidence link or detailed proof corroborating the violation...',
          required: !hasReportEvidence
        }
      },
      {
        type: 18, // ComponentType.LABEL
        label: 'Moderation Reason',
        description: 'Specify the official reason recorded in moderation audit logs',
        component: {
          type: 4, // ComponentType.TEXT_INPUT
          custom_id: 'verity:field:action_reason',
          style: 2, // Paragraph
          min_length: 5,
          max_length: 500,
          value: report.reason.slice(0, 500),
          required: true
        }
      }
    ]
  };
}
