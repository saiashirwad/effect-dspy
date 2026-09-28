/**
 * DeepSeek Chat Completions provider for Effect AI.
 *
 * Implements Effect AI's `LanguageModel` over DeepSeek's non-streaming,
 * text-only Chat Completions endpoint. JSON mode guides generation with a
 * JSON Schema prompt, while Effect AI still decodes the original Effect
 * Schema, including refinements, transformations, and context requirements.
 *
 * @since 0.1.0
 */
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import type * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as AiError from "effect/unstable/ai/AiError"
import * as LanguageModel from "effect/unstable/ai/LanguageModel"
import * as Response from "effect/unstable/ai/Response"
import * as Tool from "effect/unstable/ai/Tool"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type { HttpMethod } from "effect/unstable/http/HttpMethod"

/**
 * Non-streaming, text-only Chat Completions configuration.
 *
 * **When to use**
 *
 * Use as the argument to {@link layer} to pin the credential, model, endpoint,
 * and generation limits.
 *
 * @category options
 * @since 0.1.0
 */
export interface Options {
  readonly apiKey: Redacted.Redacted<string>
  readonly model?: string | undefined
  /** HTTP(S) path base without credentials, query, or fragment. */
  readonly baseUrl?: string | undefined
  readonly maxTokens?: number | undefined
  readonly temperature?: number | undefined
}

const ResponseSchema = Schema.Struct({
  choices: Schema.NonEmptyArray(Schema.Struct({
    message: Schema.Struct({ content: Schema.NullOr(Schema.String) }),
    finish_reason: Schema.String
  })),
  usage: Schema.optional(Schema.Struct({
    prompt_tokens: Schema.Finite,
    completion_tokens: Schema.Finite,
    total_tokens: Schema.Finite,
    prompt_cache_hit_tokens: Schema.optional(Schema.Finite),
    completion_tokens_details: Schema.optional(Schema.Struct({
      reasoning_tokens: Schema.optional(Schema.Finite)
    }))
  }))
})

const failure = (reason: AiError.AiErrorReason): AiError.AiError =>
  AiError.make({ module: "DeepSeek", method: "generateText", reason })

const unsupported = (description: string) =>
  failure(new AiError.InvalidUserInputError({ description }))

const invalidOutput = (description: string) =>
  failure(new AiError.InvalidOutputError({ description }))

// Keep only the method: URLs, params and headers can contain credentials.
const redacted = (request: { readonly method: HttpMethod }) => ({
  method: request.method,
  url: "[redacted]",
  urlParams: [],
  hash: undefined,
  headers: {}
})

const networkError = (reason: HttpClientError.RequestError) =>
  failure(new AiError.NetworkError({ reason: reason._tag, request: redacted(reason.request) }))

const statusError = (reason: HttpClientError.StatusCodeError) =>
  failure(AiError.reasonFromHttpStatus({
    status: reason.response.status,
    http: {
      request: redacted(reason.request),
      response: { status: reason.response.status, headers: {} }
    }
  }))

const MaxTokens = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 393216 }))

const Temperature = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 2 }))

// Returns the chat completions endpoint, rejecting URLs that could carry credentials.
const endpoint = (baseUrl: string): URL | undefined => {
  if (!URL.canParse(baseUrl)) return undefined

  const url = new URL(baseUrl)

  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== ""
    || baseUrl.includes("?") || baseUrl.includes("#")
  ) return undefined

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`

  return url
}

const problem = (maxTokens: number, temperature: number | undefined, url: URL | undefined) => {
  if (!Schema.is(MaxTokens)(maxTokens)) return "maxTokens must be an integer between 1 and 393216"

  if (temperature !== undefined && !Schema.is(Temperature)(temperature)) {
    return "temperature must be a finite number between 0 and 2"
  }

  if (url === undefined) {
    return "baseUrl must be an HTTP(S) URL without credentials, query, or fragment"
  }

  return undefined
}

const make = (
  options: Options
): Effect.Effect<LanguageModel.Service, never, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const maxTokens = options.maxTokens ?? 1024
    const url = endpoint(options.baseUrl ?? "https://api.deepseek.com")
    // Invalid options fail every request with a typed error rather than failing layer construction.
    const invalidOptions = problem(maxTokens, options.temperature, url)

    return yield* LanguageModel.make({
      generateText: (request) =>
        Effect.gen(function*() {
          if (invalidOptions !== undefined || url === undefined) {
            return yield* unsupported(invalidOptions ?? "Invalid provider options")
          }

          if (request.tools.length > 0) {
            return yield* unsupported("Tool calls are not supported by this text-only provider")
          }

          const messages: Array<{ role: string; content: string }> = []

          for (const message of request.prompt.content) {
            if (message.role === "system") {
              messages.push({ role: "system", content: message.content })
            } else if (message.role === "tool") {
              return yield* unsupported("Tool messages are not supported")
            } else {
              let content = ""

              for (const part of message.content) {
                if (part.type !== "text") {
                  return yield* unsupported("Only text prompt parts are supported")
                }

                content += part.text
              }

              messages.push({ role: message.role, content })
            }
          }

          const format = request.responseFormat

          if (format.type === "json") {
            const schema = yield* Effect.try({
              try: () => Tool.getJsonSchemaFromSchema(format.schema),
              catch: (cause) =>
                unsupported(
                  cause instanceof Error
                    ? cause.message
                    : "The output schema cannot be represented as JSON Schema"
                )
            })

            messages.unshift({
              role: "system",
              content: `Return only a JSON object matching this JSON Schema: ${
                JSON.stringify(schema)
              }. Do not include markdown fences.`
            })
          }

          const httpRequest = yield* HttpClientRequest.post(url).pipe(
            HttpClientRequest.bearerToken(options.apiKey),
            HttpClientRequest.bodyJson({
              model: options.model ?? "deepseek-flash",
              messages,
              stream: false,
              thinking: { type: "disabled" },
              max_tokens: maxTokens,
              ...(options.temperature !== undefined
                ? { temperature: options.temperature }
                : undefined),
              response_format: { type: format.type === "json" ? "json_object" : "text" }
            })
          )

          const response = yield* client.execute(httpRequest)
          const body = yield* response.json
          const decoded = yield* Schema.decodeUnknownEffect(ResponseSchema)(body)
          const choice = decoded.choices[0]

          if (choice.finish_reason !== "stop" || !choice.message.content?.trim()) {
            return yield* invalidOutput("Expected a complete, nonempty response")
          }

          const usage = decoded.usage

          return [
            Response.makePart("text", { text: choice.message.content }),
            Response.makePart("finish", {
              reason: "stop",
              usage: new Response.Usage({
                inputTokens: {
                  uncached: undefined,
                  total: usage?.prompt_tokens,
                  cacheRead: usage?.prompt_cache_hit_tokens,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: usage?.completion_tokens,
                  text: undefined,
                  reasoning: usage?.completion_tokens_details?.reasoning_tokens
                }
              })
            })
          ]
        }).pipe(
          // Do not retain raw errors, headers or response bodies: they can contain credentials.
          Effect.catchTags({
            HttpClientError: (error) =>
              Match.value(error.reason).pipe(
                Match.tagsExhaustive({
                  TransportError: (reason) => Effect.fail(networkError(reason)),
                  EncodeError: (reason) => Effect.fail(networkError(reason)),
                  InvalidUrlError: (reason) => Effect.fail(networkError(reason)),
                  StatusCodeError: (reason) => Effect.fail(statusError(reason)),
                  DecodeError: () =>
                    Effect.fail(invalidOutput("The response body could not be decoded")),
                  EmptyBodyError: () =>
                    Effect.fail(invalidOutput("The response body could not be decoded"))
                })
              ),
            HttpBodyError: () => Effect.fail(unsupported("Could not encode the request as JSON")),
            // Fixed description: the schema error message can echo the response body.
            SchemaError: () =>
              Effect.fail(
                invalidOutput("The response did not match the expected Chat Completions envelope")
              )
          })
        ),
      streamText: () => Stream.fail(unsupported("Streaming is not supported by this provider"))
    })
  })

/**
 * Supplies Effect AI's `LanguageModel` from DeepSeek Chat Completions.
 *
 * **When to use**
 *
 * Use to run a `Predict` or `LanguageModel.generateObject` against DeepSeek;
 * provide an `HttpClient` such as `FetchHttpClient.layer`.
 *
 * **Details**
 *
 * JSON mode guides generation with a JSON Schema prompt; Effect AI still
 * decodes the original Effect Schema, including refinements, transformations,
 * and context requirements. Tools, multimodal prompts, and streaming are
 * deliberately unsupported. No automatic retries or timeout are installed.
 *
 * @category layers
 * @since 0.1.0
 */
export const layer = (
  options: Options
): Layer.Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient> =>
  Layer.effect(LanguageModel.LanguageModel, make(options))

/**
 * Supplies Effect AI's `LanguageModel` from Effect Config.
 *
 * **When to use**
 *
 * Use to read the credential and endpoint from the ConfigProvider instead of
 * hard-coding them.
 *
 * **Details**
 *
 * Reads `DEEPSEEK_API_KEY` (required, kept redacted), `DEEPSEEK_MODEL`
 * (defaults to `deepseek-flash`), and `DEEPSEEK_BASE_URL` (defaults to
 * `https://api.deepseek.com`). Use only a trusted endpoint: it receives the
 * API key and prompt. `maxTokens` defaults to 1,024 and thinking is disabled.
 *
 * @category layers
 * @since 0.1.0
 */
export const layerFromEnv = (
  options?: Pick<Options, "maxTokens" | "temperature">
): Layer.Layer<LanguageModel.LanguageModel, Config.ConfigError, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const apiKey = yield* Config.redacted("DEEPSEEK_API_KEY")

      const model = yield* Config.string("DEEPSEEK_MODEL").pipe(
        Config.withDefault("deepseek-flash")
      )

      const baseUrl = yield* Config.string("DEEPSEEK_BASE_URL").pipe(
        Config.withDefault("https://api.deepseek.com")
      )

      return layer({ ...options, apiKey, model, baseUrl })
    })
  )
