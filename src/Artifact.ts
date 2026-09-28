/**
 * The serialized result of compiling a program.
 *
 * An `Artifact` records which program, revision, and fixed configuration it was
 * compiled for (the manifest), the learned parameters as encoded JSON, where
 * they came from, and the baseline and selected validation scores.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"
import { ArtifactError } from "./Errors.ts"
import { Score } from "./internal/util.ts"

const Id = Schema.String.check(
  Schema.isPattern(/\S/, { message: "Expected a nonblank identifier" })
)

const Summary = Schema.Struct({
  meanScore: Score,
  scores: Schema.Array(Schema.Struct({ id: Schema.String, score: Score }))
})

/**
 * Schema for compiled artifacts.
 *
 * @category schemas
 * @since 0.1.0
 */
export const Artifact = Schema.Struct({
  version: Schema.Literal(1),
  programId: Id,
  revision: Id,
  manifest: Schema.Struct({
    signature: Schema.NonEmptyString,
    nodes: Schema.Array(
      Schema.Struct({ id: Id, signature: Schema.NonEmptyString, fixed: Schema.NonEmptyString })
    )
  }),
  parameters: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Struct({ input: Schema.Json, output: Schema.Json }))
  ),
  provenance: Schema.Struct({
    optimizer: Schema.Struct({ name: Schema.String, settings: Schema.Json }),
    validation: Schema.Json,
    metric: Schema.String
  }),
  results: Schema.Struct({ baseline: Summary, selected: Summary })
}).check(
  Schema.makeFilter((artifact) => {
    const ids = new Set(artifact.manifest.nodes.map(Struct.get("id")))

    return ids.size === artifact.manifest.nodes.length
      && Object.keys(artifact.parameters).every((id) => ids.has(id))
  }, { message: "Manifest node IDs must be unique and parameters must target manifest nodes" })
)

/**
 * A compiled artifact.
 *
 * @category models
 * @since 0.1.0
 */
export type Artifact = typeof Artifact.Type

const Json = Schema.fromJsonString(Artifact)

/**
 * Serializes an artifact to a JSON string.
 *
 * @category encoding
 * @since 0.1.0
 */
export const encode = (artifact: Artifact): Effect.Effect<string, ArtifactError> =>
  Schema.encodeEffect(Json)(artifact).pipe(
    Effect.mapError((cause) =>
      new ArtifactError({ message: `Invalid artifact: ${cause.message}`, cause })
    )
  )

/**
 * Parses and validates an artifact from a JSON string.
 *
 * @category decoding
 * @since 0.1.0
 */
export const decode = (json: string): Effect.Effect<Artifact, ArtifactError> =>
  Schema.decodeEffect(Json)(json, { onExcessProperty: "error" }).pipe(
    Effect.mapError((cause) =>
      new ArtifactError({ message: `Invalid artifact: ${cause.message}`, cause })
    )
  )
