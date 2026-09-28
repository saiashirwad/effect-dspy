/**
 * Records of node executions and the service that receives them.
 *
 * Nodes report each execution to the current {@link Observer}. Evaluation
 * installs an observer that collects the records per example, which is how
 * optimizers see intermediate traces; applications can install their own
 * observer to log or export them.
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import type * as Response from "effect/unstable/ai/Response"

/**
 * One execution of a node.
 *
 * @category models
 * @since 0.1.0
 */
export interface Observation {
  readonly nodeId: string
  readonly input: unknown
  readonly exit: Exit.Exit<unknown, unknown>
  readonly usage?: Response.Usage | undefined
}

/**
 * Receives node executions.
 *
 * @category models
 * @since 0.1.0
 */
export interface Observer {
  readonly record: (observation: Observation) => Effect.Effect<void>
}

/**
 * The observer in scope. Defaults to discarding observations.
 *
 * @category references
 * @since 0.1.0
 */
export const Observer: Context.Reference<Observer> = Context.Reference(
  "effect-dspy/Observation/Observer",
  { defaultValue: (): Observer => ({ record: () => Effect.void }) }
)

/**
 * Reports an execution to the observer in scope.
 *
 * @category recording
 * @since 0.1.0
 */
export const record = (observation: Observation): Effect.Effect<void> =>
  Effect.flatMap(Observer, (observer) => observer.record(observation))
