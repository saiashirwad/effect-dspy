# Agent guide

This is an experimental Effect 4 library. Read [README.md](./README.md) for its status, [SPEC.md](./SPEC.md) for the API contract, and [TOOLING.md](./TOOLING.md) for toolchain details. Source takes precedence if the draft spec lags.

## Work locally

- Use Node `^22.12.0 || >=24.0.0` and `npm ci`. Do not skip install scripts: `prepare` patches TypeScript and Oxlint.
- Run `npm run check` for formatting, types, lint, and offline tests; run `npm run build` for the package output. Tests under `test/` import source directly. Keep the generated `src/index.ts` barrel in sync when public modules change.
- `npm run example:predict` and `npm run example:bootstrap` make paid DeepSeek requests and require `DEEPSEEK_API_KEY`. Use `npm run examples:typecheck` or `npm run examples:build` for offline checks. See [examples/README.md](./examples/README.md) for budgets and privacy cautions.
- Do not edit the vendored rules under `tools/oxlint/anti-slop/`; see [TOOLING.md](./TOOLING.md) for their provenance.

## Find the owner

- `Signature`, `Node`, `Predict`, and `Program` define schemas, executable nodes, and registered programs. `Node.learned` reads scoped parameters; `Program.link` validates and installs artifact parameters.
- `Dataset`, `Metric`, `Evaluation`, and `Observation` own examples, grading, program runs, and execution records. `src/internal/evaluation.ts` implements the evaluation loop shared with compilation.
- `Optimizer` selects parameters; `Compiler` runs the baseline and search, then encodes the artifact. `Artifact` owns its JSON schema and codecs. `src/internal/manifest.ts` and `fingerprint.ts` own compatibility checks.
- `DeepSeek` is the optional text-only provider. `Errors` owns tagged library errors. Other helpers live in `src/internal/`.

Artifacts and observations can contain training examples, model output, and provenance. Do not commit or paste real artifacts, traces, credentials, or sensitive diagnostics. When changing public behavior, update its tests and the affected [SPEC.md](./SPEC.md) sections, [README.md](./README.md) usage, and [examples](./examples/) as appropriate.
