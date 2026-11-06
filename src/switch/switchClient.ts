import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export interface SwitchClientOptions {
  apiUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  agentTriageId?: string;
  agentInvestigatorId?: string;
  agentAdvisorId?: string;
}

export interface SwitchMessage {
  messageId: string;
  seq: number;
  roomId: string;
  sender?: {
    id: string;
    name: string;
    type?: string;
  };
  body: string;
  sentAt: string;
  attachments?: Array<{
    uri: string;
    filename: string;
    mimetype: string;
    size: number;
  }>;
}

export class SwitchClient {
  private apiUrl: string;
  private adminEmail: string;
  private adminPassword: string;
  public agentTriageId: string;
  public agentInvestigatorId: string;
  public agentAdvisorId: string;

  private token: string | null = null;
  private adminUserId: string | null = null;

  constructor(options: SwitchClientOptions = {}) {
    this.apiUrl = options.apiUrl || config.switchApiUrl;
    this.adminEmail = options.adminEmail || config.switchAdminEmail;
    this.adminPassword = options.adminPassword || config.switchAdminPassword;
    this.agentTriageId = options.agentTriageId || config.switchAgentTriageId;
    this.agentInvestigatorId = options.agentInvestigatorId || config.switchAgentInvestigatorId;
    this.agentAdvisorId = options.agentAdvisorId || config.switchAgentAdvisorId;
  }

  /**
   * Authenticate with Switch Gateway and acquire session cookie / token.
   */
  public async login(): Promise<string> {
    const res = await fetch(`${this.apiUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: this.adminEmail,
        password: this.adminPassword
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Switch login failed (${res.status}): ${errText}`);
    }

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/switch_auth=([^;]+)/);
      if (match) {
        this.token = match[1];
      }
    }

    const data = (await res.json()) as any;
    if (data.id) {
      this.adminUserId = data.id;
    }

    if (!this.token) {
      throw new Error('Switch login succeeded but switch_auth cookie was not returned.');
    }

    return this.token;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.token || !this.adminUserId) {
      await this.login();
    }
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.token) {
      return {};
    }
    return {
      'Cookie': `switch_auth=${this.token}`,
      'Authorization': `Bearer ${this.token}`
    };
  }

  /**
   * Create an internal room for the report and bind the 3 investigation agents.
   */
  public async createRoom(reportCode: string, description: string): Promise<string> {
    await this.ensureAuth();

    const roomPayload = {
      name: `report-${reportCode.toLowerCase()}`,
      description,
      internal_only: false,
      agent_ids: [
        this.agentTriageId,
        this.agentInvestigatorId,
        this.agentAdvisorId
      ]
    };

    let res = await fetch(`${this.apiUrl}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify(roomPayload)
    });

    if (res.status === 401) {
      await this.login();
      res = await fetch(`${this.apiUrl}/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify(roomPayload)
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create Switch room for ${reportCode} (${res.status}): ${errText}`);
    }

    const roomData = (await res.json()) as any;
    const roomId = roomData.id;

    // Add admin user as a chat member so messages can be posted
    if (this.adminUserId) {
      await fetch(`${this.apiUrl}/chats/${roomId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify({ user_id: this.adminUserId })
      }).catch((err) => {
        console.warn(`[SwitchClient] Notice: Adding admin to chat members: ${err?.message}`);
      });
    }

    return roomId;
  }

  /**
   * Send a prompt or notice into a Switch room, optionally mentioning an agent.
   */
  public async sendMessage(
    roomId: string,
    body: string,
    mentionAgentId?: string
  ): Promise<{ messageId: string; seq: number }> {
    await this.ensureAuth();

    const payload: any = {
      body,
      request_id: `verity-${randomUUID()}`
    };

    if (mentionAgentId) {
      payload.mention_agent_id = mentionAgentId;
    }

    let res = await fetch(`${this.apiUrl}/chats/${roomId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 401) {
      await this.login();
      res = await fetch(`${this.apiUrl}/chats/${roomId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to post message to Switch room ${roomId} (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as any;
    const firstMsg = data?.messages?.[0];

    return {
      messageId: firstMsg?.messageId || '',
      seq: firstMsg?.seq ?? 0
    };
  }

  /**
   * Poll for an agent's response to complete, ignoring temporary session bootstrap messages.
   */
  public async waitForAgentResponse(
    roomId: string,
    agentNameFilter: string,
    afterSeq: number,
    timeoutMs: number = 120000,
    pollIntervalMs: number = 2500
  ): Promise<string> {
    await this.ensureAuth();

    const startTime = Date.now();
    const filterLower = agentNameFilter.toLowerCase();

    let targetAgentId = '';
    if (filterLower.includes('triage')) targetAgentId = this.agentTriageId;
    else if (filterLower.includes('investigator')) targetAgentId = this.agentInvestigatorId;
    else if (filterLower.includes('advisor')) targetAgentId = this.agentAdvisorId;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      // 1. Check Switch room activity endpoint (primary store for OpenCode assistant completions)
      try {
        const actRes = await fetch(`${this.apiUrl}/chats/${roomId}/activity`, {
          headers: this.getAuthHeaders()
        });

        if (actRes.ok) {
          const actData = (await actRes.json()) as any;
          const items = Array.isArray(actData?.items) ? actData.items : [];

          for (const item of items) {
            if (item.kind === 'assistant-message' && item.status === 'completed') {
              const matchesAgent = targetAgentId ? item.agentId === targetAgentId : true;
              const occurredTime = item.occurredAt ? new Date(item.occurredAt).getTime() : 0;
              const isRecent = occurredTime >= startTime - 60000;

              if (matchesAgent && isRecent) {
                const text = item.text || '';
                if (text.trim().length > 25) {
                  return text.trim();
                }
              }
            }
          }
        }
      } catch (err: any) {
        // Activity endpoint non-fatal notice
      }

      // 2. Check Switch room messages endpoint (broadcasts and file attachment fallback)
      try {
        const res = await fetch(`${this.apiUrl}/chats/${roomId}/messages?limit=25`, {
          headers: this.getAuthHeaders()
        });

        if (!res.ok) {
          continue;
        }

        const data = (await res.json()) as any;
        const messages: SwitchMessage[] = Array.isArray(data?.messages) ? data.messages : [];

        for (const msg of messages) {
          if (msg.seq > afterSeq) {
            const senderName = msg.sender?.name?.toLowerCase() || '';
            const isTargetAgent = senderName.includes(filterLower) || (Boolean(targetAgentId) && msg.sender?.id === targetAgentId);

            if (isTargetAgent) {
              const body = msg.body || '';
              // Skip temporary loading indicator
              if (body.includes('Starting a session to handle this')) {
                continue;
              }

              // Check if Switch delivered the agent response as a file attachment
              if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
                const textAttachment = msg.attachments.find(
                  (a: any) =>
                    a.mimetype?.includes('text') ||
                    a.mimetype?.includes('markdown') ||
                    a.filename?.endsWith('.md')
                ) || msg.attachments[0];

                if (textAttachment?.uri) {
                  try {
                    const mediaRes = await fetch(
                      `${this.apiUrl}/chats/${roomId}/media?uri=${encodeURIComponent(textAttachment.uri)}`,
                      { headers: this.getAuthHeaders() }
                    );
                    if (mediaRes.ok) {
                      const attachmentContent = await mediaRes.text();
                      if (attachmentContent.trim().length > 25) {
                        return attachmentContent.trim();
                      }
                    }
                  } catch (err: any) {
                    console.warn(`[SwitchClient] Error fetching agent attachment: ${err?.message}`);
                  }
                }
              }

              if (body.trim().length > 25 && !body.includes('delivering as attachment')) {
                return body.trim();
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[SwitchClient] Error polling messages for ${agentNameFilter}: ${err?.message}`);
      }
    }

    throw new Error(
      `Timeout waiting for agent "${agentNameFilter}" response in room ${roomId} after ${Math.round(timeoutMs / 1000)}s.`
    );
  }
}

export const switchClient = new SwitchClient();
