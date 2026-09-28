# Live DeepSeek examples

These are real API examples, not mocks. Use Node `^22.12.0 || >=24.0.0` and run commands from the repository root.

## Setup and run

```sh
npm ci
npm run examples:typecheck # offline; no credentials or network requests needed
```

Set `DEEPSEEK_API_KEY` in the environment through your secret manager, or enter it without putting it in shell history. For example, in Bash:

```bash
read -r -s -p 'DeepSeek API key: ' DEEPSEEK_API_KEY
printf '\n'
export DEEPSEEK_API_KEY
```

Do not commit keys or put them in source code. These examples do not load `.env` files. Only the provider reads the key; neither example prints it. `DEEPSEEK_MODEL` optionally selects a model (the provider defaults to `deepseek-flash`). `DEEPSEEK_BASE_URL` optionally selects an endpoint (default `https://api.deepseek.com`). Existing environment settings are respected. Custom base URLs must use HTTP(S), with no embedded credentials, query, or fragment; path bases such as `https://example.com/v1` are supported, with `/chat/completions` appended. Use only a trusted endpoint: it receives your key and prompts. Prefer HTTPS outside local testing.

```sh
npm run example:predict
npm run example:bootstrap
```

Each command first compiles TypeScript, then runs built JavaScript with Node. No `tsx` dependency is needed. Compilation includes library source and examples in `dist-examples/`; the normal published library build in `dist/` is unchanged. To build without making API requests:

```sh
npm run examples:build
# Run either built entry point explicitly when ready for paid requests:
node dist-examples/examples/predict.js
node dist-examples/examples/bootstrap.js
```

Unset the key when finished:

```sh
unset DEEPSEEK_API_KEY
```

## What they do and what they cost

- [`predict.ts`](./predict.ts): one typed arithmetic prediction with an object-shaped, schema-validated answer. **One model request** on a successful run.
- [`bootstrap.ts`](./bootstrap.ts): ingest four fixed labeled rows, split into two train and two validation rows with a fixed seed, compile with `maxDemos: 1` and `maxCandidates: 2`, serialize/deserialize the artifact as JSON, link it, and evaluate the linked program. **Six to eight model requests** on a successful run: two baseline validation + two teacher training + zero or two candidate validation + two fresh linked validation. The candidate is skipped if no training traces qualify. Baseline counts toward `maxCandidates`; that setting is not a total request limit.

Both use the environment-configured model (default `deepseek-flash`), `temperature: 0`, and `maxTokens: 128` per response. `DeepSeek.layerFromEnv` is supplied with `FetchHttpClient.layer`. The whole prediction has a 45-second Effect timeout; the whole bootstrap loop has a three-minute timeout. Timeouts cancel outstanding requests and fail visibly. Neither the examples nor provider retry; no model-based grading, parallel requests, or unbounded loops are used. The simple example budgets at most 128 output tokens; the full loop at most 1,024 output tokens, plus billed input tokens (including schemas, instructions, and demonstrations). These are request/output budgets, **not dollar cost caps**. Consult current provider pricing. A too-small token limit or invalid structured response can fail rather than complete. Failures may still incur charges.

The full loop prints actual baseline, selected, and fresh linked scores, along with artifact size and the example IDs in each split. It does not assert that optimization improves anything: the baseline wins ties, and tiny easy data may yield no useful demonstrations or no improvement. A fresh linked score can differ from the selected score. Seeds fix local splitting/candidate selection, not remote model behavior; even temperature zero does not guarantee reproducibility.

This intentionally reuses validation after linking to limit requests. It is not an unbiased held-out test. Use a larger dataset and a separate test split for real assessment. The JSON roundtrip stays in memory; artifact contents can include training-derived examples and traces, so protect them if you later persist them.

Missing credentials, provider errors, schema failures, and linking failures reject the top-level Effect and produce a nonzero Node exit. There is no mock fallback. The provider sanitizes HTTP errors, but upstream HTTP tracing can include endpoint URLs and original-schema decode failures can include generated content. Treat logs and diagnostics as sensitive, configure tracing/logging appropriately, and never paste credentials into diagnostic reports.
