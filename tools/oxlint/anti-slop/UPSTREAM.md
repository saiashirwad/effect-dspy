# Upstream provenance

- Source: https://github.com/dmmulroy/anti-slop
- Exact revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Source directory: `src/`, copied verbatim to `tools/oxlint/anti-slop/`.
- Generic entry point: `tools/oxlint/anti-slop/index.ts`.
- Effect entry point: `tools/oxlint/anti-slop/effect/index.ts`.
- Root upstream MIT license copied to `LICENSE`.
- Nested `vendor/eslint-stylistic/LICENSE` and `UPSTREAM.md` retained unchanged.
- Installation instructions reviewed: `skills/install-anti-slop/SKILL.md` at this revision.

No production-source deviations. This provenance file and the root license are
additions to the upstream `src/` snapshot. Tests and supporting vendored files are
retained. The repository excludes this directory from lint and formatting; its
TypeScript configs include only project source and tests, not this tooling.

When updating, recover this exact revision and three-way merge local changes with
incoming upstream source. Keep both licenses and nested provenance. Match the
exact `@oxlint/plugins` version to `oxlint` and preserve the Effect tsgo patch and
preset; re-run lint and typecheck without weakening policy to hide diagnostics.
