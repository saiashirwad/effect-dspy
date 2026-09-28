/**
 * Tagged errors raised across `effect-dspy`.
 *
 * Each failure is a `Data.TaggedError` so callers recover by `_tag` through
 * `Effect.catchTag` while preserving the typed error channel. The classes are
 * re-exported flat from the package entry point.
 *
 * @since 0.1.0
 */
import * as Data from "effect/Data"

/**
 * Failure raised when a definition or configuration is invalid.
 *
 * @category errors
 * @since 0.1.0
 */
export class ConfigurationError extends Data.TaggedError("ConfigurationError")<
  { readonly message: string; readonly cause?: unknown }
> {}

/**
 * Failure raised while reading, decoding, or splitting a dataset.
 *
 * @category errors
 * @since 0.1.0
 */
export class DatasetError
  extends Data.TaggedError("DatasetError")<{ readonly message: string; readonly cause?: unknown }>
{}

/**
 * Failure raised when a metric produces an invalid score.
 *
 * @category errors
 * @since 0.1.0
 */
export class MetricValidationError extends Data.TaggedError("MetricValidationError")<
  { readonly message: string; readonly cause?: unknown }
> {}

/**
 * Failure raised when an artifact is malformed or incompatible.
 *
 * @category errors
 * @since 0.1.0
 */
export class ArtifactError
  extends Data.TaggedError("ArtifactError")<{ readonly message: string; readonly cause?: unknown }>
{}
