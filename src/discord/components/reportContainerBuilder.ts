import { Report } from '../../db/database.js';
import { ValidatedFile } from '../../evidence/validator.js';

export interface ReportContainerParams {
  report: Report;
  files: ValidatedFile[];
  threadUrl?: string;
  evidenceError?: string | null;
  statusOverride?: string;
}

/**
 * Builds the neutral Components V2 Container payload for #reports channel.
 * Uses MessageFlag IS_COMPONENTS_V2 (32768).
 */
export function buildReportContainer(params: {
  report: Report;
  files: ValidatedFile[];
  threadUrl?: string;
  evidenceError?: string | null;
  statusOverride?: string;
}) {
  const { report, files, threadUrl, evidenceError, statusOverride } = params;
  const timestampSeconds = Math.floor(report.createdAt / 1000);
  const currentStatus = statusOverride || report.status;
  const isResolved = currentStatus.toLowerCase().includes('resolved');

  const containerComponents: any[] = [
    {
      type: 10, // TEXT_DISPLAY
      content: `### 🛡️ Report \`${report.reportCode}\` • ${isResolved ? 'Resolved' : 'Pending Investigation'}\n**Status:** ${isResolved ? '🟢' : '🟡'} \`${currentStatus.toUpperCase()}\``
    },
    {
      type: 14 // SEPARATOR
    },
    {
      type: 10, // TEXT_DISPLAY
      content: [
        `**Reported Member:** <@${report.reportedUserId}> (\`${report.reportedUserId}\`)`,
        `**Reporter:** <@${report.reporterId}> (\`${report.reporterId}\`)`,
        `**Channel:** <#${report.channelId}>`,
        `**Message Link:** [Jump to Message](${report.messageLink})`,
        `**Submitted At:** <t:${timestampSeconds}:F>`
      ].join('\n')
    },
    {
      type: 10, // TEXT_DISPLAY
      content: `> **Alleged Reason:**\n> ${report.reason.replace(/\n/g, '\n> ')}`
    }
  ];

  if (evidenceError) {
    containerComponents.push({
      type: 10, // TEXT_DISPLAY
      content: `⚠️ **Evidence Ingestion Notice:** ${evidenceError}`
    });
  }

  if (files.length > 0) {
    containerComponents.push({
      type: 10, // TEXT_DISPLAY
      content: `#### Attached Evidence (${files.length} File${files.length > 1 ? 's' : ''})`
    });

    for (const file of files) {
      containerComponents.push({
        type: 13, // FILE
        file: {
          url: `attachment://${file.sanitizedFilename}`
        }
      });
    }
  }

  if (threadUrl) {
    containerComponents.push({
      type: 1, // ACTION_ROW
      components: [
        {
          type: 2, // BUTTON
          style: 5, // LINK
          label: 'Open Investigation Thread',
          url: threadUrl
        }
      ]
    });
  }

  return {
    flags: 32768, // IS_COMPONENTS_V2
    components: [
      {
        type: 17, // CONTAINER
        // accent_color omitted for neutral container
        components: containerComponents
      }
    ]
  };
}

/**
 * Builds the initial Container inside the report's dedicated thread.
 * When resolved, displays Emerald Green accent (0x22C55E).
 */
export function buildThreadInitialContainer(report: Report, statusText?: string) {
  const currentStatus = statusText || (report.status === 'resolved' ? 'Resolved' : 'Awaiting Agent Triage & Analysis');
  const isResolved = currentStatus.toLowerCase().includes('resolved');

  return {
    flags: 32768, // IS_COMPONENTS_V2
    components: [
      {
        type: 17, // CONTAINER
        accent_color: isResolved ? 0x22C55E : undefined,
        components: [
          {
            type: 10, // TEXT_DISPLAY
            content: `### 📋 Investigation Thread: Report \`${report.reportCode}\`\nThis thread records the multi-agent investigation, evidence review, and human moderator decisions.\n\n- **Target Member:** <@${report.reportedUserId}>\n- **Origin Message:** [Jump to Message](${report.messageLink})\n- **Status:** \`${currentStatus}\``
          }
        ]
      }
    ]
  };
}
