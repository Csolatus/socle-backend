# Day 2: REST, MCP and streaming AI

One application, two delivery interfaces. REST controllers and MCP tools invoke the
same application operations. TanStack AI consumes the MCP server over HTTP and streams
its response through a separate Hono `/chat` endpoint.

## Run locally

Requires Bun and Docker Compose. From this directory:

```sh
cp .env.example .env
bun install
docker compose up -d --wait
bun run db:migrate
bun run db:seed
bun run dev
```

The API binds to http://127.0.0.1:3000. PostgreSQL runs on localhost:55432.
Change `POSTGRES_PORT` and `DATABASE_URL` together if needed. `ADMINER_PORT` configures
the database web interface. If changing `PORT`, the default internal MCP URL follows it.
`MCP_URL` overrides the trusted URL used by the AI client, never a request parameter.

Add your OpenRouter key to `.env`:

```dotenv
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=z-ai/glm-5.3-flash
```

The live adapter uses OpenRouter's OpenAI-compatible Chat Completions endpoint,
`https://openrouter.ai/api/v1`, with `z-ai/glm-5.3-flash` as the default model.
`OPENROUTER_MODEL` can override it. REST, MCP, and tests need no model API key.
Without a key, `/chat` returns 503.
Live model calls can incur charges. Each chat request has a five-iteration tool-loop
limit and a 60-second run timeout. Chat is single-turn, without stored conversation history.

### Database web interface

Open http://localhost:8080 and select PostgreSQL:

| Field    | Value      |
| -------- | ---------- |
| Server   | `postgres` |
| Username | `events`   |
| Password | `events`   |
| Database | `events`   |

`postgres` is the Compose service name, not localhost inside Adminer.
Use SQL command to query the database.
These services bind to localhost and use demo credentials.

### Schema, migrations and seed

The schema is defined with Drizzle in `src/infrastructure/schema.ts` (`users`, `venues`,
`events`, `reservations`). Migrations live in `drizzle/` and are generated, never
written by hand:

```sh
bun run db:generate   # after editing schema.ts: writes a new file in drizzle/
bun run db:migrate    # applies pending migrations, recorded in drizzle.__drizzle_migrations
bun run db:seed       # inserts the demo records from sql/seed.sql, safe to rerun
```

Compose no longer creates the schema: start the database, then run `db:migrate`.
A database created earlier from the old `sql/init.sql` already has the tables, so
`db:migrate` fails on it. Reset the disposable volume (below) or recreate it.

### UUID-v7 upgrade

The new domain requires lowercase UUID v7 identifiers. Previous v4 demo data is not
compatible. Rerunning the seed file does not migrate old rows. For disposable lesson
data, explicitly reset the volume, which deletes all local records:

```sh
docker compose down -v
docker compose up -d --wait
```

For existing data, back up the database and run the data-preserving migration instead:

```sh
docker compose exec -T postgres pg_dump -U events -d events > /tmp/events-before-uuid-v7.sql
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U events -d events < sql/migrate-uuid-v7.sql
```

This converts legacy identifiers and their foreign keys in one transaction, preserving
reservations and ownership. It prints the old-to-new mapping for external references.
A collision with an already-existing target ID causes a rollback rather than data loss.
Rerunning the migration leaves UUID-v7 records unchanged. Run it before rerunning the
seed on an old database. No database reset or migration is performed automatically.

If MCP `list_events` returns `INTERNAL_ERROR` and REST `/events` also returns 500,
check the server logs: old UUID-v4 rows cannot be decoded by the UUID-v7 domain mapper.
The migration resolves this; changing the client request or adding identity does not.

| Record       | UUID v7                                |
| ------------ | -------------------------------------- |
| Alice        | `01900000-0000-7000-8000-000000000001` |
| Bob          | `01900000-0000-7000-8000-000000000002` |
| Venue        | `01900000-0000-7000-8000-000000000003` |
| Gaming event | `01900000-0000-7000-8000-000000000004` |

## Architecture

```text
REST reads (GET) ──────────────> Query handler ───┐
REST writes (POST, PATCH) ─────> Command handler ─┤
                                                  ├─> Application operations ─> Repository
MCP /mcp ──────────────────────> Tool handlers ───┘
          ↑
TanStack AI /chat ────────────> MCP HTTP client
```

```text
src/
  bootstrap.ts          Composition root and local HTTP server
  app.ts                Hono delivery setup and HTTP error mapping
  routes/               REST routes and request validation
  controllers/          REST query handler (reads) and command handler (writes)
  mcp/                  MCP tools, schemas, results and Streamable HTTP transport
  chat/                 TanStack AI model loop and AG-UI SSE responses
  application/          Focused handlers, reads, identity and repository interface
  domain/               Event and reservation rules; branded UUID-v7 identifiers
  shared-kernel/        Option and Result, without framework dependencies
  infrastructure/       Drizzle schema and client, PostgreSQL and in-memory repositories, entity mappings
  presentation/         Valibot DTO schemas and domain-to-DTO presenters
  validation.ts         Valibot request schemas and branded ID conversion
drizzle/                Generated SQL migrations and their journal
sql/seed.sql            Demo records
scripts/                Migration and seed runners
```

Imports use `#/*`, configured in `package.json` and `tsconfig.json` as in `hono-deep`.
The domain and application layers do not depend on Hono, MCP, TanStack AI or Valibot.
REST and MCP both validate inputs and outputs at runtime. Discoverable MCP JSON Schemas
are generated from Valibot input schemas before their Date and branded-ID transforms.
Custom checks and text trimming still run in Valibot even when JSON Schema cannot express them.

### Errors as values and absence

Expected business failures are `Result<Value, Error>` values with `_tag: 'Success'`
or `_tag: 'Failure'`. Event creation, capacity checks, updates, reservation and cancellation
return results rather than throwing expected errors.

`Option<Value>` represents absence using `None` and `Some`. Repository lookups return
`Option<Event>`. Both domain and persistence-entity `cancelledAt` use
`Option<Date>`. SQL row decoding converts `NULL` to `None`; SQL writes convert it back
only at the driver boundary. JSON responses expose a timestamp or `null` as a wire contract.

Delivery adapters inspect Results directly and translate failures into REST status
codes or MCP tool errors without throwing expected failures. Unexpected infrastructure
failures still throw.
Invalid response DTOs or corrupt stored data are server failures, not invalid client requests.

### Persistence

`EventData` is camelCase domain state. `EventEntity` is the row type inferred from the
Drizzle schema (`$inferSelect`). Reservation entities decode database absence into Option. Explicit mappers keep these
representations separate from public DTOs.

`PostgresEventRepository` locks the event row before counting active reservations and
writing a booking or capacity change. Both operations use the same lock to prevent
concurrent overbooking. Returning Failure from the mutation callback performs no write.
Cancelling locks the reservation, checks ownership, and records the cancellation instead
of deleting it.

`InMemoryEventRepository` implements the same port for fast backend tests. Supply its
known user and venue IDs as sets, then pass it to `createServices`. It has no artificial
await between checking capacity and writing, so each mutation runs in one JS turn.
It is a test fake, not evidence that PostgreSQL transactions work. The default server
still uses PostgreSQL.

## REST and MCP side by side

Every MCP tool is invoked through `POST /mcp` with JSON-RPC method `tools/call`.

| REST endpoint                                     | MCP tool               | Arguments                                              |
| ------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `GET /events?category=gaming&after=...`           | `list_events`          | Optional `category`, `after`                           |
| `POST /events`                                    | `create_event`         | `title`, `category`, `startsAt`, `capacity`, `venueId` |
| `GET /events/{eventId}`                           | `get_event`            | `eventId`                                              |
| `PATCH /events/{eventId}`                         | `update_event`         | `eventId`, non-empty `patch`                           |
| `POST /events/{eventId}/reservations`             | `reserve_event`        | `eventId`, `quantity`                                  |
| `GET /me/reservations`                            | `list_my_reservations` | Empty object                                           |
| `POST /reservations/{reservationId}/cancellation` | `cancel_reservation`   | `reservationId`                                        |

REST creation and reservation return 201. Other successful operations return 200.
Event creation supplies a `Location` header. Lists return arrays. MCP list results wrap
arrays in `{ events: [...] }` or `{ reservations: [...] }`, because structured tool
outputs are objects. Other successful tools return the same DTO as REST.

Requests reject unknown fields. Timestamps require a timezone. `after` is an exclusive
event-start filter, not a pagination cursor. Lists sort by date and ID. There is no pagination.
Events must start in the future, capacity and quantity must be positive 32-bit integers,
and capacity cannot fall below active reservations. Multiple reservations per user are allowed.
Cancellation is allowed after event start, belongs to its user, and cannot be repeated.

### Pair of equivalent requests

```sh
curl -i http://127.0.0.1:3000/events/01900000-0000-7000-8000-000000000004/reservations \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: 01900000-0000-7000-8000-000000000001' \
  -d '{"quantity":2}'

curl -N http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -H 'X-User-Id: 01900000-0000-7000-8000-000000000001' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"reserve_event","arguments":{"eventId":"01900000-0000-7000-8000-000000000004","quantity":2}}}'
```

Each request performs its own reservation. Running both reserves four seats, not two.
The normal MCP client sequence starts with `initialize` and `notifications/initialized`;
the collection below includes both. The server is stateless, so it needs no session-ID header.

### Error contracts

REST errors use a runtime-validated `ErrorDto`:

```json
{ "error": { "code": "CONFLICT", "message": "Not enough seats" } }
```

REST uses 400 for invalid input, 401 for missing or unknown demo identity, 404 for
missing resources, 409 for business conflicts, and 500 for unexpected failures.

A valid MCP call with a business failure returns a result containing `isError: true`
and an error DTO encoded as text, normally inside HTTP 200. The SDK's `McpServer`
also reports invalid tool arguments and unknown tool names as `isError: true`, with
SDK-provided text rather than the application error DTO. Malformed JSON-RPC envelopes
still produce protocol errors; HTTP transport failures remain transport failures.
Do not interpret HTTP 200 alone as a successful tool action.

Tools use `McpServer.registerTool`. Valibot is the schema source of truth; its generated
JSON Schema is adapted to Zod only because the installed MCP SDK requires Zod for
registration. UUID validation uses a single lowercase UUID-v7 pattern, avoiding the
`allOf` generated by overlapping UUID checks and preserving strict-mode compatibility.
MCP's optional read filters accept `null` as omitted; required IDs and write fields do not.

### Demo identity and safety

Reservation operations and `/chat` use `X-User-Id`. MCP tool arguments cannot select a
user: the identity comes from the request header and TanStack forwards it to MCP.
This header is not authentication. Anyone can impersonate a seeded user. Creating and
editing events remain public for the lesson. Add authentication, organizer permissions,
rate limits and explicit write approval before deploying an AI agent outside this demo.
Tool annotations and system prompts are not authorization or approval controls.

The server binds to loopback. MCP rejects browser origins except the local port-3000
origins. Yaak and CLI requests normally omit Origin. No cross-origin browser UI is configured.
Writes are not idempotent: do not automatically retry a timed-out reservation call.

## Showcase with Yaak

Import `demo/yaak.postman_collection.json` using Yaak's Postman importer. It is a
Postman v2.1 interchange file, not a native Yaak workspace. Requests use concrete local
URLs and Alice's `X-User-Id` header on every request, including discovery and public
reads, so you can inspect each request without environment setup. There is no login
session: the header is the explicit demo identity for that request.
The file is generated by `bun run demo:export`.

1. Open folder `0. MCP handshake and discovery`. Send initialize, initialized, then tools/list.
2. For each workflow, compare the REST request with its MCP request in the same folder.
3. Reserve seats through one interface and read them through the other.
4. Compare REST 409 with MCP `isError: true` for overbooking.
5. Compare REST 400 with MCP's invalid-input `isError: true` result.
6. Copy a reservation ID into both cancellation requests. Replace the literal
   `{{reservationId}}` placeholder if your importer does not migrate collection variables.
7. With a provider key configured, send the `/chat` request and inspect its SSE events.

MCP Streamable HTTP and chat SSE are different streams. MCP emits JSON-RPC messages;
chat emits AG-UI events such as `RUN_STARTED`, `TOOL_CALL_START`, `TOOL_CALL_RESULT`,
`TEXT_MESSAGE_CONTENT` and `RUN_FINISHED`. Once streaming headers are sent, failures
appear as `RUN_ERROR` events rather than a changed HTTP status. The normal client must
handle both pre-stream HTTP errors and errors within the stream.

Yaak versions differ in their SSE display. The SDK tests and CLI consumers below are
the protocol-level checks; importing a collection does not replace those checks.

## Consume the streams

The MCP CLI uses the official SDK, which handles initialization and SSE parsing:

```sh
bun run demo:mcp
bun run demo:mcp list_events '{"category":"gaming"}'
bun run demo:mcp list_my_reservations '{}'
```

The chat CLI uses an SSE parser, not a hand-written split on network chunks:

```sh
bun run demo:chat 'List upcoming gaming events'
bun run demo:chat 'Show my reservations using your tools'
```

It prints text deltas and tool events, checks stream completion, and reports HTTP or
in-stream failures. Set `API_URL` and `DEMO_USER_ID` to override the local defaults.
Ctrl-C aborts the request. The server closes each request's MCP client after completion,
failure or cancellation. It never shares a user's MCP connection with another request.

## Checks and backend tests

```sh
bun run format
bun run lint:fix
bun run check
bun run test
bun run test:transports
```

Oxfmt targets 80 columns, with exceptions for unbreakable strings. Oxlint requires
braces around conditionals and loops. `check` checks formatting, lint rules and types.

All tests use `InMemoryEventRepository`. They need neither Docker, a database nor
an API key, and never touch the demo database. `test` runs the whole suite;
`test:transports` selects REST/MCP/chat transport tests. Coverage includes:

- Domain Results, UUID-v7 parsing, immutable updates and Option cancellation state.
- Real MCP SDK initialization, discovery, schema validation and seven tool workflows.
- Shared state between REST and MCP over an ephemeral loopback HTTP server.
- Concurrent last-seat booking, capacity rejection, ownership and repeated cancellation.
- REST validation, status mapping and retained cancelled timestamps in memory.
- TanStack AI invoking MCP tools with request identity; a scripted adapter replaces
  only the external LLM.
- Browser stream parsing, intermediate tool-call finish events, nullable read filters,
  final text delivery, errors, cancellation and MCP cleanup after an early abort.

Tests execute Given/When/Then functions: `given(setup).when(action).then(assertion)`
passes typed fixtures and outcomes through the stages. They assert resolved error
Results and exact transport behavior rather than accepting arbitrary thrown errors.

These tests do not verify PostgreSQL transactions, row locks or migrations. The
production repository and SQL migration remain available for the running demo.
Real OpenRouter/model behavior also remains a manual check: a deterministic adapter
does not prove that a live model will choose the right tool.

### References

- Hono MCP transport: https://github.com/honojs/middleware/tree/main/packages/mcp
- MCP specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- TanStack AI: https://tanstack.com/ai/latest/docs/overview
- Installed TanStack AI MCP API: `node_modules/@tanstack/ai-mcp/README.md`
