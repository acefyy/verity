import { Report } from '../../db/database.js';

export const IS_COMPONENTS_V2 = 32768;

export interface ActionLogParams {
  report: Report;
  actionTaken: string;
  moderatorId: string;
  targetUserId: string;
  officialReason: string;
  executedAt: number;
  threadUrl?: string;
  evidenceSummary?: string;
}

export function buildActionLogContainer(params: ActionLogParams) {
  const actionTitle = params.actionTaken.toUpperCase();
  const timeSeconds = Math.floor(params.executedAt / 1000);

  // Set accent color based on action severity
  let accentColor: number | undefined;
  if (params.actionTaken === 'ban' || params.actionTaken === 'kick') {
    accentColor = 0xEF4444; // Crimson Red
  } else if (params.actionTaken === 'timeout') {
    accentColor = 0xF59E0B; // Amber
  } else if (params.actionTaken === 'warn') {
    accentColor = 0x22C55E; // Emerald Green
  } else {
    accentColor = undefined; // Neutral for dismiss
  }

  const evidenceText = params.evidenceSummary || 'None attached';
  const threadText = params.threadUrl ? `- **Investigation Thread:** [Open Thread](${params.threadUrl})` : '';

  const content = [
    `### 🛡️ Moderation Action Log: \`${actionTitle}\` • Report \`${params.report.reportCode}\``,
    '',
    `- **Target Member:** <@${params.targetUserId}> (\`${params.targetUserId}\`)`,
    `- **Authorized By:** <@${params.moderatorId}> (\`${params.moderatorId}\`)`,
    `- **Action Enforced:** \`${actionTitle}\``,
    `- **Origin Channel:** <#${params.report.channelId}>`,
    `- **Origin Message:** [Jump to Message](${params.report.messageLink})`,
    threadText,
    `- **Timestamp:** <t:${timeSeconds}:F> (<t:${timeSeconds}:R>)`,
    '',
    `> **Official Reason:**`,
    `> ${params.officialReason}`,
    '',
    `**Evidence & Proof:** ${evidenceText}`
  ].filter(Boolean).join('\n');

  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        accent_color: accentColor,
        components: [
          {
            type: 10, // Text Display
            content
          }
        ]
      }
    ]
  };
}
