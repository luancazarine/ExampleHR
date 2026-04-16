# Technical Requirements Document: ExampleHR Leave Microservice

**Version:** 1.0  
**Date:** 2026-04-16  
**Author:** Engineering Team  
**Status:** Approved

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Core Challenges](#3-core-challenges)
4. [Solution Design](#4-solution-design)
5. [Data Model](#5-data-model)
6. [API Specification](#6-api-specification)
7. [Business Logic and State Machine](#7-business-logic-and-state-machine)
8. [Synchronization Strategy](#8-synchronization-strategy)
9. [Error Handling and Resilience](#9-error-handling-and-resilience)
10. [Alternatives Considered](#10-alternatives-considered)
11. [Technology Stack](#11-technology-stack)
12. [Testing Strategy](#12-testing-strategy)
13. [Non-Functional Requirements](#13-non-functional-requirements)
14. [Glossary](#14-glossary)

---

## 1. Executive Summary

The ExampleHR Leave Microservice manages the lifecycle of employee leave requests while maintaining balance integrity between ExampleHR (the employee-facing UI) and an external Human Capital Management (HCM) system (e.g., Workday, SAP). The HCM is the **source of truth** for employment data and leave balances. This service provides fast, accurate feedback to employees and managers while guaranteeing that no leave is granted without HCM confirmation.

---

## 2. Problem Statement

### Context

ExampleHR serves as the primary interface for employees to request time off. However, the underlying leave balance data lives in the HCM system. This creates a distributed data ownership problem:

- **Employees** expect to see an accurate balance and get instant feedback when submitting a request.
- **Managers** need confidence that an approved request reflects real, available balance.
- **The HCM** independently modifies balances (e.g., anniversary bonuses, annual accruals, corrections) without notifying ExampleHR in real time.

### The Core Problem

Keeping leave balances synchronized between ExampleHR and the HCM is inherently difficult because:

1. Two systems can modify the same conceptual data (leave balance) independently.
2. The HCM is authoritative but not always available or fast enough for interactive UX.
3. The HCM's validation of absence registrations is not 100% reliable—it may occasionally accept invalid requests.

Without careful design, the system risks **overdrawing leave** (granting more days than available), **showing stale data** (employee sees an incorrect balance), or **losing requests** (failures during HCM communication go unhandled).

---

## 3. Core Challenges

### 3.1 Dual-Write Problem

When a leave request is approved, the balance must be decremented in both ExampleHR (for immediate UX feedback) and the HCM (as the source of truth). If one write succeeds and the other fails, the systems diverge. Classic distributed transaction solutions (2PC) are impractical with third-party HCM APIs.

### 3.2 Stale Local Cache

ExampleHR maintains a local cache of balances for fast reads. This cache becomes stale when the HCM independently modifies balances:

- **Anniversary bonuses**: An employee's 5-year anniversary adds 2 extra vacation days.
- **Annual accrual**: At the start of a fiscal year, all balances reset or increment.
- **Manual corrections**: HR administrators adjust balances directly in the HCM.

A stale cache can lead to incorrect approval decisions or misleading balance displays.

### 3.3 HCM Unreliability

The HCM API may not always reliably reject invalid absence registrations. Per the product requirements, *"we can count on the HCM to return errors... however, this cannot always be guaranteed."* This means ExampleHR must implement its own validation as a safety net, while still deferring to HCM as the final authority.

### 3.4 Concurrency

Two simultaneous leave requests from the same employee (e.g., submitted from two browser tabs) could both pass the balance check if the check-then-deduct operation is not atomic. Without proper locking, this leads to overdrawing.

### 3.5 Batch vs. Real-Time Reconciliation

The HCM provides two sync mechanisms:

- **Real-time API**: Query or update a single employee's balance on demand.
- **Batch endpoint**: Pushes the complete set of balances periodically.

The system must reconcile batch updates (which overwrite cached data) with in-flight leave requests that have already reserved balance locally but are not yet confirmed in the HCM.

---

## 4. Solution Design

### 4.1 High-Level Architecture

The microservice follows the **Reserve-then-Confirm** pattern, treating local balance data as a performant cache with optimistic reservations, and requiring HCM confirmation before finalizing any leave deduction.

```
┌──────────────┐     ┌────────────────────┐     ┌──────────────┐
│   Employee   │────>│  ExampleHR Leave   │────>│   HCM System │
│   / Manager  │<────│   Microservice     │<────│  (Workday/   │
│   (Client)   │     │                    │     │   SAP)       │
└──────────────┘     └────────────────────┘     └──────────────┘
                            │
                            v
                     ┌──────────────┐
                     │   SQLite DB  │
                     │ (Local Cache │
                     │  + Requests) │
                     └──────────────┘
```

### 4.2 Request Lifecycle Flow

```
Employee submits leave request
  │
  ├─> [1] Local validation: check cached balance (fast)
  │     └─> If insufficient → REJECT immediately (no HCM call)
  │
  ├─> [2] Reserve locally: reservedDays += requestedDays (atomic transaction)
  │     └─> Status: PENDING
  │
  ├─> [3] Manager reviews and approves
  │     └─> Status: APPROVED
  │
  ├─> [4] Register absence in HCM via real-time API
  │     ├─> HCM confirms → Status: CONFIRMED_BY_HCM
  │     │     └─> Move days from reservedDays to usedDays
  │     ├─> HCM rejects → Status: HCM_REJECTED
  │     │     └─> Release reservedDays, notify employee
  │     └─> HCM timeout → Status: PENDING_HCM_CONFIRMATION
  │           └─> Retry via background job
  │
  └─> [5] Employee can cancel at any stage
        └─> Release reservation, notify HCM if already registered
```

### 4.3 Key Design Decisions

1. **Local cache as "soft check"**: The cached balance provides instant feedback to employees but is never trusted as the sole authority for approval. It serves as a first-pass filter to avoid unnecessary HCM calls for clearly invalid requests.

2. **HCM as final arbiter**: Every approved leave request must be confirmed by the HCM. The system does not consider a leave deduction finalized until HCM returns a success response.

3. **Pessimistic local validation**: Even though the HCM validates, ExampleHR also validates locally. This is the "be cautious" approach mentioned in requirements—we don't solely rely on HCM rejection.

4. **Reservation mechanism**: The `reservedDays` field acts as an optimistic lock. When a request is created, the days are "reserved" (subtracted from available balance) before manager approval. This prevents concurrent over-allocation.

5. **Periodic reconciliation**: Batch syncs from HCM overwrite cached `totalDays`. The system recalculates `usedDays` from confirmed requests to detect and log discrepancies.

### 4.4 Balance Calculation

At any point, the available balance is:

```
availableDays = totalDays - usedDays - reservedDays
```

Where:
- `totalDays`: Last known entitlement from HCM (updated via sync or real-time refresh)
- `usedDays`: Sum of days from requests in CONFIRMED_BY_HCM status
- `reservedDays`: Sum of days from requests in PENDING or APPROVED status (not yet confirmed by HCM)

---

## 5. Data Model

### 5.1 Entity Relationship

```
Employee 1──* LeaveBalance (per location, per leave type)
Employee 1──* LeaveRequest
```

### 5.2 Entities

#### Employee

| Field      | Type   | Description                    |
|------------|--------|--------------------------------|
| id         | String | Primary key (from HCM)         |
| name       | String | Full name                      |
| email      | String | Email address                  |
| locationId | String | Primary work location          |

#### LeaveBalance

| Field        | Type     | Description                                       |
|--------------|----------|---------------------------------------------------|
| id           | UUID     | Primary key                                       |
| employeeId   | String   | FK to Employee                                    |
| locationId   | String   | Location for this balance                         |
| leaveType    | String   | VACATION, SICK, PERSONAL, etc.                    |
| totalDays    | Float    | Total entitlement (from HCM)                      |
| usedDays     | Float    | Days consumed (confirmed by HCM)                  |
| reservedDays | Float    | Days reserved by pending/approved requests        |
| lastSyncedAt | DateTime | Last time this balance was synced from HCM        |

**Unique constraint**: (employeeId, locationId, leaveType)

#### LeaveRequest

| Field        | Type     | Description                                    |
|--------------|----------|------------------------------------------------|
| id           | UUID     | Primary key                                    |
| employeeId   | String   | FK to Employee                                 |
| locationId   | String   | Location for this request                      |
| leaveType    | String   | Type of leave                                  |
| startDate    | DateTime | First day of leave                             |
| endDate      | DateTime | Last day of leave                              |
| days         | Float    | Number of leave days                           |
| status       | String   | Current status (see state machine)             |
| hcmReference | String   | Reference ID from HCM after registration       |
| reason       | String   | Employee's reason for leave                    |
| reviewedBy   | String   | Manager who approved/rejected                  |
| createdAt    | DateTime | Creation timestamp                             |
| updatedAt    | DateTime | Last update timestamp                          |

#### SyncLog

| Field     | Type     | Description                        |
|-----------|----------|------------------------------------|
| id        | UUID     | Primary key                        |
| syncType  | String   | BATCH or REAL_TIME                 |
| status    | String   | SUCCESS, PARTIAL, FAILED           |
| details   | String   | JSON details of sync operation     |
| createdAt | DateTime | Timestamp                          |

---

## 6. API Specification

### 6.1 Leave Balances

#### GET /leave-balances/:employeeId

Returns all cached balances for an employee across locations and leave types.

**Response 200:**
```json
{
  "employeeId": "EMP001",
  "balances": [
    {
      "id": "uuid",
      "locationId": "LOC_US",
      "leaveType": "VACATION",
      "totalDays": 20,
      "usedDays": 5,
      "reservedDays": 2,
      "availableDays": 13,
      "lastSyncedAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

#### GET /leave-balances/:employeeId/refresh

Forces a real-time refresh from HCM, updates local cache, and returns updated balances.

**Response 200:** Same as above, with updated `lastSyncedAt`.

#### POST /leave-balances/sync

Triggers a batch sync from HCM. Typically called by a cron job or admin.

**Response 200:**
```json
{
  "syncId": "uuid",
  "status": "SUCCESS",
  "recordsProcessed": 150,
  "discrepancies": 3
}
```

#### POST /leave-balances/webhook

Receives batch balance data pushed by HCM.

**Request Body:**
```json
{
  "balances": [
    {
      "employeeId": "EMP001",
      "locationId": "LOC_US",
      "leaveType": "VACATION",
      "totalDays": 22
    }
  ]
}
```

**Response 200:**
```json
{
  "syncId": "uuid",
  "status": "SUCCESS",
  "recordsProcessed": 1
}
```

### 6.2 Leave Requests

#### POST /leave-requests

Creates a new leave request. Validates balance and reserves days atomically.

**Request Body:**
```json
{
  "employeeId": "EMP001",
  "locationId": "LOC_US",
  "leaveType": "VACATION",
  "startDate": "2026-05-01",
  "endDate": "2026-05-02",
  "days": 2,
  "reason": "Family vacation"
}
```

**Response 201:** The created LeaveRequest object with status PENDING.

**Response 400:** Insufficient balance or invalid data.

#### GET /leave-requests/:id

Returns a single leave request by ID.

#### GET /leave-requests/employee/:employeeId

Returns all leave requests for an employee, optionally filtered by status.

**Query Parameters:** `status` (optional)

#### PATCH /leave-requests/:id/approve

Manager approves the request. Triggers HCM absence registration.

**Request Body:**
```json
{
  "reviewedBy": "MGR001"
}
```

**Response 200:** Updated request with status APPROVED or CONFIRMED_BY_HCM.

#### PATCH /leave-requests/:id/reject

Manager rejects the request. Releases reserved days.

**Request Body:**
```json
{
  "reviewedBy": "MGR001",
  "reason": "Team coverage insufficient"
}
```

**Response 200:** Updated request with status REJECTED.

#### PATCH /leave-requests/:id/cancel

Cancels a request. Releases reserved/used days and notifies HCM if applicable.

**Response 200:** Updated request with status CANCELLED.

### 6.3 Admin/Health

#### GET /health

Health check endpoint.

#### GET /sync-logs

Returns recent sync operation logs.

---

## 7. Business Logic and State Machine

### 7.1 Leave Request States

```
                          ┌──────────────┐
                     ┌───>│   REJECTED   │
                     │    └──────────────┘
                     │
┌──────────┐    ┌────┴────┐    ┌──────────┐    ┌────────────────────────┐
│ PENDING  │───>│APPROVED │───>│CONFIRMED │    │ PENDING_HCM_           │
│          │    │         │    │_BY_HCM   │    │ CONFIRMATION           │
└────┬─────┘    └────┬────┘    └──────────┘    └───────────┬────────────┘
     │               │              ^                      │
     │               │              │                      │
     │               ├──────────────┼──────────────────────┘
     │               │              │         (retry succeeds)
     │               │         ┌────┴───────┐
     │               └────────>│PENDING_HCM │
     │                         │CONFIRMATION│
     │                         └────┬───────┘
     │                              │
     │                              v
     │                         ┌────────────┐
     │                         │HCM_REJECTED│
     │                         └────────────┘
     │
     v
┌──────────┐
│CANCELLED │  (reachable from PENDING, APPROVED, CONFIRMED_BY_HCM)
└──────────┘
```

### 7.2 State Transitions

| From | To | Trigger | Side Effects |
|------|----|---------|--------------|
| (new) | PENDING | Employee submits request | Reserve days in local balance |
| PENDING | APPROVED | Manager approves | Call HCM to register absence |
| PENDING | REJECTED | Manager rejects | Release reserved days |
| APPROVED | CONFIRMED_BY_HCM | HCM confirms registration | Move reserved → used days, store hcmReference |
| APPROVED | PENDING_HCM_CONFIRMATION | HCM timeout/transient error | Schedule retry |
| APPROVED | HCM_REJECTED | HCM rejects registration | Release reserved days, notify employee |
| PENDING_HCM_CONFIRMATION | CONFIRMED_BY_HCM | Retry succeeds | Move reserved → used days |
| PENDING_HCM_CONFIRMATION | HCM_REJECTED | Retry fails permanently | Release reserved days |
| PENDING | CANCELLED | Employee cancels | Release reserved days |
| APPROVED | CANCELLED | Employee cancels | Release reserved days, cancel in HCM if registered |
| CONFIRMED_BY_HCM | CANCELLED | Employee cancels | Release used days, cancel absence in HCM |

---

## 8. Synchronization Strategy

### 8.1 Real-Time Sync

**Triggered by**: Employee refreshing their balance, or before critical operations.

1. Call HCM `GET /balances/:employeeId` endpoint.
2. Update local `totalDays` for all returned balance records.
3. Recalculate `availableDays` considering local `reservedDays` and `usedDays`.
4. Log as REAL_TIME sync in SyncLog.

### 8.2 Batch Sync

**Triggered by**: Cron job, admin action, or HCM webhook push.

1. Receive complete balance dataset from HCM.
2. For each balance record:
   a. Upsert `totalDays` in local LeaveBalance.
   b. Recalculate `usedDays` from sum of CONFIRMED_BY_HCM requests.
   c. If local `usedDays` differs from HCM-implied used days, log discrepancy.
3. Handle new balances (e.g., new employee, new leave type) by creating records.
4. Log as BATCH sync in SyncLog with discrepancy count.

### 8.3 Reconciliation During Batch Sync

When a batch sync arrives while requests are in-flight:

- **PENDING/APPROVED requests**: Keep `reservedDays` intact. The batch sync updates `totalDays` but does not touch `reservedDays`.
- **CONFIRMED_BY_HCM requests**: `usedDays` should align with HCM data. If not, the discrepancy is logged for manual review.
- After batch sync, any request whose balance is now insufficient (due to reduced `totalDays`) is flagged but not auto-cancelled, since the manager already approved it.

---

## 9. Error Handling and Resilience

### 9.1 HCM Communication Failures

| Scenario | Handling |
|----------|----------|
| HCM timeout (network) | Set status to PENDING_HCM_CONFIRMATION, retry with exponential backoff (max 3 attempts) |
| HCM 4xx (validation error) | Set status to HCM_REJECTED, release reservation, return error to client |
| HCM 5xx (server error) | Same as timeout: retry with backoff |
| HCM returns success but with unexpected payload | Log warning, treat as success if hcmReference present |

### 9.2 Concurrency Protection

All balance modifications (reserve, release, move to used) happen inside Prisma interactive transactions. The transaction:

1. Reads the current LeaveBalance row.
2. Validates that `availableDays >= requestedDays`.
3. Updates `reservedDays` (or `usedDays`).
4. If validation fails after read (race condition), the transaction rolls back.

SQLite's write serialization provides an additional layer of protection against concurrent modifications.

### 9.3 Idempotency

- Leave request creation is idempotent on (employeeId, locationId, leaveType, startDate, endDate) to prevent duplicate submissions.
- HCM absence registration stores the `hcmReference` to avoid re-registering.

---

## 10. Alternatives Considered

### 10.1 HCM-Only (No Local Cache)

**Description**: Every balance check calls the HCM in real time. No local state.

| Aspect | Evaluation |
|--------|-----------|
| **Pros** | Always accurate; no sync complexity |
| **Cons** | Slow UX (every page load hits HCM); complete dependency on HCM availability; no offline capability |
| **Verdict** | Rejected. Unacceptable UX latency and availability coupling. |

### 10.2 Local-Only with Async Sync

**Description**: ExampleHR is the authority. Balance changes are pushed to HCM asynchronously.

| Aspect | Evaluation |
|--------|-----------|
| **Pros** | Fastest UX; fully decoupled from HCM for reads |
| **Cons** | ExampleHR becomes a competing source of truth; HCM independent changes are lost until next sync; high risk of balance divergence |
| **Verdict** | Rejected. Violates the requirement that HCM is the source of truth. |

### 10.3 Event-Sourced Balances

**Description**: Every balance mutation is stored as an event. Current balance is computed by replaying events.

| Aspect | Evaluation |
|--------|-----------|
| **Pros** | Full audit trail; can replay and reconstruct any point in time; natural fit for distributed systems |
| **Cons** | Significant implementation complexity; event schema evolution is hard; HCM doesn't emit events natively |
| **Verdict** | Rejected for v1. Would be valuable at scale but is over-engineered for the current scope. Could be considered for v2. |

### 10.4 Reserve-then-Confirm (Selected)

**Description**: Local cache for fast reads, reservation mechanism for concurrency, HCM confirmation for authority.

| Aspect | Evaluation |
|--------|-----------|
| **Pros** | Fast reads; HCM remains authority; handles concurrency; graceful degradation on HCM failures |
| **Cons** | More complex state machine; requires careful sync reconciliation |
| **Verdict** | **Selected.** Best balance of UX performance, data integrity, and implementation complexity. |

---

## 11. Technology Stack

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Runtime | Node.js + NestJS | TypeScript support, modular architecture, built-in testing |
| ORM | Prisma | Type-safe queries, migrations, excellent DX |
| Database | SQLite | Zero-config, file-based, sufficient for microservice scope |
| Testing | Jest + Supertest | NestJS native support, comprehensive mocking |
| HTTP Client | Axios | Interceptors for retry logic, widely adopted |
| Validation | class-validator + class-transformer | Decorator-based DTO validation, NestJS integration |

---

## 12. Testing Strategy

### 12.1 Unit Tests

Every service has corresponding `*.spec.ts` tests with mocked dependencies:

- **LeaveRequestService**: State machine transitions, balance validation, reservation logic
- **LeaveBalanceService**: Sync processing, discrepancy detection, upsert logic
- **HcmService**: HTTP client behavior, retry logic, error mapping, response parsing

### 12.2 Integration/E2E Tests

A **mock HCM server** (real NestJS application) provides a stateful simulation of the HCM API with test manipulation endpoints for controlling behavior (inject errors, set balances, simulate bonuses).

E2E test scenarios:
1. Happy path: full lifecycle from request to HCM confirmation
2. Insufficient balance: local rejection without HCM call
3. HCM rejection: rollback after HCM refuses
4. Concurrent requests: race condition handling
5. Batch sync: cache overwrite with in-flight request handling
6. Independent HCM changes: anniversary bonus visibility after refresh
7. HCM timeout/retry: PENDING_HCM_CONFIRMATION flow
8. Cancellation: at each stage, including HCM notification
9. Stale cache: local vs HCM balance divergence

### 12.3 Coverage Target

- 90%+ line coverage
- All state machine transitions covered
- All error paths covered

---

## 13. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Response time (cached reads) | < 50ms |
| Response time (HCM real-time call) | < 2s (dependent on HCM) |
| Availability | 99.9% (independent of HCM for reads) |
| Data freshness | Batch sync every 1 hour; real-time on demand |
| Concurrency | Safe for concurrent requests per employee |
| Audit trail | All state transitions logged with timestamps |

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| **HCM** | Human Capital Management system (e.g., Workday, SAP). The source of truth for employee and leave data. |
| **Balance** | The number of leave days an employee is entitled to, has used, and has available. |
| **Reservation** | A temporary hold on balance days for a pending/approved leave request not yet confirmed by HCM. |
| **Batch Sync** | Periodic bulk transfer of all balance data from HCM to ExampleHR. |
| **Real-Time Sync** | On-demand query of a single employee's balance from HCM. |
| **Reserve-then-Confirm** | The pattern where ExampleHR optimistically reserves balance locally, then requires HCM confirmation to finalize. |
