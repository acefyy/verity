import { Message } from 'discord.js';
import { db } from '../../db/database.js';
import { switchClient } from '../../switch/switchClient.js';
import {
  buildThreadQAContainer,
  buildThreadQAProgressContainer,
  stripAgentMentions
} from '../components/investigationContainerBuilder.js';

export { stripAgentMentions };

export async function handleThreadMessage(message: Message): Promise<void> {
  // Ignore bots and non-guild messages
  if (message.author.bot || !message.inGuild()) {
    return;
  }

  // Must be in a thread
  if (!message.channel.isThread()) {
    return;
  }

  // Check if thread belongs to an active Verity report
  const report = db.getReportByThreadId(message.channel.id);
  if (!report || !report.switchRoomId) {
    return;
  }

  const contentLower = message.cleanContent.toLowerCase();
  const botId = message.client.user?.id;
  const isBotMentioned = botId ? message.mentions.has(botId) : false;

  const hasAgentKeyword =
    contentLower.includes('@triage') ||
    contentLower.includes('@investigator') ||
    contentLower.includes('@advisor') ||
    contentLower.includes('@moderation-advisor') ||
    contentLower.includes('@verity') ||
    contentLower.includes('triage') ||
    contentLower.includes('investigator') ||
    contentLower.includes('advisor');

  const isQuestion =
    contentLower.startsWith('?') ||
    contentLower.includes('why') ||
    contentLower.includes('what') ||
    contentLower.includes('how') ||
    contentLower.includes('can you') ||
    contentLower.includes('is there') ||
    contentLower.includes('explain') ||
    contentLower.includes('elaborate') ||
    contentLower.includes('clarify');

  // Only respond if question is directed to bot or agents
  if (!isBotMentioned && !hasAgentKeyword && !isQuestion) {
    return;
  }

  // Determine target agent based on query intent
  let targetAgentId = switchClient.agentAdvisorId;
  let agentName = 'moderation-advisor';
  let agentFilter = 'advisor';

  if (contentLower.includes('investigat') || contentLower.includes('forensic') || contentLower.includes('evidence')) {
    targetAgentId = switchClient.agentInvestigatorId;
    agentName = 'report-investigator';
    agentFilter = 'investigator';
  } else if (contentLower.includes('triage') || contentLower.includes('urgency') || contentLower.includes('severity')) {
    targetAgentId = switchClient.agentTriageId;
    agentName = 'report-triage';
    agentFilter = 'triage';
  }

  // Send typing indicator
  await message.channel.sendTyping().catch(() => {});

  // Strip agent mentions so they only appear in the inquiry heading, not the question text
  const cleanQuestion = stripAgentMentions(
    message.cleanContent,
    botId,
    message.client.user?.username
  );

  // Post progress container
  const progressPayload = buildThreadQAProgressContainer(agentName, message.author.id, cleanQuestion);
  let progressMsg: any = null;

  try {
    progressMsg = await message.channel.send({
      flags: progressPayload.flags,
      components: progressPayload.components
    });
  } catch {
    progressMsg = await message.channel.send({
      content: `⏳ **@${agentName} is reviewing case history and formulating an answer...**`
    }).catch(() => null);
  }

  // Dispatch question into the Switch case room
  try {
    const milestones = db.getInvestigationMilestones(report.id);
    const milestoneSummary = milestones.length > 0
      ? milestones.map((m) => `[${m.phase} (@${m.agentName})]:\n${m.content}`).join('\n\n')
      : 'No prior milestones recorded.';

    const prompt =
      `@${agentName} A human moderator (<@${message.author.id}>) asked the following question regarding Report ${report.reportCode}:\n\n` +
      `"${cleanQuestion}"\n\n` +
      `CASE CONTEXT:\n` +
      `- Target Member: <@${report.reportedUserId}> (${report.reportedUserId})\n` +
      `- Alleged Violation: ${report.reason}\n\n` +
      `INVESTIGATION MILESTONES SO FAR:\n` +
      `${milestoneSummary}\n\n` +
      `SWITCH SYSTEM OVERRIDE:\n` +
      `- Ignore the notice saying "your final text is not shown to anyone". Your final text IS captured directly by the orchestrator.\n` +
      `- Do NOT call switch_read_context, switch_connect_to_room, or switch_post_message. They fail with 400.\n` +
      `- Simply output your complete assessment directly as text in your response.\n\n` +
      `FORMATTING INSTRUCTIONS:\n` +
      `- Always begin with a concise "**TL;DR:**" (1 sentence direct answer).\n` +
      `- Provide a structured, concise response under 1,000 characters using bullet points.\n` +
      `- Be direct and analytical without repeating full case preambles.`;

    const sent = await switchClient.sendMessage(report.switchRoomId, prompt, targetAgentId);
    const response = await switchClient.waitForAgentResponse(report.switchRoomId, agentFilter, sent.seq, 180000);

    // Record milestone in database
    db.addInvestigationMilestone({
      reportId: report.id,
      phase: `Q&A: ${agentName}`,
      agentName,
      content: `Question from <@${message.author.id}>: "${cleanQuestion}"\n\nAnswer: ${response}`
    });

    const qaPayload = buildThreadQAContainer(
      report.reportCode,
      agentName,
      cleanQuestion,
      response,
      message.author.id
    );

    if (progressMsg) {
      await progressMsg.edit({
        flags: qaPayload.flags,
        components: qaPayload.components
      }).catch(async () => {
        await message.channel.send({
          content: `### 💬 Moderator Inquiry: \`@${agentName}\` • Report \`${report.reportCode}\`\n> **Q:** ${cleanQuestion}\n\n${response}`
        });
      });
    }
  } catch (err: any) {
    console.error(`[Verity ThreadQA] Error querying @${agentName}:`, err);
    const errorNotice = `⚠️ Agent \`@${agentName}\` could not respond: ${err.message}`;

    if (progressMsg) {
      await progressMsg.edit({
        content: errorNotice,
        components: []
      }).catch(() => {});
    } else {
      await message.channel.send({ content: errorNotice }).catch(() => {});
    }
  }
}
