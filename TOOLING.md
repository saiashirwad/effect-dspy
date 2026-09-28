# Tooling

## Install and commands

Use Node.js 22.12 or newer and npm. Install the committed dependency graph with
`npm ci`. Do not omit development dependencies or disable lifecycle scripts when
working on this repository.

| Command                | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run typecheck`    | Native TypeScript 7 checks for source and tests, without emitting |
| `npm run build`        | Native TypeScript 7 emits ESM and declarations to `dist`          |
| `npm test`             | Vitest tests                                                      |
| `npm run lint`         | Type-aware Oxlint, including Effect diagnostics                   |
| `npm run lint:fix`     | Apply safe Oxlint fixes                                           |
| `npm run format`       | Format TypeScript, JSON and Markdown with dprint                  |
| `npm run format:check` | Check formatting without modifying files                          |
| `npm run check`        | Formatting, types, lint and tests                                 |
| `npm pack --dry-run`   | Build and inspect npm package contents                            |

The package exports built JavaScript and declarations, not TypeScript source.
Tests intentionally import source directly. `vitest.config.ts` limits discovery to
`test/**/*.test.ts`; vendored upstream tooling tests are not application tests. The `prepack` lifecycle builds before
packaging; publishable files are restricted to `dist` plus npm's standard metadata
and README inclusions.

## Native TypeScript and Effect

The toolchain pins a compatible set:

- `typescript` 7.0.2
- `@effect/tsgo` 0.46.1
- `oxlint` 1.85.0
- `oxlint-tsgolint` 7.0.2003

TypeScript 7's native compiler is named `tsc` (older native previews used `tsgo`).
The `prepare` script runs `effect-tsgo patch --typescript --oxlint` after installs.
It replaces the native TypeScript executable and Oxlint integrations with the
compatible Effect-enabled versions. Re-running `npm run prepare` is safe. Verify
with `npx tsc --version`: it should include `+effect-tsgo.0.46.1`.

There is no separate `@effect/oxlint` dependency. `.oxlintrc.json` extends the schema
and strict preset shipped by `@effect/tsgo`; that preset enables the
`effecttsgo` plugin, type-aware linting, and all Effect rules at error severity. Rule
severities are not weakened to accommodate project diagnostics.

`tsconfig.json` names the `@effect/language-service` plugin as configuration for
this native integration and sets `namespaceImportPackages: ["effect", "@effect/*"]`;
no legacy JavaScript language-service package is needed. Its `diagnostics: false` is
intentional: Effect diagnostics are reported by the Oxlint strict preset only,
avoiding duplicates in the editor and typecheck. Effect hover information,
completions, quick fixes and refactors remain provided by the patched LSP.
Standard TypeScript diagnostics are still enabled. Node types are explicitly
included, as required by TypeScript 7's type-discovery behavior.

When upgrading, consult the Effect integration's supported-version table before
updating TypeScript, Oxlint, or oxlint-tsgolint. Update this compatible set together,
regenerate `package-lock.json`, run the patch, and verify checks. The patch validates
versions instead of silently installing an incompatible binary.

## Testing

Tests run on Vitest pinned to **4.1.11** together with `@effect/vitest`
**4.0.0-rc.112**. The `@effect/vitest` peer range (`vitest >=4.1 <5`) forces the
Vitest 4 pin; upgrade the pair together. `vitest.setup.ts` calls
`addEqualityTesters()` so Vitest equality uses `Equal.equals` for Effect and Schema
values. Import `assert`, `describe`, `expect` and `it` from `@effect/vitest`, and use
`it.effect`/`it.live` for effectful tests so `TestClock` and `TestConsole` are
provided. `vitest.config.ts` restricts discovery to `test/**/*.test.ts` and loads the
setup file.

## Anti-slop policy

The generic and Effect plugins from [anti-slop](https://github.com/dmmulroy/anti-slop)
are vendored verbatim from upstream `src/` at revision
`c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` in `tools/oxlint/anti-slop/`.
`UPSTREAM.md` there records provenance and update instructions; the upstream MIT
license and nested ESLint Stylistic license/provenance are retained.

`.oxlintrc.json` extends the Effect tsgo strict preset and registers both
vendored entry points. All 18 generic rules, all five Effect rules, and native
`oxc/no-accumulating-spread` are enabled at error severity. `@oxlint/plugins` is
pinned to **1.85.0**, exactly matching Oxlint; upgrade these together within the
Effect integration's supported versions. The existing `prepare` patch remains
required after dependency changes.

The new lint/format ignores cover only the vendored plugin and named agent tooling
directories; existing generated-output ignores remain. Project `src/` and `test/`
are not excluded. TypeScript's explicit source/test includes already keep the
vendored plugin outside compilation, and dprint excludes it to preserve the
upstream snapshot. No competing formatting preset is enabled.

These rules use syntax and lexical scope, not full TypeScript inference. In
particular, the Effect service-constructor import rule checks relative project
imports, not package/path aliases. Existing source diagnostics should be fixed at
their real boundaries, not silenced with broad overrides or type laundering.
`npm run lint` fails on warnings as well as errors. Run it and `npm run typecheck`
after updates. Apply any authorized
spacing autofixes before dprint, then verify a second fix/format pass is stable.

## Editors: one TypeScript server

VS Code workspace settings follow the official `effect-tsgo setup --vscode`
configuration: enable native TypeScript and select `./node_modules/typescript/bin`.
Install the recommended TypeScript 7 extension (`TypeScriptTeam.native-preview`),
dprint, and Oxc extensions. Select the workspace TypeScript version if prompted,
then restart the TypeScript server after installing or upgrading dependencies.
The workspace's TypeScript binary has already been patched to the Effect LSP.
Do not simultaneously enable another TypeScript server (legacy tsserver, vtsls,
or a separate unpatched tsgo instance) for these files.

Oxc uses the patched workspace Oxlint and type-aware rules. Its formatter is
disabled in favor of dprint. The Effect LSP remains the sole TypeScript language
server; Oxc is the separate lint integration, not a second TypeScript server.
Trust this workspace only if you intend to execute its local tools.

For other editors, use the executable path printed by
`npx effect-tsgo get-exe-path`, with `--lsp --stdio`, as the sole TypeScript LSP.
Disable other TypeScript LSP clients for the same buffer. Keep Oxlint integration
active to see Effect diagnostics with this repository's configuration.

## Formatting

`dprint.json` pins the TypeScript, JSON and Markdown WASM plugin versions. The
first run downloads these plugins. Generated output, dependencies, coverage, and
the npm lockfile are excluded. Run formatting after coordinated source changes
have finished, not while another contributor is editing those files.

## References

- [Effect native language service and supported versions](https://github.com/Effect-TS/tsgo/blob/main/README.md)
- [Official Effect Oxlint setup](https://github.com/Effect-TS/tsgo/blob/main/docs/README.md)
- [Native TypeScript compiler naming and editor setup](https://github.com/microsoft/typescript-go/blob/main/README.md)
- [dprint plugins](https://plugins.dprint.dev/info.json)
