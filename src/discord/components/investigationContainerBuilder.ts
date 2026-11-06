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
 * Neutral Components V2 container displayed while an agent is actively working.
 * This message is subsequently edited in place once the agent delivers its findings.
 */
export function buildPhaseProgressContainer(
  phaseNumber: number,
  agentName: string,
  activityDescription: string
) {
  const titles: Record<number, string> = {
    1: '🧭 Phase 1: Report Triage',
    2: '🔍 Phase 2: Evidence Forensics',
    3: '⚖️ Phase 3: Moderation Advisor'
  };

  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        components: [
          {
            type: 10, // Text Display
            content: `### ${titles[phaseNumber] || 'Investigation Step'}\n\n` +
              `⏳ **@${agentName} is working...**\n` +
              `*${activityDescription}*`
          }
        ]
      }
    ]
  };
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
            type: 10, // Text Display (type 10 in Components V2)
            content: `### 🧭 Phase 1: Report Triage Assessment • Report \`${report.reportCode}\`\n\n${sanitizeContent(triageContent)}\n\n*Assessed by Switch Agent \`report-triage\`*`
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
            type: 10, // Text Display (type 10 in Components V2)
            content: `### 🔍 Phase 2: Evidence Forensics & Verification • Report \`${report.reportCode}\`\n\n${sanitizeContent(investigatorContent)}\n\n*Investigated by Switch Agent \`report-investigator\`*`
          }
        ]
      }
    ]
  };
}

/**
 * Neutral Components V2 container for Phase 3: Moderation Advisor Recommendation
 * Features 2 interactive decision buttons for the human moderator (Take Action, Dismiss Report).
 */
export function buildPhase3Container(
  report: Report,
  advisorContent: string,
  options: { isResolved?: boolean; disabled?: boolean } = {}
) {
  const containerComponents: any[] = [
    {
      type: 10, // Text Display (type 10 in Components V2)
      content: `### ⚖️ Phase 3: Moderation Advisor Recommendation • Report \`${report.reportCode}\`\n\n${sanitizeContent(advisorContent)}`
    }
  ];

  if (!options.isResolved) {
    containerComponents.push({
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          style: 1, // Primary / Blurple
          label: 'Take Action',
          custom_id: `verity:act:take_action:${report.id}`,
          disabled: options.disabled ?? false
        },
        {
          type: 2, // Button
          style: 2, // Secondary / Gray
          label: 'Dismiss Report',
          custom_id: `verity:act:dismiss:${report.id}`,
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
 * In-place updated Action Container for when a report is Resolved.
 * Replaces the action buttons with the official resolution outcome in Emerald Green (0x22C55E).
 */
export function buildResolvedActionContainer(params: {
  report: Report;
  advisorContent?: string;
  actionTaken: string;
  moderatorId: string;
  officialReason: string;
  executedAt: number;
}) {
  const actionTitle = params.actionTaken.toUpperCase();
  const timeSeconds = Math.floor(params.executedAt / 1000);

  const containerComponents: any[] = [];

  if (params.advisorContent) {
    containerComponents.push({
      type: 10, // Text Display
      content: `### ⚖️ Phase 3: Moderation Advisor Recommendation • Report \`${params.report.reportCode}\`\n\n${sanitizeContent(params.advisorContent)}`
    });
    containerComponents.push({
      type: 14, // Separator
      divider: true,
      spacing: 1
    });
  }

  containerComponents.push({
    type: 10, // Text Display
    content: `### 🛡️ Status: Resolved • Action Taken: \`${actionTitle}\`\n\n` +
      `**Target Member:** <@${params.report.reportedUserId}> (\`${params.report.reportedUserId}\`)\n` +
      `**Authorized By:** <@${params.moderatorId}> (\`${params.moderatorId}\`)\n` +
      `**Action Applied:** \`${actionTitle}\`\n` +
      `**Timestamp:** <t:${timeSeconds}:F> (<t:${timeSeconds}:R>)\n` +
      `> **Official Reason:**\n> ${params.officialReason}\n\n` +
      `*Investigation completed. Action authorized and synchronized with Switch.*`
  });

  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        accent_color: 0x22C55E, // Emerald Green (meaningful success state)
        components: containerComponents
      }
    ]
  };
}

/**
 * Components V2 container for live moderator inquiry Q&A in the investigation thread.
 */
export function buildThreadQAContainer(
  reportCode: string,
  agentName: string,
  question: string,
  answer: string,
  moderatorId: string
) {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        components: [
          {
            type: 10, // Text Display
            content: `### 💬 Moderator Inquiry: \`@${agentName}\` • Report \`${reportCode}\`\n\n` +
              `> **Question from <@${moderatorId}>:**\n` +
              `> ${question.replace(/\n/g, '\n> ')}\n\n` +
              `${sanitizeContent(answer)}\n\n` +
              `*Answered by Switch Agent \`${agentName}\`*`
          }
        ]
      }
    ]
  };
}

/**
 * Progress container while an agent is answering a moderator inquiry.
 */
export function buildThreadQAProgressContainer(
  agentName: string,
  moderatorId: string,
  question: string
) {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: 17, // Container
        components: [
          {
            type: 10, // Text Display
            content: `### 💬 Moderator Inquiry: \`@${agentName}\`\n\n` +
              `> **Question from <@${moderatorId}>:**\n` +
              `> ${question.replace(/\n/g, '\n> ')}\n\n` +
              `⏳ **@${agentName} is reviewing case history and formulating an answer...**`
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
            type: 10, // Text Display
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
