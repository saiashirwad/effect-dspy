import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { DeepSeek, Predict, Signature } from "../src/index.ts"

const secret = "sk-synthetic-secret"

const provider = (
  respond: (request: Request) => Response,
  options: Partial<DeepSeek.Options> = {}
) => {
  const requests: Array<Request> = []

  const layer = DeepSeek.layer({
    apiKey: Redacted.make(secret),
    model: "test-model",
    baseUrl: "https://deepseek.invalid/v1/",
    ...options
  }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, async (input, init) => {
      const request = new Request(input, init)
      requests.push(request.clone())

      return respond(request)
    }))
  )

  return { layer, requests }
}

const answer = Predict.make(
  "answer",
  Signature.make(
    Schema.Struct({ question: Schema.String }),
    Schema.Struct({ answer: Schema.FiniteFromString })
  )
).pipe(Predict.withInstructions("Answer with a number."))

describe("DeepSeek", () => {
  it.effect("runs a predictor through Chat Completions JSON mode", () => {
    const { layer, requests } = provider(() =>
      Response.json({
        choices: [{ message: { content: "{\"answer\":\"42\"}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }
      })
    )

    return Effect.gen(function*() {
      expect(yield* answer.run({ question: "6 * 7?" })).toEqual({ answer: 42 })

      const [request] = requests
      const body = yield* Effect.promise(() => request.json())

      expect(request.url).toBe("https://deepseek.invalid/v1/chat/completions")
      expect(request.headers.get("authorization")).toBe(`Bearer ${secret}`)
      expect(body).toMatchObject({ model: "test-model", response_format: { type: "json_object" } })
      expect(body.messages[0]).toMatchObject({ role: "system" })
      expect(body.messages.at(-1).content).toContain("Answer with a number.")
    }).pipe(Effect.provide(layer))
  })

  it.effect.each(
    [
      ["an HTTP error", () => Response.json({ error: secret }, { status: 401 }), {}],
      [
        "a truncated response",
        () =>
          Response.json({ choices: [{ message: { content: secret }, finish_reason: "length" }] }),
        {}
      ],
      ["an unsafe base URL", () => Response.json({}), {
        baseUrl: `https://user:${secret}@deepseek.invalid`
      }]
    ] as const
  )("fails with a typed AiError on %s without leaking credentials", ([, respond, options]) => {
    const { layer } = provider(respond, options)

    return Effect.gen(function*() {
      const error = yield* answer.run({ question: "?" }).pipe(Effect.flip)

      expect(error._tag).toBe("AiError")

      for (
        const rendered of [String(error), JSON.stringify(error), Cause.pretty(Cause.fail(error))]
      ) {
        expect(rendered).not.toContain(secret)
      }
    }).pipe(Effect.provide(layer))
  })
})
