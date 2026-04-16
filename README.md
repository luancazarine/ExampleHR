# ExampleHR Leave Microservice

A NestJS microservice that manages employee leave requests and synchronizes leave balances with an external HCM (Human Capital Management) system.

## Architecture

- **Pattern**: Reserve-then-Confirm — local cache for fast reads, HCM as the source of truth
- **Stack**: NestJS, Prisma, SQLite, Jest
- **Architecture**: MVC with service layer

## Prerequisites

- Node.js >= 18.17
- npm

## Environment Variables

Create a `.env` file in the project root (a sample is provided). All variables are required for the application to run correctly.

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DATABASE_URL` | Prisma connection string for the SQLite database | — | `file:./dev.db` |
| `HCM_BASE_URL` | Base URL of the HCM system API (or mock HCM server in dev) | `http://localhost:3001` | `http://localhost:3001` |
| `HCM_MAX_RETRIES` | Number of retry attempts for failed HCM API calls | `3` | `3` |
| `PORT` | Port for the main application server | `3000` | `3000` |
| `MOCK_HCM_PORT` | Port for the mock HCM server (dev only) | `3001` | `3001` |

Example `.env`:

```env
DATABASE_URL="file:./dev.db"
HCM_BASE_URL="http://localhost:3001"
```

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Run database migrations
npx prisma migrate dev

# 3. Start the mock HCM server (terminal 1)
npm run start:mock-hcm

# 4. Start the application (terminal 2)
npm run start:dev
```

The mock HCM server starts on port 3001 and pre-seeds balances for test employees (EMP001, EMP002). You can manipulate its state via `POST /hcm/__test__/*` endpoints.

Once both servers are running, open **http://localhost:3000/docs** to explore the interactive Swagger UI documentation.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start the main app in watch mode (port 3000) |
| `npm run start:mock-hcm` | Start the standalone mock HCM server (port 3001) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run start:prod` | Run the compiled production build |
| `npm test` | Run unit tests |
| `npm run test:cov` | Run unit tests with coverage report |
| `npm run test:e2e` | Run E2E tests (auto-starts mock HCM internally) |

## API Documentation

The full API documentation is available via **Swagger UI** at `/docs` when the server is running. It includes request/response schemas, parameter descriptions, and example values for every endpoint.

## API Endpoints

### Leave Balances
- `GET /leave-balances/:employeeId` — cached balances
- `GET /leave-balances/:employeeId/refresh` — force refresh from HCM
- `POST /leave-balances/sync` — trigger batch sync
- `POST /leave-balances/webhook` — receive HCM push

### Leave Requests
- `POST /leave-requests` — create request (reserves balance)
- `GET /leave-requests/:id` — get by ID
- `GET /leave-requests/employee/:employeeId` — list by employee
- `PATCH /leave-requests/:id/approve` — manager approve (calls HCM)
- `PATCH /leave-requests/:id/reject` — manager reject
- `PATCH /leave-requests/:id/cancel` — cancel request

### Admin
- `GET /health` — health check
- `GET /sync-logs` — sync history

## Mock HCM Server

For local development, a standalone mock HCM server simulates the external HCM system. It provides:

- Stateful in-memory balance and absence tracking
- Validation (rejects if insufficient balance)
- Test manipulation endpoints:
  - `POST /hcm/__test__/set-balance` — set an employee's balance
  - `POST /hcm/__test__/add-bonus` — simulate an anniversary bonus
  - `POST /hcm/__test__/set-error-mode` — force errors (`reject_all`, `timeout`, `server_error`)
  - `POST /hcm/__test__/set-delay` — add artificial latency
  - `POST /hcm/__test__/reset` — reset all state

During E2E tests, the mock HCM server is started automatically — you do not need to run it separately.

## Testing

```bash
# Unit tests (58 tests)
npm test

# Unit tests with coverage
npm run test:cov

# E2E tests (35 tests, auto-starts mock HCM server)
npm run test:e2e
```

### Coverage

| Metric     | Coverage |
|------------|----------|
| Statements | 98.47%   |
| Branches   | 81.35%   |
| Functions  | 98.14%   |
| Lines      | 98.36%   |

## Documentation

- **Swagger UI**: `http://localhost:3000/docs` (interactive API explorer)
- **Technical Requirements Document**: [docs/TRD.md](docs/TRD.md)
