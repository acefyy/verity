import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SwitchClient } from '../src/switch/switchClient.js';

describe('Switch Platform Client Specifications', () => {
  test('initializes with default or custom configuration', () => {
    const client = new SwitchClient({
      apiUrl: 'http://localhost:58014/gateway',
      adminEmail: 'test-admin@switch.local',
      adminPassword: 'secretpassword',
      agentTriageId: 'triage-id-123',
      agentInvestigatorId: 'investigator-id-456',
      agentAdvisorId: 'advisor-id-789'
    });

    assert.equal(client.agentTriageId, 'triage-id-123');
    assert.equal(client.agentInvestigatorId, 'investigator-id-456');
    assert.equal(client.agentAdvisorId, 'advisor-id-789');
  });

  test('successfully authenticates and parses auth cookie from response', async () => {
    const mockJwt = 'mock.jwt.token.string';
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (url: any, opts: any) => {
        if (String(url).endsWith('/auth/login')) {
          assert.equal(opts.method, 'POST');
          const body = JSON.parse(opts.body);
          assert.equal(body.email, 'admin@switch.local');

          return new Response(JSON.stringify({ id: 'admin-user-uuid', role: 'admin' }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': `switch_auth=${mockJwt}; Path=/; HttpOnly;`
            }
          });
        }
        return new Response('Not found', { status: 404 });
      };

      const client = new SwitchClient({
        apiUrl: 'http://mock-switch:58014/gateway',
        adminEmail: 'admin@switch.local',
        adminPassword: 'pass'
      });

      const token = await client.login();
      assert.equal(token, mockJwt);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('creates room with 3 required agent IDs and internal_only flag', async () => {
    const originalFetch = globalThis.fetch;

    try {
      let roomCreated = false;
      let memberAdded = false;

      globalThis.fetch = async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/auth/login')) {
          return new Response(JSON.stringify({ id: 'admin-123' }), {
            status: 200,
            headers: {
              'Set-Cookie': 'switch_auth=token123;'
            }
          });
        }

        if (urlStr.endsWith('/rooms')) {
          assert.equal(opts.method, 'POST');
          const body = JSON.parse(opts.body);
          assert.equal(body.name, 'report-v-001');
          assert.equal(body.internal_only, false);
          assert.deepEqual(body.agent_ids, ['triage-1', 'inv-2', 'adv-3']);
          assert.ok(opts.headers.Cookie.includes('switch_auth=token123'));
          roomCreated = true;
          return new Response(JSON.stringify({ id: 'room-uuid-xyz' }), { status: 201 });
        }

        if (urlStr.includes('/chats/room-uuid-xyz/members')) {
          assert.equal(opts.method, 'POST');
          const body = JSON.parse(opts.body);
          assert.equal(body.user_id, 'admin-123');
          memberAdded = true;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        return new Response('Not found', { status: 404 });
      };

      const client = new SwitchClient({
        apiUrl: 'http://mock-switch:58014/gateway',
        agentTriageId: 'triage-1',
        agentInvestigatorId: 'inv-2',
        agentAdvisorId: 'adv-3'
      });

      const roomId = await client.createRoom('V-001', 'Test room');
      assert.equal(roomId, 'room-uuid-xyz');
      assert.ok(roomCreated);
      assert.ok(memberAdded);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('posts message with mention_agent_id and request_id', async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/auth/login')) {
          return new Response(JSON.stringify({ id: 'admin-123' }), {
            status: 200,
            headers: { 'Set-Cookie': 'switch_auth=token123;' }
          });
        }

        if (urlStr.includes('/chats/room-abc/messages')) {
          assert.equal(opts.method, 'POST');
          const body = JSON.parse(opts.body);
          assert.equal(body.body, '@report-triage Please triage this case.');
          assert.equal(body.mention_agent_id, 'agent-triage-id');
          assert.ok(body.request_id.startsWith('verity-'));

          return new Response(
            JSON.stringify({
              messages: [{ messageId: 'msg-001', seq: 42 }]
            }),
            { status: 200 }
          );
        }

        return new Response('Not found', { status: 404 });
      };

      const client = new SwitchClient({ apiUrl: 'http://mock-switch:58014/gateway' });
      const result = await client.sendMessage(
        'room-abc',
        '@report-triage Please triage this case.',
        'agent-triage-id'
      );

      assert.equal(result.messageId, 'msg-001');
      assert.equal(result.seq, 42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
