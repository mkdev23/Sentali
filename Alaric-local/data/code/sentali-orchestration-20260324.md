# Sentali Agent Orchestration Framework — MVP Spec

**Date:** 2026-03-25 00:13:30 ET
**Researcher:** Alaric (task executor)
**Domain:** Sentali (AI/Agent Project)
**Status:** COMPLETE

---

## Executive Summary

Defined MVP agent orchestration framework for Sentali project. Specified core architecture: task graph executor, state management, tool registry pattern. Delivered wireframe, data schema, 3-week implementation plan, and acceptance criteria. Written to Sentali/Alaric-local/data/code for team execution.

---

## MVP Architecture Overview

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Orchestrator                     │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Task       │  │  State       │  │   Tool       │  │
│  │   Graph      │◄─┤   Manager    │◄─┤   Registry   │  │
│  │  Executor    │  │   (Redis)    │  │    (API)     │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│          │              │               │                │
│          ▼              ▼               ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Sub-agent  │  │   Memory     │  │   Sandbox    │  │
│  │    (ACPs)    │  │   Storage    │  │   (isolated) │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Data Models

#### Task Graph (JSON Schema)

```typescript
interface Task {
  id: string;           // Unique identifier (TASK-XXXX)
  name: string;         // Human-readable task name
  type: 'task'|'subtask'|'cron'|'heartbeat';
  domain: string;       // Agent capability (code/health/research/)
  status: 'PENDING'|'IN_PROGRESS'|'DONE'|'BLOCKED';
  priority: 'HIGH'|'MEDIUM'|'LOW';
  attempts: number;
  due: Date;
  createdAt: Date;
  parent?: string;      // Parent task ID
  outputs: {
    path: string;       // Output file path
    artifact?: string   // MIME-type content (optional)
  }[];
}

interface TaskGraph {
  vertices: Map<string, Task>;
  edges: Map<string, Task[]>;  // Parent → children
}
```

#### State Manager (Redis JSON)

```json
{
  "namespace": "sentali.orchestration",
  "tasks": {
    "TASK-001": {
      "id": "TASK-001",
      "name": "Daily Health Check",
      "status": "IN_PROGRESS",
      "attempts": 1,
      "due": "2026-03-26T08:00:00Z",
      "outputs": [{ "path": "memory/YYYY-MM-DD.md" }],
      "subagents": ["health-checker"],
      "createdAt": "2026-03-24T19:00:00Z",
      "updatedAt": "2026-03-24T19:05:00Z"
    }
  },
  "aggregatedMetrics": {
    "activeAgents": 4,
    "pendingTasks": 8,
    "completedToday": 3,
    "blockedTasks": 0,
    "totalExecutionTime": "2.4h"
  }
}
```

#### Tool Registry (API Contract)

```typescript
interface Tool {
  id: string;           // e.g., "media-control", "gmail"
  name: string;
  description: string;
  capabilities: string[];
  sandbox: boolean;     // Isolated execution context
  authRequired?: boolean;
}

interface AgentCapabilities {
  taskExecutor: Tool;
  research: Tool[];
  code: Tool[];
  health: Tool[];
  income: Tool[];
}
```

---

## Wireframe: Orchestration Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Cron Heart │────>│   Queue     │────>│   Sub-agent │
│   Beat      │     │    Manager  │     │    Runner    │
└─────────────┘     └─────────────┘     └─────────────┘
                              │
                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Sub-agent │<────│   State     │◄────│   Log Writer│
│   Runner    │     │   Manager   │     └─────────────┘
└─────────────┘     └─────────────┘
```

### Sequence: Task Execution

1. **Cron heartbeat fires** → scans QUEUE for PENDING tasks
2. **Queue Manager** → assigns to sub-agent pool
3. **Sub-agent Runner** → executes via sessions_spawn with runtime="subagent"
4. **State Manager** → marks task IN_PROGRESS, writes outputs to specified paths
5. **Log Writer** → updates push-queue.md and memory/YYYY-MM-DD.md
6. **Queue Manager** → moves task to DONE or BLOCKED
7. **Cron heartbeat** → proceeds to next task

---

## Implementation Plan (3 Weeks)

### Week 1: Foundation

- **Days 1-2:** Set up project directories, wire up State Manager with Redis
- **Days 3-5:** Implement Task Graph executor (task lifecycle, status transitions)
- **Days 6-7:** Wire up tool registry (expose to sub-agents via API)

### Week 2: Core Features

- **Days 1-2:** Sub-agent runner (sessions_spawn with attachAs mount)
- **Days 3-5:** Memory integration (write push-queue.md, memory/YYYY-MM-DD.md)
- **Days 6-7:** Agent capabilities registry (code/research/health/income domains)

### Week 3: Polish & Testing

- **Days 1-2:** End-to-end test (cron → sub-agent → output)
- **Days 3-4:** Add observability (metrics, structured logging)
- **Days 5-6:** Documentation (readme, wireframe examples)
- **Day 7:** Acceptance testing against criteria

---

## Acceptance Criteria

1. **Task Graph Executor Can:**
   - Read/write tasks from JSON/Redis store
   - Track status transitions (PENDING → IN_PROGRESS → DONE/BLOCKED)
   - Execute sub-agents via sessions_spawn with runtime="subagent"
   - Write outputs to specified file paths

2. **State Manager Can:**
   - Persist task states in Redis (JSON store)
   - Provide aggregated metrics (active, pending, completed, blocked)
   - Support sub-agent attachAs mount for output

3. **Tool Registry Can:**
   - List exposed tools (media-control, gmail, etc.)
   - Provide sandbox execution contexts
   - Manage authentication state

4. **Memory Integration Can:**
   - Append to push-queue.md with proper timestamp/medium tags
   - Append to memory/YYYY-MM-DD.md with [HH:MM] timestamps
   - Track task completion counts

---

## Acceptance: Tasks in TASKS.md

| Task ID | Name | Expected Behavior |
|------|---|---|
| TASK-001 | Cron Heartbeat Scan | Heartbeat fires → scans TASKS.md for PENDING tasks |
| TASK-002 | Sub-agent Spawn | Spawn with runtime="subagent", cwd=workspace, tool access |
| TASK-003 | Output Write | Sub-agent writes to specified Output field paths |
| TASK-004 | Queue Update | Update TASKS.md status → DONE/BLOCKED |

---

## Notes & Dependencies

- **Sessions Spawn:** Use sessions_spawn with runtime="subagent", cleanup="delete" or "keep"
- **Redis:** External store for state persistence (consider embedded Redis)
- **Memory Files:** Local file system integration for push-queue.md and memory/YYYY-MM-DD.md
- **Task Queue:** Use JSON file or Redis store for queue persistence
- **Tool Access:** Sub-agents inherit parent workspace tool access

---

**End of Orchestration Spec — TASK-052**