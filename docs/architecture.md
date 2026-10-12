# Architecture

## System Overview

The game runs in the player's browser, on iDos hosting or inside the idosgames.com iframe. It simulates battles locally and sends each run's result and the player's drawings to the relayer. The relayer checks them and writes the grimoire on Solana.

```
Browser / idosgames.com iframe            Relayer (Vercel, Hono)                  Solana devnet
┌──────────────────────────────┐   fetch  ┌──────────────────────────────┐ Umi   ┌──────────────────────┐
│ Vite + TypeScript + Phaser 4 │ ───────▶ │ checks the iDos ticket       │ ────▶ │ Acrune Grimoires     │
│ battle simulation (pure TS)  │          │ reads the linked wallet      │       │ soulbound assets:    │
│ $Q glyph recognizer          │          │ verifies drawings, progress  │       │ Attributes + AppData │
│ @idosgames/core: login, saves│          │ writes with mpl-core         │       └──────────────────────┘
└──────────────────────────────┘          └──────────────────────────────┘
```

## Components

| Path | What |
|---|---|
| `packages/glyphs` | Shared by the game and the relayer: the $Q point-cloud recognizer, glyph templates, page codec, spell IDs and chapter progression. |
| `apps/game` | The game: scenes, deterministic battle simulation, stroke input, content data (zod schemas), iDos login and saves. |
| `apps/relayer` | HTTP API, signed tokens, iDos checks, Metaplex Core writes, NFT metadata and image. Endpoints are in [api.md](api.md). |
| `tools/glyph-lab` | A page for recording glyph samples and checking the recognizer's confusion matrix. |
| `tools/art` | Converts the artist's sources in `assets/` into the game's sprite strips. |

The game runs offline when no iDos title is configured. Saves then go to `localStorage` and Solana sync is off, which is handy for development.

## On-chain Grimoire

| What | How |
|---|---|
| Grimoire | One Metaplex Core asset per wallet in the **Acrune Grimoires** collection on devnet. The collection carries `PermanentFreezeDelegate` (frozen, no authority), so grimoires are **soulbound**: the program rejects any transfer or burn. |
| Pages | `AppData` plugin, binary format v1: up to 12 pages × 54 bytes. Each page holds the spell ID, accuracy, drawing time and 24 points of the player's own stroke. |
| Stats | `Attributes` plugin: Chapter 1, Boss, Spells, Accuracy, Parries, Best time, Format. |
| Image | Rendered by the relayer from the on-chain strokes (`/img/<asset>.png`), so every grimoire is unique. |
| Who writes | A relayer signs and pays. The player signs nothing and pays nothing. That is also why it works inside the idosgames.com iframe, where a game cannot ask the wallet to sign. |

Devnet addresses:

- Collection: [`D5kYrvq47QFuqrNyj7TVT3mgWHCqqebuYDaPyvFgxJDo`](https://explorer.solana.com/address/D5kYrvq47QFuqrNyj7TVT3mgWHCqqebuYDaPyvFgxJDo?cluster=devnet)
- Relayer key (pays fees, collection authority): [`EFWUBnDzrPTASEFQwBmZ9UnxCWo9GhZNc7kQhqvApth3`](https://explorer.solana.com/address/EFWUBnDzrPTASEFQwBmZ9UnxCWo9GhZNc7kQhqvApth3?cluster=devnet)
- Relayer: https://acrunee.vercel.app ([health](https://acrunee.vercel.app/health), [collection metadata](https://acrunee.vercel.app/meta/collection.json))

`pnpm spike` in `apps/relayer` checks the whole cycle on devnet: it creates a grimoire for a throwaway wallet (two transactions: the asset with its plugins, then the pages), updates pages and attributes in one transaction, reads everything back, and has the owner try to transfer and burn it. Both are rejected by the freeze plugin (`permanent_freeze_delegate.rs: Reject` in the program log).

## Anti-cheat

The battle is simulated on the player's device, so a win cannot be fully proven. The relayer makes faking one hard and cheap to refuse:

- It checks the player's iDos session ticket with iDos itself.
- It reads the wallet the player linked to iDos by signature, never an address the client claims.
- It re-recognises every drawing with the same recognizer (score ≥ 70 and the right spell) before a page is written.
- It counts a win only when it is plausible: battles in order, a minimum duration measured on the relayer's clock, sane stats.
- Progress travels as an HMAC-signed token kept in the player's iDos data, so no database is needed.
- Writes are limited to 30 per hour per player.

## Art Pipeline

The artist delivers pixel art upscaled to 1024×1024 on a black background: JPEG stills and MP4 loops in `assets/`, named `<enemy><animation>` (`skeletonmagebreath.mp4`, `bossbreath.mp4`), `<animation>mc` for the hero, `mcattack<element>` and `mcattack<element>+<element>` for spell flights, and `<ordinal>location` (`firstlocation.jpeg`) for a battle's background. New files are picked up by name. `uv run tools/art/convert.py` turns them into the game's files:

- finds the art-pixel size from where the colour edges fall (8 px for the 128×128 hero, 4 px for the 256×256 background);
- takes the median colour inside each art pixel, which removes JPEG and H.264 noise, then snaps colours to the set's palette and keys out the black;
- splits a video into its distinct poses and the order they play in (the idle loop is 4 poses, the casting loop 3 poses played 0-1-2-1-2-1);
- crops every frame of a set to one shared box with the feet on one line, and writes horizontal strips to `apps/game/public/assets` with their entries in `apps/game/src/assets/manifest.json`.

It also cuts the spell flights (the four elements, steam, ice and magma) out of their clips into a looping flight and an impact, and re-encodes the music. A location without its painting shows the chapter background; the boss flashes white when it changes phase, which has no drawing yet. The grimoire painting (`grimour.jpeg`) keeps its black outside transparent and lies under the battle's pages, its crease on the spine between the spell list and the circle. The game draws a coloured placeholder for anything the manifest has no file for, so art drops in by file. Animation-to-source mapping lives at the top of the script.

## Deployment

- **Game.** `pnpm --filter @grimoire/game build`, zip the contents of `apps/game/dist` (with `index.html` at the root of the archive) and upload it through the iDos Title MCP (`begin_build_upload` → PUT → `finish_build_upload`). The title is detected from the host name (`{titleid}.idos.games`) or from the upload path on `static.idos.games`.
- **Relayer.** A Vercel project for the whole repository: `vercel.json` declares one service, `relayer` (`apps/relayer`, Hono, entry `src/vercel.ts`), and sends every path to it, so the routes stay at the root of the domain; the root itself redirects to the game. Vercel installs the workspace and bundles the entry; the root `package.json` pins `uuid` 11 under `rpc-websockets`, because Vercel's Node cannot `require()` the ES-only uuid 14. Set the variables from `apps/relayer/.env.example` except `PUBLIC_BASE_URL` (on Vercel, metadata links follow the project's production domain), and add the relayer's host to the title's `Blockchain.IframeConnectHosts` so the game can reach it from inside the iframe. For local work use `pnpm dev`; `vercel dev` picks `src/app.ts` by Hono's file naming instead of the configured entry.

## Environment Variables

| Variable | Where | Meaning |
|---|---|---|
| `VITE_IDOS_TITLE_ID` | game | Title for local development; on iDos hosting it comes from the address |
| `VITE_RELAYER_URL` | game | Relayer base URL; empty turns Solana features off |
| `SOLANA_RPC_URL` | relayer | Devnet RPC |
| `RELAYER_SECRET_KEY` | relayer | 64-byte keypair as a JSON array; pays fees and owns the collection |
| `ASSET_SEED_SECRET` | relayer | Derives each wallet's grimoire address |
| `TOKEN_HMAC_SECRET` | relayer | Signs run and progress tokens |
| `COLLECTION_ADDRESS` | relayer | The Acrune Grimoires collection (`pnpm collection` creates it, or updates its name and URI when it exists) |
| `PUBLIC_BASE_URL` | relayer | Public URL of the relayer, used in NFT metadata; on Vercel the production domain is used instead |
| `GAME_URL` | relayer | The game's page, linked from the metadata |
| `IDOS_API_BASE` | relayer | `https://api.idosgames.com` |
| `ALLOWED_TITLES` | relayer | Comma-separated iDos title IDs the relayer serves |
