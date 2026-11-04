import { Report } from '../../db/database.js';

export const IS_COMPONENTS_V2 = 32768;

/**
 * Truncates text cleanly for Discord text display components if needed.
 */
function sanitizeContent(text: string, maxLength: number = 3800): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 15) + '\n\n...[truncated]';
}

/**
 * Neutral Components V2 container for Phase 1: Report Triage
 */
export function buildPhase1Container(report: Report, triageContent: string) {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        components: [
          {
            type: 14, // Text Display
            content: `### 🧭 Phase 1: Report Triage Assessment • Report \`${report.reportCode}\`\n\n${sanitizeContent(triageContent)}\n\n*— Assessed by Switch Agent \`report-triage\`*`
          }
        ]
      }
    ]
  };
}

/**
 * Neutral Components V2 container for Phase 2: Evidence Forensics
 */
export function buildPhase2Container(report: Report, investigatorContent: string) {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        components: [
          {
            type: 14, // Text Display
            content: `### 🔍 Phase 2: Evidence Forensics & Verification • Report \`${report.reportCode}\`\n\n${sanitizeContent(investigatorContent)}\n\n*— Investigated by Switch Agent \`report-investigator\`*`
          }
        ]
      }
    ]
  };
}

/**
 * Neutral Components V2 container for Phase 3: Moderation Advisor Recommendation
 * Features 4 interactive decision buttons for the human moderator.
 */
export function buildPhase3Container(
  report: Report,
  advisorContent: string,
  options: { isResolved?: boolean; disabled?: boolean } = {}
) {
  const containerComponents: any[] = [
    {
      type: 14, // Text Display
      content: `### ⚖️ Phase 3: Moderation Advisor Recommendation • Report \`${report.reportCode}\`\n\n${sanitizeContent(advisorContent)}\n\n*— Recommended by Switch Agent \`moderation-advisor\`*\n\n> 👤 **Human Decision Required:** Select an action below to authorize and enforce moderation.`
    }
  ];

  if (!options.isResolved) {
    containerComponents.push({
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          style: 2, // Secondary / Gray
          label: 'Dismiss Report',
          custom_id: `verity:act:dismiss:${report.id}`,
          disabled: options.disabled ?? false
        },
        {
          type: 2, // Button
          style: 1, // Primary / Blurple
          label: 'Issue Warning',
          custom_id: `verity:act:warn:${report.id}`,
          disabled: options.disabled ?? false
        },
        {
          type: 2, // Button
          style: 1, // Primary / Blurple
          label: 'Timeout 24h',
          custom_id: `verity:act:timeout:${report.id}`,
          disabled: options.disabled ?? false
        },
        {
          type: 2, // Button
          style: 4, // Danger / Red
          label: 'Ban Member',
          custom_id: `verity:act:ban:${report.id}`,
          disabled: options.disabled ?? false
        }
      ]
    });
  }

  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        components: containerComponents
      }
    ]
  };
}

/**
 * Emerald Green accent container for final human resolution
 * Accent color is ONLY applied to denote final resolution state.
 */
export function buildResolutionContainer(params: {
  reportCode: string;
  actionTaken: string;
  moderatorId: string;
  officialReason: string;
  targetUserId: string;
  executedAt: number;
}) {
  const actionTitle = params.actionTaken.toUpperCase();
  const timeSeconds = Math.floor(params.executedAt / 1000);

  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        accent_color: 0x22C55E, // Emerald Green (meaningful success state)
        components: [
          {
            type: 14, // Text Display
            content: `### 🛡️ Case Resolved: ${actionTitle} • Report \`${params.reportCode}\`\n\n` +
              `**Target Member:** <@${params.targetUserId}> (\`${params.targetUserId}\`)\n` +
              `**Authorized By:** <@${params.moderatorId}> (\`${params.moderatorId}\`)\n` +
              `**Action Applied:** \`${actionTitle}\`\n` +
              `**Timestamp:** <t:${timeSeconds}:F> (<t:${timeSeconds}:R>)\n` +
              `> **Official Reason:**\n> ${params.officialReason}\n\n` +
              `*Multi-agent investigation completed and human decision synchronized.*`
          }
        ]
      }
    ]
  };
}

/**
 * Crimson Red accent container for failure/timeout state
 * Accent color is ONLY applied to denote failure/alert state.
 */
export function buildInvestigationErrorContainer(
  reportCode: string,
  errorMessage: string
) {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        accent_color: 0xEF4444, // Crimson Red (meaningful error state)
        components: [
          {
            type: 14, // Text Display
            content: `### ⚠️ Investigation Alert • Report \`${reportCode}\`\n\n` +
              `**Investigation status:** Incomplete multi-agent cycle.\n` +
              `**Reason:** ${errorMessage}\n\n` +
              `*Human moderators can continue manual review or execute action buttons directly.*`
          }
        ]
      }
    ]
  };
}
