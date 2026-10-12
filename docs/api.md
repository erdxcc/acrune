# API Reference

The relayer (`apps/relayer`) is a small Hono app. It is deployed at https://acrunee.vercel.app, where the root redirects to the game, and runs locally on http://localhost:8787 with `pnpm dev`.

All bodies are JSON. Errors come back as `{ "error": "..." }` with a status code.

## Session

Every write is made on behalf of an iDos player. The game sends the player's iDos session with each request:

```json
{ "titleId": "BVTWU78A", "userId": "...", "ticket": "..." }
```

The relayer checks the ticket with iDos before doing anything else. It answers `403` when the title is not in `ALLOWED_TITLES`, `401` when iDos rejects the session and `503` when iDos cannot be reached.

## Runs

### Start a run

```
POST /v1/run/start
```

**Request:** the session plus `battleId` (`c1-b1`, `c1-b2`, `c1-b3` or `c1-boss`).

**Response:**

```json
{ "runToken": "..." }
```

The run token is HMAC-signed and records the battle and the start time on the relayer's clock.

### Finish a run

```
POST /v1/run/finish
```

**Request:**

```json
{
  "titleId": "BVTWU78A",
  "userId": "...",
  "ticket": "...",
  "runToken": "...",
  "progressToken": "...",
  "result": "win",
  "stats": { "durationMs": 61000, "casts": 14, "precise": 9, "parries": 2 },
  "pages": "base64 of the player's pages"
}
```

`progressToken` is the token from the previous win (null on the first one). `pages` holds the player's best drawings in the binary page format.

**Response:**

```json
{
  "progressToken": "...",
  "counted": true,
  "grimoire": { "status": "written", "asset": "...", "signatures": ["..."] }
}
```

A win counts when it is plausible: battles in order, a minimum duration measured by the relayer, sane stats. Otherwise `counted` is false and `reason` says why. Each page is re-recognised before it is accepted. When the win counts and the player has linked a wallet in iDos, the relayer writes the grimoire.

`grimoire.status` is one of:

| Status | Meaning |
|---|---|
| `written` | The grimoire was created or updated; `signatures` lists the transactions |
| `pending` | Sent but not confirmed yet |
| `unchanged` | Nothing new to write |
| `no-wallet` | The player has no wallet linked in iDos |
| `error` | Not written; `error` says why |

Writes are limited to 30 per hour per player.

### Sync the grimoire

```
POST /v1/grimoire/sync
```

**Request:** the session, `progressToken` and `pages`. Writes the pages and stats of the progress the player already has, for example right after they link a wallet.

**Response:**

```json
{ "grimoire": { "status": "written", "asset": "...", "signatures": ["..."] } }
```

## Reading

### Grimoire of a wallet

```
GET /v1/grimoire/:wallet
```

**Response:**

```json
{
  "wallet": "...",
  "asset": "...",
  "exists": true,
  "pages": "base64 of the pages",
  "attributes": { "Chapter 1": "...", "Accuracy": "..." },
  "image": "https://acrunee.vercel.app/img/<asset>.png"
}
```

### NFT metadata and images

```
GET /meta/collection.json
GET /meta/:asset.json
GET /img/collection.png
GET /img/:asset.png
```

The metadata follows the Metaplex JSON standard. The images are rendered from the strokes stored on chain.

### Health check

```
GET /health
```

```json
{
  "ok": true,
  "cluster": "devnet",
  "chain": { "relayer": "EFWUBnDzrPTASEFQwBmZ9UnxCWo9GhZNc7kQhqvApth3", "balanceSol": 4.98, "collection": "D5kYrvq47QFuqrNyj7TVT3mgWHCqqebuYDaPyvFgxJDo" }
}
```

## CORS

Browsers may call the relayer from `idos.games`, `idosgames.com` and their subdomains, and from `localhost`.

## TypeScript client

The game talks to the relayer through `RelayerClient` (`apps/game/src/relayer/client.ts`):

```typescript
import { RelayerClient } from './relayer/client';

const relayer = new RelayerClient('https://acrunee.vercel.app');
const { runToken } = await relayer.startRun(session, 'c1-b1');
const result = await relayer.finishRun(session, { runToken, progressToken, result: 'win', stats, pages });
```
