# Acrune: submission texts

Drafts for the Colosseum project form and the Superteam Earn listing (Superteam Kazakhstan × iDos Games side track). Links marked TBD are filled in after deployment.

## Name

Acrune

## Tagline

A pixel-art battle game where magic is drawn, and your grimoire lives on Solana as a soulbound NFT filled with glyphs drawn by your own hand.

## Short description

Acrune is a real-time battle game where every spell is a glyph you draw. Draw fire, water, air and earth in your grimoire's magic circle, cross two glyphs into a combination, and answer an enemy mage's cast with the opposite element to parry it. The cleaner the drawing, the stronger the spell. Your grimoire is a soulbound Metaplex Core NFT on Solana: each page stores your best drawing of a spell, checked by the game server, so no two grimoires look alike. It runs on iDos Games, and players sign and pay nothing.

## How it plays

- Enemies come out one at a time and hurl spells at you. You draw one-stroke glyphs of straight lines inside the circle on the lower page of your grimoire: a step for fire, ⊥ for water, Z for air, a 1 on its base for earth.
- A precise drawing hits 1.5× harder; a sloppy one is unstable and can backfire; an unrecognised one fizzles.
- Every element has an opposite (fire ↔ water, air ↔ earth). Enemies are weak to the opposite of their element, and an enemy mage's cast can be parried by drawing the opposite before it lands.
- A second glyph drawn across the first right after it makes a combination: steam, ice or magma.
- Before each battle you choose which spells to take within a page limit that grows through the chapter.
- Chapter 1 has four locations, and their enemies come out one at a time: three slime mages, then two slimes and a skeleton mage, then three skeletons (one of them a mage), then a boss whose weakness changes between phases. The first battle teaches drawing and parrying, the third teaches combinations.

## Solana integration

- **The grimoire is an on-chain asset.** One Metaplex Core asset per wallet in the Acrune Grimoires collection on devnet. The collection carries `PermanentFreezeDelegate` (frozen, no authority), so grimoires are soulbound: the Core program rejects any transfer or burn.
- **Pages are the player's own strokes.** The `AppData` plugin holds the pages in a compact binary format: spell, accuracy, drawing time and 24 points of the player's stroke per page. The `Attributes` plugin holds the chapter result: battles cleared, boss, spells, accuracy, parries, best time.
- **The image comes from the chain.** The NFT image is rendered from the on-chain strokes, so the picture in a wallet or explorer is exactly what the player drew.
- **Gasless and iframe-safe.** A relayer signs and pays for every write. The player signs nothing, which also makes it work inside the idosgames.com iframe, where a game cannot ask a wallet to sign.
- **Checked before it is written.** The relayer verifies the player's iDos session with iDos, takes the wallet the player linked to iDos by signature, and re-recognises every drawing with the game's own recognizer before writing it. Progress is an HMAC-signed token kept in the player's iDos data, so no database is needed.

Collection on devnet: https://explorer.solana.com/address/D5kYrvq47QFuqrNyj7TVT3mgWHCqqebuYDaPyvFgxJDo?cluster=devnet

## iDos Games integration

- The game is a static build hosted by iDos and embedded on its idosgames.com page.
- Sign-in through `@idosgames/core`: play as a guest, or sign in with a Solana wallet through the iDos site. Guests can link a wallet later, and their progress goes into the grimoire then.
- Saves (progress, pages, settings) live in the player's iDos `userCustomData`.
- The title is configured and the builds are uploaded through the iDos Title MCP.

## Tech

Vite, TypeScript and Phaser 4 for the game; a $Q point-cloud recognizer written for the game; a deterministic battle simulation in plain TypeScript; a Hono relayer on Vercel with Umi and mpl-core; pnpm monorepo with Vitest tests and GitHub Actions.

## Links

- Game on idosgames.com: TBD
- Direct link: TBD
- Repository: https://github.com/erdxcc/acrune
- Demo video: TBD
- Collection: https://explorer.solana.com/address/D5kYrvq47QFuqrNyj7TVT3mgWHCqqebuYDaPyvFgxJDo?cluster=devnet
