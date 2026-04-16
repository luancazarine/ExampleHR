# ExampleHR Leave Microservice

A NestJS microservice that manages employee leave requests and synchronizes leave balances with an external HCM (Human Capital Management) system.

## Architecture

- **Pattern**: Reserve-then-Confirm — local cache for fast reads, HCM as the source of truth
- **Stack**: NestJS, Prisma, SQLite, Jest
- **Architecture**: MVC with service layer

## Getting Started

```bash
npm install
npx prisma migrate dev
npm run start:dev
```

Once the server is running, open **http://localhost:3000/docs** to explore the interactive Swagger UI documentation.

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

## Testing

```bash
# Unit tests (57 tests)
npm test

# Unit tests with coverage
npm run test:cov

# E2E tests (35 tests, includes mock HCM server)
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
