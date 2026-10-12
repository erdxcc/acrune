# Contributing to Acrune

Thanks for taking a look at the project.

## Reporting issues

Open a GitHub issue with the steps to reproduce, what you expected and what happened. Screenshots help. If a glyph is not recognised, describe how you drew it (where you started, which way you went) and whether it was a finger or a mouse.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. Tests live next to the code (Vitest), so add or update them there.
3. Run the same checks as CI: `pnpm typecheck && pnpm test && pnpm build`.
4. Open a pull request against `main` and say what changed and why.

Changes to the glyph templates or the recognizer should come with the numbers from `pnpm --filter @grimoire/glyphs evaluate` before and after.

## Commit messages

Short and lowercase, with the area first when it helps:

```
relayer: on vercel, link metadata to the production domain
battle scene
readme: relayer on vercel
```

## Development setup

See [Quick Start](README.md#quick-start) in the README and [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Art

The code is MIT, but the art and music are not (see [License](README.md#license)). Please do not reuse them outside this project without asking the artist.
