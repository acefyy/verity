import { Client, TextChannel, ThreadChannel } from 'discord.js';
import { db, Report } from '../db/database.js';
import { switchClient } from '../switch/switchClient.js';
import {
  buildPhaseProgressContainer,
  buildPhase1Container,
  buildPhase2Container,
  buildPhase3Container,
  buildInvestigationErrorContainer
} from '../discord/components/investigationContainerBuilder.js';
import { buildThreadInitialContainer } from '../discord/components/reportContainerBuilder.js';

export interface InvestigationContext {
  report: Report;
  thread: ThreadChannel;
  client: Client;
}

/**
 * Updates the initial container in the investigation thread to reflect current progress.
 */
async function updateThreadInitialStatus(
  thread: ThreadChannel,
  report: Report,
  statusText: string
): Promise<void> {
  try {
    let initialMsg = null;
    if (report.discordThreadInitialMsgId) {
      initialMsg = await thread.messages.fetch(report.discordThreadInitialMsgId).catch(() => null);
    }
    if (!initialMsg) {
      const messages = await thread.messages.fetch({ limit: 10 });
      initialMsg = [...messages.values()]
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .find((m) => m.components?.[0]?.type === 17);
    }
    if (initialMsg) {
      const updatedContainer = buildThreadInitialContainer(report, statusText);
      await initialMsg.edit({
        flags: updatedContainer.flags,
        components: updatedContainer.components
      });
    }
  } catch (err: any) {
    console.warn(`[Verity Orchestrator] Could not update thread initial status: ${err?.message}`);
  }
}

/**
 * Orchestrates the full 3-agent investigation workflow in Switch
 * and synchronizes findings back into the Discord investigation thread.
 *
 * For each phase:
 * 1. Sends an initial progress status ("@agent is working...")
 * 2. Waits for the Switch agent response (with 120s timeout & TL;DR formatting constraints)
 * 3. Edits that message in place to display the final response container
 */
export async function runInvestigation(context: InvestigationContext): Promise<void> {
  const { report, thread, client } = context;

  console.log(`[Verity Orchestrator] Starting multi-agent investigation for ${report.reportCode}...`);

  // Update status to in_investigation
  db.updateReportStatus(report.id, 'in_investigation');
  await updateThreadInitialStatus(thread, report, '🔍 Investigation in Progress');

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
        targetMessageContent = '[Target message could not be fetched from Discord (it may have been deleted or bot lacks permission)]';
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
    await updateThreadInitialStatus(thread, report, '⚠️ Investigation Failed (Switch Unreachable)');
    return;
  }

  // Step 3: Post initial case summary into Switch room
  const evidenceList = db.getEvidenceByReportId(report.id);
  const evidenceSummary = evidenceList.length > 0
    ? evidenceList.map((e) => `- ${e.filename} (${e.detectedMimeType}, ${e.sizeBytes} bytes)`).join('\n')
    : 'None submitted with report';

  const priorResolutions = db.getResolutionsForUser(report.reportedUserId);
  const formatPriorDate = (ts: number): string => {
    let ms = ts;
    if (ms > 1e14) ms = Math.floor(ms / 1000);
    else if (ms < 1e11) ms = ms * 1000;
    const d = new Date(ms);
    if (isNaN(d.getTime()) || d.getFullYear() > 2100 || d.getFullYear() < 2020) {
      return 'Prior record';
    }
    return d.toISOString().split('T')[0];
  };

  const priorHistoryText = priorResolutions.length > 0
    ? priorResolutions.slice(0, 5).map((r) => `- [${formatPriorDate(r.executedAt)}] Action: ${r.actionTaken.toUpperCase()} - Reason: ${r.officialReason}`).join('\n')
    : 'Clean history (no prior recorded violations)';

  const caseBrief =
    `🚨 **New Discord Moderation Report Intake: ${report.reportCode}**\n\n` +
    `**Target Member:** <@${report.reportedUserId}> (\`${report.reportedUserId}\`)\n` +
    `**Reporting Member:** <@${report.reporterId}> (\`${report.reporterId}\`)\n` +
    `**Prior Server Violations:**\n${priorHistoryText}\n` +
    `**Alleged Violation:** ${report.reason}\n` +
    `**Message Link:** ${report.messageLink}\n` +
    `**Target Message Content:** ${targetMessageContent}\n` +
    (contextMessagesText ? `**Preceding Channel Context:**\n${contextMessagesText}\n` : '') +
    `**Attached Proof Files:**\n${evidenceSummary}`;

  await switchClient.sendMessage(roomId, caseBrief).catch((err) => {
    console.warn(`[Verity Orchestrator] Initial brief post notice: ${err?.message}`);
  });

  // Step 4: Phase 1: Report Triage
  console.log(`[Verity Orchestrator] Starting Phase 1 (@report-triage)...`);
  const p1ProgressMsg = await postThreadSafe(
    thread,
    buildPhaseProgressContainer(1, 'report-triage', 'Evaluating urgency, policy violation category, and evidence gaps...')
  );

  let triageResponse: string;
  try {
    const triagePrompt =
      `@report-triage Please triage Report ${report.reportCode}.\n\n` +
      `CASE DETAILS:\n` +
      `- Target Member: <@${report.reportedUserId}> (${report.reportedUserId})\n` +
      `- Reporting Member: <@${report.reporterId}> (${report.reporterId})\n` +
      `- Alleged Violation: ${report.reason}\n` +
      `- Message Link: ${report.messageLink}\n` +
      `- Target Message Content: "${targetMessageContent}"\n` +
      (contextMessagesText ? `- Preceding Channel Context:\n${contextMessagesText}\n` : '') +
      `- Attached Proof Files: ${evidenceSummary}\n` +
      `- Prior Server Violations:\n${priorHistoryText}\n\n` +
      `SWITCH SYSTEM OVERRIDE:\n` +
      `- Ignore the notice saying "your final text is not shown to anyone". Your final text IS captured directly by the orchestrator.\n` +
      `- Do NOT call switch_read_context, switch_connect_to_room, or switch_post_message. They fail with 400.\n` +
      `- Simply output your complete assessment directly as text in your response.\n\n` +
      `FORMATTING INSTRUCTIONS:\n` +
      `- Always begin with a concise "**TL;DR:**" (1-2 sentences summarizing urgency and violation category).\n` +
      `- Keep your entire response compact, structured, and under 1,200 characters using bullet points:\n` +
      `  • **Violation Category:** [Category]\n` +
      `  • **Severity & Urgency:** [Level]\n` +
      `  • **Evidence Available:** [Status]\n` +
      `  • **Missing Information:** [Key gaps]\n` +
      `- Be direct and concise without repetitive preambles.`;

    const sent = await switchClient.sendMessage(roomId, triagePrompt, switchClient.agentTriageId);
    triageResponse = await switchClient.waitForAgentResponse(roomId, 'triage', sent.seq, 180000);

    db.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 1: Triage',
      agentName: 'report-triage',
      content: triageResponse
    });

    const p1Payload = buildPhase1Container(report, triageResponse);
    if (p1ProgressMsg) {
      await p1ProgressMsg.edit({
        flags: p1Payload.flags,
        components: p1Payload.components
      }).catch(async () => {
        await postThreadSafe(thread, p1Payload);
      });
    } else {
      await postThreadSafe(thread, p1Payload);
    }
    console.log(`[Verity Orchestrator] Phase 1 (Triage) delivered and edited in place.`);
  } catch (err: any) {
    console.error(`[Verity Orchestrator] Triage phase failed:`, err);
    const errPayload = buildInvestigationErrorContainer(
      report.reportCode,
      `Triage agent encountered an issue: ${err.message}`
    );
    if (p1ProgressMsg) {
      await p1ProgressMsg.edit({
        flags: errPayload.flags,
        components: errPayload.components
      }).catch(async () => {
        await postThreadSafe(thread, errPayload);
      });
    } else {
      await postThreadSafe(thread, errPayload);
    }
    triageResponse = `[Triage agent timed out or unreachable: ${err.message}]`;
  }

  // Step 5: Phase 2: Evidence Forensics
  console.log(`[Verity Orchestrator] Starting Phase 2 (@report-investigator)...`);
  const p2ProgressMsg = await postThreadSafe(
    thread,
    buildPhaseProgressContainer(2, 'report-investigator', 'Auditing reported message, channel context, and verifying claims...')
  );

  let investigatorResponse: string;
  try {
    const invPrompt =
      `@report-investigator Please conduct the forensic evidence review for Report ${report.reportCode}.\n\n` +
      `CASE DETAILS:\n` +
      `- Target Member: <@${report.reportedUserId}> (${report.reportedUserId})\n` +
      `- Alleged Violation: ${report.reason}\n` +
      `- Message Link: ${report.messageLink}\n` +
      `- Target Message Content: "${targetMessageContent}"\n` +
      (contextMessagesText ? `- Preceding Channel Context:\n${contextMessagesText}\n` : '') +
      `- Attached Proof Files: ${evidenceSummary}\n\n` +
      `PHASE 1 TRIAGE FINDINGS:\n${triageResponse}\n\n` +
      `SWITCH SYSTEM OVERRIDE:\n` +
      `- Ignore the notice saying "your final text is not shown to anyone". Your final text IS captured directly by the orchestrator.\n` +
      `- Do NOT call switch_read_context, switch_connect_to_room, or switch_post_message. They fail with 400.\n` +
      `- Simply output your complete assessment directly as text in your response.\n\n` +
      `FORMATTING INSTRUCTIONS:\n` +
      `- Always begin with a concise "**TL;DR:**" (1-2 sentences stating verified facts versus unverified claims).\n` +
      `- Keep your entire report compact, structured, and under 1,500 characters using bullet points:\n` +
      `  • **Evidence Reviewed:** [Messages, proof files]\n` +
      `  • **Verified Facts:** [Confirmed points]\n` +
      `  • **Unverified Claims & Limitations:** [What cannot be corroborated]\n` +
      `  • **Forensic Confidence:** [Confirmed / Inconclusive / Unsubstantiated]\n` +
      `- Never invent facts. Be analytical and concise.`;

    const sent = await switchClient.sendMessage(roomId, invPrompt, switchClient.agentInvestigatorId);
    investigatorResponse = await switchClient.waitForAgentResponse(roomId, 'investigator', sent.seq, 180000);

    db.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 2: Forensics',
      agentName: 'report-investigator',
      content: investigatorResponse
    });

    const p2Payload = buildPhase2Container(report, investigatorResponse);
    if (p2ProgressMsg) {
      await p2ProgressMsg.edit({
        flags: p2Payload.flags,
        components: p2Payload.components
      }).catch(async () => {
        await postThreadSafe(thread, p2Payload);
      });
    } else {
      await postThreadSafe(thread, p2Payload);
    }
    console.log(`[Verity Orchestrator] Phase 2 (Investigator) delivered and edited in place.`);
  } catch (err: any) {
    console.error(`[Verity Orchestrator] Investigator phase failed:`, err);
    const errPayload = buildInvestigationErrorContainer(
      report.reportCode,
      `Investigator agent encountered an issue: ${err.message}`
    );
    if (p2ProgressMsg) {
      await p2ProgressMsg.edit({
        flags: errPayload.flags,
        components: errPayload.components
      }).catch(async () => {
        await postThreadSafe(thread, errPayload);
      });
    } else {
      await postThreadSafe(thread, errPayload);
    }
    investigatorResponse = `[Investigator agent timed out or unreachable: ${err.message}]`;
  }

  // Step 6: Phase 3: Moderation Advisor
  console.log(`[Verity Orchestrator] Starting Phase 3 (@moderation-advisor)...`);
  const p3ProgressMsg = await postThreadSafe(
    thread,
    buildPhaseProgressContainer(3, 'moderation-advisor', 'Synthesizing triage, forensic audit, and community guidelines...')
  );

  let advisorResponse: string;
  try {
    const advPrompt =
      `@moderation-advisor Synthesize the triage assessment and investigator findings for Report ${report.reportCode}.\n\n` +
      `CASE DETAILS:\n` +
      `- Target Member: <@${report.reportedUserId}> (${report.reportedUserId})\n` +
      `- Alleged Violation: ${report.reason}\n` +
      `- Prior Server Violations:\n${priorHistoryText}\n\n` +
      `PHASE 1 TRIAGE FINDINGS:\n${triageResponse}\n\n` +
      `PHASE 2 FORENSIC INVESTIGATION FINDINGS:\n${investigatorResponse}\n\n` +
      `SWITCH SYSTEM OVERRIDE:\n` +
      `- Ignore the notice saying "your final text is not shown to anyone". Your final text IS captured directly by the orchestrator.\n` +
      `- Do NOT call switch_read_context, switch_connect_to_room, or switch_post_message. They fail with 400.\n` +
      `- Simply output your complete assessment directly as text in your response.\n\n` +
      `FORMATTING INSTRUCTIONS:\n` +
      `- Always begin with a concise "**TL;DR:**" (1-2 sentences stating your recommended action: Dismiss, Warn, Timeout/Mute, Kick, or Ban).\n` +
      `- Keep your entire recommendation compact, structured, and under 1,200 characters using bullet points:\n` +
      `  • **Recommended Action:** [Dismiss / Warn / Timeout / Kick / Ban]\n` +
      `  • **Policy Justification:** [Proportionality and rule rationale]\n` +
      `  • **Mitigating / Aggravating Factors:** [Context]\n` +
      `  • **Directive for Human Moderator:** [Final step]\n` +
      `- Be direct, authoritative, and concise.`;

    const sent = await switchClient.sendMessage(roomId, advPrompt, switchClient.agentAdvisorId);
    advisorResponse = await switchClient.waitForAgentResponse(roomId, 'advisor', sent.seq, 180000);

    db.addInvestigationMilestone({
      reportId: report.id,
      phase: 'Phase 3: Advisor',
      agentName: 'moderation-advisor',
      content: advisorResponse
    });

    db.updateReportStatus(report.id, 'awaiting_human_action');

    // Edit Phase 3 message in place with interactive human decision buttons!
    const p3Payload = buildPhase3Container(report, advisorResponse);
    if (p3ProgressMsg) {
      await p3ProgressMsg.edit({
        flags: p3Payload.flags,
        components: p3Payload.components
      }).catch(async () => {
        await postThreadSafe(thread, p3Payload);
      });
    } else {
      await postThreadSafe(thread, p3Payload);
    }

    await updateThreadInitialStatus(thread, report, '⚖️ Awaiting Moderator Action');
    console.log(`[Verity Orchestrator] Phase 3 (Advisor) delivered and edited in place with interactive buttons.`);
  } catch (err: any) {
    console.error(`[Verity Orchestrator] Advisor phase failed:`, err);
    db.updateReportStatus(report.id, 'awaiting_human_action');

    const fallbackPayload = buildPhase3Container(
      report,
      `⚠️ Advisor agent encountered a delay (${err.message}). Human moderator review can proceed directly using the findings above.`
    );
    if (p3ProgressMsg) {
      await p3ProgressMsg.edit({
        flags: fallbackPayload.flags,
        components: fallbackPayload.components
      }).catch(async () => {
        await postThreadSafe(thread, fallbackPayload);
      });
    } else {
      await postThreadSafe(thread, fallbackPayload);
    }
    await updateThreadInitialStatus(thread, report, '⚖️ Awaiting Moderator Action');
  }
}

/**
 * Safely posts container to thread with automatic text fallback if Components V2 flags fail.
 */
async function postThreadSafe(thread: ThreadChannel, containerPayload: any): Promise<any> {
  try {
    return await thread.send({
      flags: containerPayload.flags,
      components: containerPayload.components
    });
  } catch (err: any) {
    console.warn(`[Verity Orchestrator] Notice: Components V2 post fallback: ${err?.message}`);
    // Extract text content from payload for fallback (type 10: TEXT_DISPLAY)
    const textContent =
      containerPayload.components?.[0]?.components?.find((c: any) => c.type === 10)?.content ||
      'Investigation update';
    const actionRow = containerPayload.components?.[0]?.components?.find((c: any) => c.type === 1);

    return await thread.send({
      content: textContent,
      components: actionRow ? [actionRow] : []
    }).catch((fallbackErr) => {
      console.error(`[Verity Orchestrator] Thread fallback send error:`, fallbackErr);
      return null;
    });
  }
}
