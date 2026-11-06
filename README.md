# Verity: AI-Assisted Discord Moderation & Investigation Workflow

Verity transforms Discord community moderation from chaotic, reactive policing into a structured, auditable business case management workflow powered by **Switch**.

Submitted to the **Flip the Switch Hackathon** (Track 01: Best Business Workflow).

---

## Overview

Community moderation in Discord has historically been an exhausting, inconsistent, and unstructured manual chore. Volunteer moderators are inundated with vague user reports, conflicting claims, tampered screenshots, and repetitive offender queries. At the same time, automated moderation bots that ban users without human review destroy member trust and introduce serious security risks.

**Verity** solves this by establishing a disciplined business case management pipeline. When a member reports a message, Verity captures the incident through secure Discord Components V2 modals, cryptographically verifies evidence in memory, provisions an isolated case room in **Switch**, coordinates a 3-agent investigation pipeline (Triage, Forensics, and Advisor), and delivers actionable findings directly to human moderators. Crucially, AI agents never enforce punishments autonomously: human moderators retain sole authority via interactive action modals, role-hierarchy checks, and pre-action DM warnings, with all final decisions logged back to Switch and recorded in persistent SQLite case files.

---

## How Switch is Used

Switch serves as the central operational backbone and multi-agent coordination layer for Verity, rather than a mere chat interface:

1. **Per-Case Room Isolation (`POST /rooms`):** For every report, Verity automatically provisions an isolated Switch room named `report-<code\>` (e.g. `report-v-001`). This ensures complete context separation so evidence and member data cannot leak between investigations.
2. **OpenCode Multi-Agent Network:** Verity binds three specialized OpenCode AI agents to each case room:
   - **Report Triage (`report-triage`):** Rapidly categorizes the violation, assesses urgency, checks for data-quality flags, and evaluates immediate safety needs.
   - **Report Investigator (`report-investigator`):** Conducts forensic verification of target message timestamps (snowflake analysis), preceding channel conversation context, and attached binary evidence.
   - **Moderation Advisor (`moderation-advisor`):** Synthesizes prior milestones, evaluates server rules and past disciplinary history, and recommends proportional action (Dismiss, Warn, Timeout/Mute, Kick, or Ban).
3. **Sequential Pipeline Orchestration:** The orchestrator feeds structured case briefs into Switch, mentions agents sequentially, and enforces concise `**TL;DR:**` summaries and bulleted findings.
4. **Dual-Mode Response Polling:** The Switch client listens for agent completions via the `/chats/{roomId}/activity` assistant completion stream while maintaining a robust fallback on `/chats/{roomId}/messages` with media attachment decoding.
5. **Interactive Thread Q&A Forwarding:** When a human moderator asks follow-up questions in the Discord thread (e.g., tagging `@investigator` or `@advisor`), Verity injects the question and case history into the Switch room and returns the agent's explanation in place.
6. **Closed-Loop Resolution Synchronization:** When a human moderator executes a moderation action, the official resolution outcome, moderator ID, and reason are synchronized back to the Switch room, leaving an immutable audit trail across both platforms.

---

## System Architecture

```
[ Discord User ]
       │
       │ Right-click Message -> Apps -> "Report Message"
       ▼
[ Intake Gateway ]
  ├── 1. Creates 15-minute cryptographic session (SQLite WAL)
  ├── 2. Opens Discord Components V2 modal (Reason + File Upload)
  ├── 3. Enforces Require Evidence server policy (Required vs Optional)
  ├── 4. Validates magic bytes (PNG/JPEG/WebP/PDF) & hashes SHA-256 in memory
  └── 5. Re-uploads files to Discord CDN (zero permanent local binary disk storage)
       │
       ▼
[ Discord #reports Channel ]
  ├── Neutral Components V2 Container (Flags: 32768, Type 17)
  └── Dedicated Investigation Thread created automatically
       │
       ▼
[ Verity Orchestrator ]
  ├── 1. POST /gateway/rooms -> Provisions isolated room in Switch
  ├── 2. Binds 3 agents: report-triage, report-investigator, moderation-advisor
  └── 3. Coordinates multi-phase investigation:
       │
       ├── Phase 1: @report-triage
       │     └── Discord thread live progress -> Edits in place with Triage TL;DR
       │
       ├── Phase 2: @report-investigator
       │     └── Discord thread live progress -> Edits in place with Forensics TL;DR
       │
       └── Phase 3: @moderation-advisor
             └── Discord thread live progress -> Edits in place with Recommendation
                   + 2 Interactive Action Buttons: [Take Action] [Dismiss Report]
       │
       ▼
[ Human Moderator Decision ]
  ├── Verifies moderator server permissions (ManageMessages / Moderate / Kick / Ban)
  ├── Verifies Discord role hierarchy (Moderator > Target, Bot > Target)
  ├── If "Take Action": Opens modal for Punishment choice, Duration, Reason, optional Notes
  ├── If "Dismiss Report": Executes dismissal resolution workflow
  ├── Dispatches Pre-Action DM notice to target member
  ├── Executes Discord moderation action via API (Timeout, Kick, Ban, Warn)
  ├── Updates Discord action container in place to Emerald Green (0x22C55E)
  ├── Sends formatted audit log to Action Log Channel (if configured)
  └── Synchronizes resolution and reason back to Switch room chat
```

---

## Core Capabilities

### 1. Robust Intake Security & Zero-Storage Evidence
- **Cryptographic Intake Sessions:** Every context-menu invocation generates an atomic session token bound to the reporter, guild, channel, target message, and reported member ID. Replays, expired tokens, and forged origins are strictly rejected.
- **In-Memory Magic Byte Validation:** Uploaded proof files are validated via true binary signatures (PNG, JPEG, WebP, PDF), rejecting spoofed extensions or manipulated MIME types.
- **Zero Disk Persistence:** File buffers are validated in memory and re-uploaded directly to Discord via native File components. No user binaries or sensitive images are stored on host disk.

### 2. Deep Switch Multi-Agent Orchestration
- **Isolated Case Rooms:** Every report spins up a dedicated Switch room populated exclusively by the report's assigned investigation agents, preventing cross-report data leakage.
- **Sequential Agent Pipeline:** Triage sets urgency and identifies gaps; Investigator verifies facts, checks snowflake timestamps, and audits channel context; Advisor synthesizes findings with past violation records.
- **Structured Briefing:** The orchestrator feeds target message content, preceding channel context, past violation records, and cryptographic attachment checksums into the room.

### 3. Modern Discord Components V2 UI
- **Pure Components V2 Architecture:** Built with `flags: 32768`, using Container components (`type: 17`), Text Display components (`type: 10`), Separators (`type: 14`), Action Rows (`type: 1`), and Labels (`type: 18`).
- **Clean Aesthetic:** Adheres strictly to Discord design specifications. Containers remain neutral by default, reserving accent colors solely for meaningful alerts: Crimson Red (`0xEF4444`) for errors and Emerald Green (`0x22C55E`) for resolved outcomes.
- **In-Place Live Updates:** When an agent begins work, Verity posts a live progress container (`⏳ @agent is working...`) and edits it in place to the final findings upon completion.
- **In-Place Case Resolution:** Once authorized by a moderator, the Phase 3 container is updated in place to a resolution badge, removing action buttons and displaying who authorized the action, what action was taken, and the official reason.

### 4. Human-in-the-Loop Governance & Safety Checks
- **Zero Agent Autonomy for Punishments:** AI agents advise; human moderators decide. Agents cannot kick, ban, or timeout members.
- **Role Hierarchy Enforcement:** Ensures neither the moderator nor the bot can act against a user with equal or higher role position, preventing privilege escalation conflicts.
- **Two-Tier Discord Permission Verification:** Validates server-side that the clicking moderator possesses the required native Discord permissions (`ModerateMembers`, `KickMembers`, `BanMembers`, `ManageMessages`).
- **Configurable Evidence Policy (`/settings`):** When enabled, users submitting reports against members must provide proof files (screenshots or documents); submissions lacking valid evidence are rejected at intake. Evidence is never required from moderators taking moderation actions.

### 5. Streamlined "Take Action" Modal & Execution
- **Comprehensive Decision Modal:** Clicking **Take Action** on the Phase 3 container opens an interactive modal with:
  - **Punishment Selection:** Native String Select menu to choose Warn, Mute/Timeout, Kick, or Ban.
  - **Duration:** Input for timeout duration (`10m`, `1h`, `24h`, `7d`, max 28d) parsed and validated via `parseDuration`.
  - **Reason:** Pre-filled with the report reason, editable for official moderation records.
  - **Notes / Context:** Optional input for moderator records (evidence is never required from moderators).
- **One-Click Dismissal:** Clicking **Dismiss Report** verifies permissions, closes the case, logs the dismissal, and updates the container in place without sending extraneous messages.

### 6. Interactive Agent Q&A in Discord Threads
- **Direct Thread Mentions:** Moderators can ask clarifying questions directly inside the Discord report thread using `@investigator`, `@triage`, `@advisor`, or bot mentions.
- **Dynamic Switch Room Routing:** Questions are forwarded to the report's Switch room, answered by the targeted agent, and rendered with real-time progress indicators.
- **Milestone Persistence:** Follow-up questions and agent explanations are stored in SQLite and displayed in the thread timeline.

### 7. Pre-Action Member Notifications
- **Fair Notice Delivery:** Target members receive an official DM detailing the alleged violation, server name, and moderator reason before punitive actions (Timeout, Kick, Ban, Warn) take effect.
- **Closed DM Resilience:** If a target member has DMs disabled, the system catches the error gracefully, proceeds with the moderation action, and records the delivery state in the audit log.

### 8. Recidivism Tracking & Disciplinary History
- **Recidivism Tracking:** The investigation brief automatically injects the user's past disciplinary history from SQLite, giving Switch agents full context on repeat offenses.
- **Automated Case Code Generation:** Unique sequential report codes (`V-001`, `V-002`, etc.) and internal UUIDs are automatically assigned, tracked, and retrieved by Verity without manual user entry.

---

## Switch Agent Specifications

Verity utilizes three specialized agents configured in the Switch workspace:

| Agent Name | Switch Identifier | Primary Responsibility |
| :--- | :--- | :--- |
| **Report Triage** | `report-triage` | Analyzes initial report claims, assigns urgency level, and categorizes violation type against server rules. |
| **Report Investigator** | `report-investigator` | Evaluates message content, reviews preceding conversation context, cross-references evidence files, and identifies unsubstantiated claims. |
| **Moderation Advisor** | `moderation-advisor` | Synthesizes triage and forensics, evaluates mitigating or aggravating circumstances, and recommends a specific, proportionate moderation action. |

---

## Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Language & Runtime** | Node.js (v20+), TypeScript (ESM) | Type-safe, concurrent async execution across Discord and Switch APIs. |
| **Multi-Agent Platform** | Switch AI Gateway REST API | Isolated room provisioning, agent communication, and completion streaming. |
| **Agents** | OpenCode Multi-Agent Network | Specialized autonomous triage, forensic evidence, and advisory agents. |
| **Chat Platform** | Discord.js (v14.17+), Components V2 | Context menus, modals, containers, channel selects, checkboxes, buttons. |
| **Database** | Node SQLite (`node:sqlite` WAL mode) | High-performance atomic storage for intake sessions, reports, settings, and logs. |
| **Security & Forensics** | Node Crypto (`node:crypto`) | SHA-256 binary hashing, session UUID tokens, and magic byte detection. |
| **Testing** | Node Native Test Runner (`node:test`, `node:assert`) | 49 automated tests covering intake security, parsers, containers, and client flows. |

---

## Project Structure

```
verity/
├── src/
│   ├── index.ts                                # Application entry point & crash resilience
│   ├── config.ts                               # Environment configuration and validation
│   ├── db/
│   │   ├── database.ts                         # SQLite WAL repository (Sessions, Reports, Settings, Milestones)
│   │   └── schema.ts                           # Database table definitions and indices
│   ├── discord/
│   │   ├── client.ts                           # Discord client setup & interaction routing
│   │   ├── registerCommands.ts                 # Slash and context menu command registration
│   │   ├── commands/
│   │   │   ├── reportCommand.ts                # "Report Message" context menu definition
│   │   │   └── settingsCommand.ts              # "/settings" slash command definition
│   │   ├── components/
│   │   │   ├── modalBuilder.ts                 # 2-field Components V2 report modal
│   │   │   ├── settingsModalBuilder.ts         # Settings modal & Take Action modal builder
│   │   │   ├── actionLogContainerBuilder.ts    # Moderation action audit log container
│   │   │   ├── reportContainerBuilder.ts       # #reports neutral container & thread initial message
│   │   │   └── investigationContainerBuilder.ts # Live progress, phase findings & resolution containers
│   │   └── interactions/
│   │       ├── contextMenuHandler.ts           # Intake session initialization & modal display
│   │       ├── modalSubmitHandler.ts           # Modal ingestion, validation, thread creation & dispatch
│   │       ├── modalParsers.ts                 # Channel Select, Checkbox and input extraction helpers
│   │       ├── settingsHandler.ts              # /settings command and settings modal submission handler
│   │       ├── actionButtonHandler.ts          # Moderator authorization, role hierarchy & action triggers
│   │       ├── actionExecution.ts              # Resolution execution, container edits & action logging
│   │       └── threadQAHandler.ts              # Interactive moderator thread Q&A with Switch agents
│   ├── evidence/
│   │   └── validator.ts                        # Magic byte inspection, SHA-256 & memory buffers
│   ├── investigation/
│   │   └── orchestrator.ts                     # Switch room lifecycle & 3-phase handoff coordinator
│   └── switch/
│       └── switchClient.ts                     # Switch Gateway REST client & polling manager
├── test/
│   ├── actionButtonHandler.test.ts             # Moderator authorization & resolution persistence
│   ├── componentsV2.test.ts                    # Components V2 payload layout & styling
│   ├── enhancedFeatures.test.ts                # Thread Q&A, in-place resolution & disciplinary history
│   ├── evidenceValidator.test.ts               # Magic byte checks, file bounds & path traversal safety
│   ├── intakeFlowE2E.test.ts                   # Full end-to-end report lifecycle simulation
│   ├── intakeSession.test.ts                   # Intake session creation, replay prevention & TTL
│   ├── investigationContainers.test.ts         # Agent containers, 2 buttons & resolution styling
│   ├── settingsWorkflow.test.ts                # Settings modal, channel selectors, checkboxes & logs
│   ├── switchClient.test.ts                    # Switch authentication, room provisioning & messaging
│   └── takeActionWorkflow.test.ts              # Take Action modal, duration parsing & evidence states
├── .env.example                                # Sample environment configuration
├── package.json                                # Project dependencies and scripts
└── tsconfig.json                               # TypeScript compiler configuration
```

---

## Getting Started

### Prerequisites

1. **Node.js:** v20.x or higher (tested on Node v22 and v24).
2. **Discord Bot Application:**
   - Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
   - Under **OAuth2**: select `bot` and `applications.commands` scopes.
   - Under **Privileged Gateway Intents**: enable `Guild Messages` and `Message Content`.
   - Bot permissions required: `Manage Messages`, `Moderate Members`, `Kick Members`, `Ban Members`, `Send Messages`, `Create Public Threads`, `Attach Files`.
3. **Switch AI Gateway:**
   - A running Switch Gateway instance (e.g. `http://localhost:58014/gateway`).
   - Three agents registered with their IDs (`report-triage`, `report-investigator`, `moderation-advisor`).

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/acefyy/verity.git
cd verity
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Populate the configuration values:

```ini
# Discord Bot Credentials
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id_here
DISCORD_GUILD_ID=your_testing_guild_id_here
# (Optional) Fallback Reports Channel ID if not configured via /settings
DISCORD_REPORTS_CHANNEL_ID=your_reports_channel_id_here

# Database Configuration
DATABASE_PATH=./verity.db

# Switch Gateway & Agent Credentials
SWITCH_API_URL=http://localhost:58014/gateway
SWITCH_ADMIN_EMAIL=admin@switch.local
SWITCH_ADMIN_PASSWORD=your_admin_password
SWITCH_AGENT_TRIAGE_ID=7839ce54-ba74-4ccf-89d3-dd56412ff843
SWITCH_AGENT_INVESTIGATOR_ID=9f7e0e8f-c00b-4734-b25d-473b06513c10
SWITCH_AGENT_ADVISOR_ID=9646eee2-cea5-436e-9aba-8a3a2040b1d7
```

> **Note on Report ID & Channel Handling:** Report IDs (`V-001`, `V-002`, etc.) and internal UUIDs are generated, indexed, and retrieved completely automatically from SQLite. No manual report ID configuration or entry is required. The reports channel is dynamically resolved via `/settings`, server channel auto-discovery (`#reports`), or optional environment fallback.

### 3. Run Automated Tests

Verity includes an extensive suite of 49 automated tests covering database operations, cryptographic intake sessions, magic byte validation, Switch REST client calls, Discord Components V2 formatting, server settings workflows, interactive thread Q&A, and Take Action modal execution:

```bash
npm test
```

Expected output:
```
ℹ tests 49
ℹ suites 10
ℹ pass 49
ℹ fail 0
```

### 4. Start the Application

Start in development mode (hot reload):

```bash
npm run dev
```

Or start for production:

```bash
npm start
```

Upon startup, Verity registers the `Report Message` context-menu command and `/settings` slash command with Discord, verifies Switch gateway connectivity, and resumes any pending investigations if recovering from an interruption.

---

## Verifying the Workflow in Discord

1. **Configure Server Governance (`/settings`):**
   - Run `/settings` in any server channel to open the configuration modal.
   - Select the designated **Report Channel** where reports and investigation threads will be routed.
   - (Optional) Select an **Action Log Channel** for moderation audit logs.
   - Toggle **Require Evidence** to control whether users submitting reports must attach proof files.
2. **Submit a Report (`Report Message`):**
   - Right-click any message in a server channel -> **Apps** -> **Report Message**.
   - Enter a detailed reason (15 to 1,000 characters) explaining the server rule violated.
   - Attach proof files (PNG, JPEG, WebP, PDF) as required by server settings.
3. **Automated Multi-Agent Review in Discord Thread:**
   - Verity posts the report container to the reports channel and opens a dedicated investigation thread.
   - Watch the thread as Switch orchestrates the 3 phases in real time:
     - Live progress container announces active agent work (`⏳ @agent is working...`).
     - Phase 1 delivers Triage assessment and urgency rating.
     - Phase 2 delivers Evidence Forensics and snowflake timestamp verification.
     - Phase 3 delivers Moderation Advisor recommendation with action buttons.
4. **Interactive Moderator Q&A:**
   - Moderators can ask questions in the thread (e.g. `"@investigator what were the preceding messages?"` or `"@advisor why not a kick?"`).
   - The targeted Switch agent formulates an answer and delivers it directly into the thread.
5. **Human Moderator Authorization (`Take Action` / `Dismiss Report`):**
   - Clicking **Take Action** opens the moderation modal:
     - Select punishment: Warn, Mute/Timeout, Kick, or Ban.
     - Set duration for timeouts (e.g. `10m`, `1h`, `24h`, `7d`).
     - Edit or confirm the official moderation reason.
     - (Optional) Provide additional context or proof notes for records.
   - Clicking **Dismiss Report** executes the standard dismissal workflow.
6. **Execution & In-Place Resolution:**
   - Verity enforces moderator permissions and role hierarchy, executes the action via Discord API, sends a pre-action DM to the target member, logs the event to the action log channel, and updates the thread container in place to Emerald Green (`#22C55E`).

---

## Hackathon Evaluation Alignment

| Judging Pillar | How Verity Meets & Exceeds Criteria |
| :--- | :--- |
| **Use of Switch** | Switch is central to the entire operational loop: isolated per-report room creation (`report-<code\>`), multi-agent phased pipeline handoff, activity stream completion polling, live thread Q&A routing, and closed-loop resolution synchronization. |
| **Technical Execution** | 49 passing unit and integration tests across 10 test suites; robust error handling; in-memory binary magic byte validation; zero disk binary persistence; cryptographic anti-replay intake sessions; SQLite WAL concurrency; TypeScript strict typing. |
| **Creativity & Impact** | Directly targets community moderator burnout and arbitrary enforcement. Replaces chaotic manual moderation with a professional, auditable business case workflow while guaranteeing that AI agents never possess autonomous punishment powers. |
| **Presentation & Polish** | Pure Discord Components V2 implementation with neutral container layouts, meaningful alert accents (Crimson Red / Emerald Green), in-place message editing, and full setup guide. |

---

## License

MIT
