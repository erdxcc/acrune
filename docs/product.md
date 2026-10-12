# Product

## What is Acrune?

Acrune is a pixel-art battle game where magic is drawn. You are the last scribe of an order of mages. Enemies stand along the road and hurl spells at you, and you answer by drawing elemental glyphs in the magic circle of your grimoire: the cleaner the glyph, the stronger the spell. Every element has an opposite, and drawing the opposite of an enemy's cast in time parries it.

The grimoire is also the player's Solana asset. It is a soulbound NFT, and every page holds the player's own best drawing of a spell they have learned, checked by the game server before it is written. No two grimoires look alike.

Chapter 1, The Sundered Gate, is playable on iDos Games: four locations, enemies that come out one at a time, and a boss whose weakness changes between phases.

## Target Players

- **Browser and mobile players** on portals like idosgames.com who want a short, skill-based battle they can start without installing anything.
- **Players new to crypto.** You can play the whole chapter as a guest and link a wallet later; you never sign a transaction or pay a fee.
- **Collectors** who want an NFT that says something about its owner instead of one anyone could buy.

## Core Value

1. **Skill you can see.** A spell is a glyph you draw, scored for accuracy. Precise drawings hit 1.5× harder, sloppy ones can backfire, and crossing two glyphs makes a combination.
2. **A grimoire that is yours alone.** It cannot be transferred or burned, its pages are your strokes, and its image is rendered from them.
3. **No friction.** A relayer signs and pays for every write, which also makes the game work inside the idosgames.com iframe, where a game cannot ask a wallet to sign.
4. **Earned, not claimed.** The relayer checks the iDos session, reads the wallet the player linked by signature, and re-recognises every drawing before it goes on chain.

## How It Differs

| | Usual web3 game | Acrune |
|---|---|---|
| Casting a spell | Press a button | Draw a glyph, scored for accuracy |
| The NFT | Bought and traded | Soulbound, earned in battle, drawn by its owner |
| Getting started | Wallet, seed phrase, gas | Play as a guest, link a wallet later |
| Who signs | The player, for every action | The relayer, for every write |
| Proof of progress | Whatever the client reports | Session, wallet and drawings checked on the server |
