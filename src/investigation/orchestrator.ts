import { Client, TextChannel, ThreadChannel } from 'discord.js';
import { db, Report } from '../db/database.js';
import { switchClient } from '../switch/switchClient.js';
import {
  buildPhase1Container,
  buildPhase2Container,
  buildPhase3Container,
  buildInvestigationErrorContainer
} from '../discord/components/investigationContainerBuilder.js';

export interface InvestigationContext {
  report: Report;
  thread: ThreadChannel;
  client: Client;
}

/**
 * Orchestrates the full 3-agent investigation workflow in Switch
 * and synchronizes findings back into the Discord investigation thread.
 */
export async function runInvestigation(context: InvestigationContext): Promise<void> {
  const { report, thread, client } = context;

  console.log(`[Verity Orchestrator] Starting multi-agent investigation for ${report.reportCode}...`);

  // Update status to in_investigation
  db.updateReportStatus(report.id, 'in_investigation');

  // Step 1: Gather Discord message content & preceding context if available
  let targetMessageContent = 'None available';
  let contextMessagesText = '';

  try {
    const originChannel = await client.channels.fetch(report.channelId);
    if (originChannel && originChannel.isTextBased() && !originChannel.isDMBased()) {
      const textChan = originChannel as TextChannel;
      try {
        const targetMessage = await textChan.messages.fetch(report.messageId);
        if (targetMessage) {
          targetMessageContent = targetMessage.cleanContent || targetMessage.content || '[Non-text content or empty]';
          if (targetMessage.attachments.size > 0) {
            const attNames = [...targetMessage.attachments.values()].map((a) => a.name).join(', ');
            targetMessageContent += ` (Attachments: ${attNames})`;
          }
        }
      } catch (err: any) {
        console.warn(`[Verity Orchestrator] Target message fetch failed (may be deleted or missing permission): ${err?.message}`);
        targetMessageContent = '[Target message could not be fetched from Discord — it may have been deleted or bot lacks permission]';
      }

      // Fetch preceding context
      try {
        const preceding = await textChan.messages.fetch({
          before: report.messageId,
          limit: 3
        });
        if (preceding.size > 0) {
          const formatted = [...preceding.values()]
            .reverse()
            .map((m) => `[<@${m.author.id}> at ${m.createdAt.toISOString()}]: ${m.cleanContent || m.content || '[attachment/embed]'}`)
            .join('\n');
          contextMessagesText = formatted;
        }
      } catch {
        // Preceding messages context is optional
      }
    }
  } catch (err: any) {
    console.warn(`[Verity Orchestrator] Origin channel fetch failed: ${err?.message}`);
  }

  // Step 2: Create room in Switch
  let roomId: string;
  try {
    roomId = await switchClient.createRoom(
      report.reportCode,
      `Verity investigation for report ${report.reportCode}. Alleged reason: ${report.reason}`
    );
    db.updateReportStatus(report.id, 'in_investigation', roomId);
    console.log(`[Verity Orchestrator] Switch room created: ${roomId}`);
  } catch (err: any) {
    console.error(`[Verity Orchestrator] Switch room creation failed:`, err);
    await postThreadSafe(
      thread,
      buildInvestigationErrorContainer(report.reportCode, `Could not connect to Switch gateway: ${err.message}`)
    );
    db.updateReportStatus(report.id, 'investigation_failed');
    return;
  }

  // Step 3: Post initial case summary into Switch room
  const evidenceList = db.getEvidenceByReportId(report.id);
  const evidenceSummary = evidenceList.length > 0
    ? evidenceList.map((e) => `- ${e.filename} (${e.detectedMimeType}, ${e.sizeBytes} bytes)`).join('\n')
    : 'None submitted with report';

  const caseBrief =
    `🚨 **New Discord Moderation Report Intake: ${report.reportCode}**\n\n` +
    `**Target Member:** <@${report.reportedUserId}> (\`${report.reportedUserId}\`)\n` +
    `**Reporting Member:** <@${report.reporterId}> (\`${report.reporterId}\`)\n` +
    `**Alleged Violation:** ${report.reason}\n` +
    `**Message Link:** ${report.messageLink}\n` +
    `**Target Message Content:** ${targetMessageContent}\n` +
    (contextMessagesText ? `**Preceding Channel Context:**\n${contextMessagesText}\n` : '') +
    `**Attached Proof Files:**\n${evidenceSummary}`;

  await switchClient.sendMessage(roomId, caseBrief).catch((err) => {
    console.warn(`[Verity Orchestrator] Initial brief post notice: ${err?.message}`);
  });

  // Step 4: Phase 1 — Report Triage
  console.log(`[Verity Orchestrator] Dispatching to @report-triage...`);
  let triageResponse: string;
  try {
    const triagePrompt =
      `@report-triage Please triage this case for Report ${report.reportCode}.\n` +
      `Assess urgency, policy category, severity (Low/Medium/High/Critical), and what evidence needs verification.`;

    const sent = await switchClient.sendMessage(roomId, triagePrompt, switchClient.agentTriageId);
    triageResponse = await switchClient.waitForAgentResponse(roomId, 'triage', sent.seq, 75000);

    db.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 1: Triage',
      agentName: 'report-triage',
      content: triageResponse
    });

    await postThreadSafe(thread, buildPhase1Container(report, triageResponse));
    console.log(`[Verity Orchestrator] Phase 1 (Triage) posted to Discord.`);
  } catch (err: any) {
    console.error(`[Verity Orchestrator] Triage phase failed:`, err);
    await postThreadSafe(
      thread,
      buildInvestigationErrorContainer(report.reportCode, `Triage agent encountered an issue: ${err.message}`)
    );
    triageResponse = `[Triage agent timed out or unreachable: ${err.message}]`;
  }

  // Step 5: Phase 2 — Evidence Forensics
  console.log(`[Verity Orchestrator] Dispatching to @report-investigator...`);
  let investigatorResponse: string;
  try {
    const invPrompt =
      `@report-investigator Please conduct the forensic investigation for Report ${report.reportCode}.\n` +
      `Analyze the target message, context, and proof files. State verified facts versus unverified claims, and note any investigative limitations.`;

    const sent = await switchClient.sendMessage(roomId, invPrompt, switchClient.agentInvestigatorId);
    investigatorResponse = await switchClient.waitForAgentResponse(roomId, 'investigator', sent.seq, 75000);

    db.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 2: Forensics',
      agentName: 'report-investigator',
      content: investigatorResponse
    });

    await postThreadSafe(thread, buildPhase2Container(report, investigatorResponse));
    console.log(`[Verity Orchestrator] Phase 2 (Investigator) posted to Discord.`);
  } catch (err: any) {
    console.error(`[Verity Orchestrator] Investigator phase failed:`, err);
    await postThreadSafe(
      thread,
      buildInvestigationErrorContainer(report.reportCode, `Investigator agent encountered an issue: ${err.message}`)
    );
    investigatorResponse = `[Investigator agent timed out or unreachable: ${err.message}]`;
  }

  // Step 6: Phase 3 — Moderation Advisor
  console.log(`[Verity Orchestrator] Dispatching to @moderation-advisor...`);
  let advisorResponse: string;
  try {
    const advPrompt =
      `@moderation-advisor Based on the triage assessment and investigator findings for Report ${report.reportCode}, provide your final moderation recommendation.\n` +
      `Specify recommended action (Dismiss, Warn, Timeout, or Ban), policy justification, and mitigating factors.`;

    const sent = await switchClient.sendMessage(roomId, advPrompt, switchClient.agentAdvisorId);
    advisorResponse = await switchClient.waitForAgentResponse(roomId, 'advisor', sent.seq, 75000);

    db.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 3: Advisor',
      agentName: 'moderation-advisor',
      content: advisorResponse
    });

    db.updateReportStatus(report.id, 'awaiting_human_action');

    // Post Phase 3 with interactive human decision buttons!
    await postThreadSafe(thread, buildPhase3Container(report, advisorResponse));
    console.log(`[Verity Orchestrator] Phase 3 (Advisor) posted to Discord with interactive buttons.`);
  } catch (err: any) {
    console.error(`[Verity Orchestrator] Advisor phase failed:`, err);
    await postThreadSafe(
      thread,
      buildInvestigationErrorContainer(report.reportCode, `Advisor agent encountered an issue: ${err.message}`)
    );

    // Fallback: Still display interactive buttons so human moderator can take action!
    db.updateReportStatus(report.id, 'awaiting_human_action');
    await postThreadSafe(
      thread,
      buildPhase3Container(
        report,
        `⚠️ Advisor timed out. Human moderator review required directly based on prior phases.`
      )
    );
  }
}

/**
 * Safely posts container to thread with automatic text fallback if Components V2 flags fail.
 */
async function postThreadSafe(thread: ThreadChannel, containerPayload: any): Promise<void> {
  try {
    await thread.send({
      flags: containerPayload.flags,
      components: containerPayload.components
    });
  } catch (err: any) {
    console.warn(`[Verity Orchestrator] Notice: Components V2 post fallback: ${err?.message}`);
    // Extract text content from payload for fallback
    const textContent = containerPayload.components?.[0]?.components?.find((c: any) => c.type === 14)?.content || 'Investigation update';
    const actionRow = containerPayload.components?.[0]?.components?.find((c: any) => c.type === 1);

    await thread.send({
      content: textContent,
      components: actionRow ? [actionRow] : []
    }).catch((fallbackErr) => {
      console.error(`[Verity Orchestrator] Thread fallback send error:`, fallbackErr);
    });
  }
}
