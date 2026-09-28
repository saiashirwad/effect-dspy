import * as Effect from "effect/Effect"
import type * as Artifact from "../Artifact.ts"
import { ConfigurationError } from "../Errors.ts"
import type * as Node from "../Node.ts"
import type { Program } from "../Program.ts"
import { signatureFingerprint } from "./fingerprint.ts"
import { hash } from "./util.ts"

/** @internal */
export type Manifest = Artifact.Artifact["manifest"]

/** @internal */
export const inventory = <R>(
  program: Program<any, any, any, R>
): Effect.Effect<ReadonlyMap<string, Node.Node<any, any, R>>, ConfigurationError> =>
  Effect.gen(function*() {
    const nodes = new Map<string, Node.Node<any, any, R>>()

    for (const node of program.nodes) {
      if (node.id.trim() === "") {
        return yield* new ConfigurationError({ message: `Invalid node ID: ${node.id}` })
      }

      if (nodes.has(node.id) && nodes.get(node.id) !== node) {
        return yield* new ConfigurationError({
          message: `Distinct node definitions share ID: ${node.id}`
        })
      }

      nodes.set(node.id, node)
    }

    return nodes
  })

/** @internal */
export const make = <I, O, E, R>(
  program: Program<I, O, E, R>
): Effect.Effect<Manifest, ConfigurationError, R> =>
  Effect.gen(function*() {
    const { signature, revision } = program

    if (!program.id.trim() || !revision.trim() || signature === undefined) {
      return yield* new ConfigurationError({
        message: "Compilation and linking require a program ID, signature, and revision"
      })
    }

    const nodes = yield* inventory(program)

    const fixed = yield* Effect.forEach(nodes.values(), (node) => node.fixed)

    return yield* Effect.try(() => ({
      signature: signatureFingerprint(signature),
      nodes: [...nodes.values()].map((node, index) => ({
        id: node.id,
        signature: signatureFingerprint(node.signature),
        fixed: hash(fixed[index])
      })).sort((a, b) => a.id.localeCompare(b.id))
    }))
  }).pipe(
    Effect.catchTags({
      SchemaError: (cause) => Effect.fail(fingerprintError(cause)),
      UnknownError: (cause) => Effect.fail(fingerprintError(cause))
    })
  )

const fingerprintError = (cause: Error) =>
  new ConfigurationError({ message: `Cannot fingerprint program: ${cause.message}`, cause })
