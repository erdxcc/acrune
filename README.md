# Acrune

A pixel-art battle game where magic is drawn. Built for the Superteam Kazakhstan × iDos Games side track of the Solana hackathon.

You are the last scribe of an order of mages. Enemies stand along the road and hurl spells at you, and you answer by drawing elemental glyphs in the magic circle of your grimoire. The cleaner the glyph, the stronger the spell. Every element has an opposite, and drawing the opposite of an enemy's cast in time parries it.

**Your grimoire lives on Solana.** It is a soulbound NFT in your wallet, and every page holds a glyph drawn by your own hand: the best drawing of each spell you have learned, checked by the game server before it is written. No two grimoires look alike.

## How to play

- Draw inside the circle on the grimoire page (finger or mouse). Each glyph is one stroke of straight lines; the dot on its picture in the grimoire shows where to start:
  - fire: a step ‾|_ (a bar to the left at the top, down, a bar to the right)
  - water: ⊥ (down the stem, then along the base, going back over one half of it)
  - air: Z
  - earth: a 1 on its base, /|_
- **Accuracy matters.** Precise drawings hit 1.5× harder. Sloppy ones are unstable and can backfire on you. Unrecognised drawings fizzle and cost no mana.
- **Opposites:** fire ↔ water, air ↔ earth. Enemies are weak to the opposite of their element.
- **Parry:** when an enemy mage raises its staff, sparks of its element gather above it. Draw the opposite before the spell lands. The grimoire shows which glyph parries the next attack.
- **Combinations:** draw the first glyph, lift, and within 0.65 s draw the second one across it, for example fire × water = steam. While the first glyph waits, the circle shows which glyphs would complete a combination; the grimoire page shows each recipe. A combination parries the combination of opposites, so ice and magma parry each other.
- **Pages:** before each battle you choose which spells to take within a page limit. The limit grows through the chapter.

The chapter has four locations, and their enemies come out one at a time, each walking in after the last one falls: three slime mages; two slimes and then a skeleton mage; skeleton, skeleton mage, skeleton; and the boss, whose weakness changes between phases. The preparation screen shows each enemy's weakness and the glyphs that parry its spells. The first battle teaches drawing and then parrying (it pauses on the first enemy cast); the third teaches combinations with a hand that draws one.

## Solana integration

| What | How |
|---|---|
| Grimoire | One Metaplex Core asset per wallet in the **Acrune Grimoires** collection on devnet. The collection carries `PermanentFreezeDelegate` (frozen, no authority), so grimoires are **soulbound**: the program rejects any transfer or burn. |
| Pages | `AppData` plugin, binary format v1: up to 12 pages × 54 bytes. Each page holds the spell ID, accuracy, drawing time and 24 points of the player's own stroke. |
| Stats | `Attributes` plugin: Chapter 1, Boss, Spells, Accuracy, Parries, Best time, Format. |
| Image | Rendered by the relayer from the on-chain strokes (`/img/<asset>.png`), so every grimoire is unique. |
| Who writes | A relayer signs and pays. The player signs nothing and pays nothing. That is also why it works inside the idosgames.com iframe, where a game cannot ask the wallet to sign. |
| Anti-cheat | The relayer checks the player's iDos session ticket with iDos itself. It reads the wallet the player linked to iDos by signature, never an address the client claims. It re-recognises every drawing with the same recognizer (score ≥ 70 and the right spell) and counts a win only when it is plausible: battles in order, a minimum duration measured on the relayer's clock, sane stats. Progress travels as an HMAC-signed token kept in the player's iDos data, so no database is needed. |

Devnet addresses:

- Collection: [`D5kYrvq47QFuqrNyj7TVT3mgWHCqqebuYDaPyvFgxJDo`](https://explorer.solana.com/address/D5kYrvq47QFuqrNyj7TVT3mgWHCqqebuYDaPyvFgxJDo?cluster=devnet)
- Relayer key (pays fees, collection authority): [`EFWUBnDzrPTASEFQwBmZ9UnxCWo9GhZNc7kQhqvApth3`](https://explorer.solana.com/address/EFWUBnDzrPTASEFQwBmZ9UnxCWo9GhZNc7kQhqvApth3?cluster=devnet)
- Relayer URL: to be deployed

`pnpm spike` in `apps/relayer` checks the whole cycle on devnet: it creates a grimoire for a throwaway wallet (two transactions: the asset with its plugins, then the pages), updates pages and attributes in one transaction, reads everything back, and has the owner try to transfer and burn it. Both are rejected by the freeze plugin (`permanent_freeze_delegate.rs: Reject` in the program log).

## Architecture

```
Browser / idosgames.com iframe            Relayer (Vercel, Hono)                  Solana devnet
┌──────────────────────────────┐   fetch  ┌──────────────────────────────┐ Umi   ┌──────────────────────┐
│ Vite + TypeScript + Phaser 4 │ ───────▶ │ checks the iDos ticket       │ ────▶ │ Acrune Grimoires     │
│ battle simulation (pure TS)  │          │ reads the linked wallet      │       │ soulbound assets:    │
│ $Q glyph recognizer          │          │ verifies drawings, progress  │       │ Attributes + AppData │
│ @idosgames/core: login, saves│          │ writes with mpl-core         │       └──────────────────────┘
└──────────────────────────────┘          └──────────────────────────────┘
```

| Path | What |
|---|---|
| `packages/glyphs` | Shared by the game and the relayer: the $Q point-cloud recognizer, glyph templates, page codec, spell IDs and chapter progression. |
| `apps/game` | The game: scenes, deterministic battle simulation, stroke input, content data (zod schemas), iDos login and saves. |
| `apps/relayer` | HTTP API, signed tokens, iDos checks, Metaplex Core writes, NFT metadata and image. |
| `tools/glyph-lab` | A page for recording glyph samples and checking the recognizer's confusion matrix. |
| `tools/art` | Converts the artist's sources in `assets/` into the game's sprite strips. |

The game runs offline when no iDos title is configured. Saves then go to `localStorage` and Solana sync is off, which is handy for development.

## Running locally

Requirements: Node 20+, pnpm 9.

```bash
pnpm install
pnpm test                 # all unit tests
pnpm dev                  # the game on http://localhost:5173 (offline mode)
```

Relayer with devnet writes:

```bash
cd apps/relayer
pnpm keygen               # writes .env with a fresh relayer key and secrets
pnpm airdrop              # or fund the printed address at https://faucet.solana.com
pnpm collection           # creates the soulbound collection, saves COLLECTION_ADDRESS
pnpm spike                # end-to-end devnet check: create, write, update, refuse transfer
pnpm dev                  # http://localhost:8787
```

Point the game at a title and the relayer with `apps/game/.env`:

```bash
VITE_IDOS_TITLE_ID=ABCD1234-DEV
VITE_RELAYER_URL=http://localhost:8787
```

The glyph recognizer can be evaluated on synthetic drawings with `pnpm --filter @grimoire/glyphs evaluate`.

## Art pipeline

The artist delivers pixel art upscaled to 1024×1024 on a black background: JPEG stills and MP4 loops in `assets/`, named `<enemy><animation>` (`skeletonmagebreath.mp4`, `bossbreath.mp4`), `<animation>mc` for the hero, `mcattack<element>` and `mcattack<element>+<element>` for spell flights, and `<ordinal>location` (`firstlocation.jpeg`) for a battle's background. New files are picked up by name. `uv run tools/art/convert.py` turns them into the game's files:

- finds the art-pixel size from where the colour edges fall (8 px for the 128×128 hero, 4 px for the 256×256 background);
- takes the median colour inside each art pixel, which removes JPEG and H.264 noise, then snaps colours to the set's palette and keys out the black;
- splits a video into its distinct poses and the order they play in (the idle loop is 4 poses, the casting loop 3 poses played 0-1-2-1-2-1);
- crops every frame of a set to one shared box with the feet on one line, and writes horizontal strips to `apps/game/public/assets` with their entries in `apps/game/src/assets/manifest.json`.

It also cuts the spell flights (the four elements, steam, ice and magma) out of their clips into a looping flight and an impact, and re-encodes the music. A location without its painting shows the chapter background; the boss flashes white when it changes phase, which has no drawing yet. The grimoire painting (`grimour.jpeg`) keeps its black outside transparent and lies under the battle's pages, its crease on the spine between the spell list and the circle. The game draws a coloured placeholder for anything the manifest has no file for, so art drops in by file. Animation-to-source mapping lives at the top of the script.

## Deployment

- **Game.** `pnpm --filter @grimoire/game build`, zip the contents of `apps/game/dist` (with `index.html` at the root of the archive) and upload it through the iDos Title MCP (`begin_build_upload` → PUT → `finish_build_upload`). The title is detected from the host name (`{titleid}.idos.games`).
- **Relayer.** A Vercel project with root directory `apps/relayer`. `pnpm build` produces `.vercel/output` (Build Output API, one Node function, `maxDuration` 30 s). Set the variables from `apps/relayer/.env.example`. Add the relayer's host to the title's `Blockchain.IframeConnectHosts` so the game can reach it from inside the iframe.

## Environment variables

| Variable | Where | Meaning |
|---|---|---|
| `VITE_IDOS_TITLE_ID` | game | Title for local development; on iDos hosting it comes from the host name |
| `VITE_RELAYER_URL` | game | Relayer base URL; empty turns Solana features off |
| `SOLANA_RPC_URL` | relayer | Devnet RPC |
| `RELAYER_SECRET_KEY` | relayer | 64-byte keypair as a JSON array; pays fees and owns the collection |
| `ASSET_SEED_SECRET` | relayer | Derives each wallet's grimoire address |
| `TOKEN_HMAC_SECRET` | relayer | Signs run and progress tokens |
| `COLLECTION_ADDRESS` | relayer | The Acrune Grimoires collection (`pnpm collection` creates it, or updates its name and URI when it exists) |
| `PUBLIC_BASE_URL` | relayer | Public URL of the relayer, used in NFT metadata |
| `GAME_URL` | relayer | The game's page, linked from the metadata |
| `IDOS_API_BASE` | relayer | `https://api.idosgames.com` |
| `ALLOWED_TITLES` | relayer | Comma-separated iDos title IDs the relayer serves |

## Credits

- Character and background art: the Acrune team.
- Pixel font: Press Start 2P by CodeMan38, SIL Open Font License (`apps/game/public/fonts/OFL.txt`).
- Glyph recognition after $Q (Vatavu, Anthony, Wobbrock, 2018).

## License

To be decided by the team.
