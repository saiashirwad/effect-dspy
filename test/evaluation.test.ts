import { describe, expect, it } from "@effect/vitest"
import { Data, Deferred, Effect, Exit, Fiber, Ref, Schema } from "effect"
import {
  Compiler,
  Dataset,
  Evaluation,
  Metric,
  MetricValidationError,
  Node,
  Observation,
  Optimizer,
  Program,
  Signature
} from "../src/index.ts"

const signature = Signature.make(Schema.Finite, Schema.Finite)

const row = Schema.Struct({ id: Schema.String, input: Schema.Finite, expected: Schema.Finite })

const exact = Metric.make(
  "exact",
  (c: Evaluation.Case<number, number, number>) => Effect.succeed(c.actual === c.expected ? 1 : 0)
)

// A node whose output is the input scaled by its first learned demonstration. It
// yields before reading, so concurrent evaluations interleave before either reads
// parameters: a parameter scope shared across evaluations would leak into the output.
const scale: Node.Node<number, number> = {
  [Node.TypeId]: Node.TypeId,
  id: "scale",
  signature,
  tuning: { demonstrations: true },
  fixed: Effect.succeed({ kind: "scale" })
}

const runScale = (n: number) =>
  Effect.gen(function*() {
    yield* Effect.yieldNow
    const [demo] = yield* Node.learned(scale)
    const output = demo === undefined ? n : n * (demo.output / demo.input)
    yield* Observation.record({ nodeId: scale.id, input: n, exit: Exit.succeed(output) })

    return output
  })

const program = Program.make("scaling", runScale).pipe(
  Program.withSignature(signature),
  Program.withNodes(scale),
  Program.withRevision("1")
)

class ProgramBoom extends Data.TaggedError("ProgramBoom")<{ readonly message: string }> {}

class GraderBoom extends Data.TaggedError("GraderBoom")<{ readonly message: string }> {}

const twofold = () =>
  Dataset.fromIterable("twofold", row, [
    { id: "a", input: 1, expected: 2 },
    { id: "b", input: 2, expected: 4 }
  ])

const tenfold = () =>
  Dataset.fromIterable("tenfold", row, [
    { id: "a", input: 1, expected: 10 },
    { id: "b", input: 2, expected: 20 }
  ])

describe("evaluation runtime guarantees", () => {
  it.effect("isolates parameter scopes between concurrent candidate evaluations", () =>
    Effect.gen(function*() {
      const doubles = yield* twofold()
      const tens = yield* tenfold()

      const observed = yield* Ref.make<
        Array<{ readonly tag: string; readonly scores: ReadonlyArray<number> }>
      >([])

      const record = (tag: string) => (report: Evaluation.Report) =>
        Ref.update(observed, (all) => {
          all.push({ tag, scores: report.scores.map((score) => score.score) })

          return all
        })

      const optimizer = Optimizer.make<number, number, never, never>(
        "concurrent",
        { candidates: 2 },
        (context) =>
          Effect.gen(function*() {
            const [doubled] = yield* Effect.all([
              context.evaluate(doubles, { scale: [{ input: 1, output: 2 }] }).pipe(
                Effect.tap(record("doubles"))
              ),
              context.evaluate(tens, { scale: [{ input: 1, output: 10 }] }).pipe(
                Effect.tap(record("tens"))
              )
            ], { concurrency: 2 })

            return { parameters: {}, report: doubled }
          })
      )

      yield* program.pipe(
        Compiler.compile(
          optimizer,
          Evaluation.make(doubles, exact).pipe(Evaluation.withConcurrency(2))
        )
      )

      const captured = new Map((yield* Ref.get(observed)).map((entry) => [entry.tag, entry.scores]))

      // Each evaluation graded its whole dataset with its own parameters and never the other's.
      expect(captured.get("doubles")).toEqual([1, 1])
      expect(captured.get("tens")).toEqual([1, 1])

      // The source program was never handed candidate parameters.
      expect(yield* program.run(3)).toBe(3)
    }))

  it.effect("isolates parameter scopes between concurrent runs of linked programs", () =>
    Effect.gen(function*() {
      const doubles = yield* twofold()
      const tens = yield* tenfold()

      const pick = (output: number) =>
        Optimizer.make<number, number, never, never>(
          `pick-${output}`,
          { output },
          (context): Effect.Effect<Optimizer.Candidate> =>
            Effect.succeed({
              parameters: { scale: [{ input: 1, output }] },
              report: context.baseline
            })
        )

      const doubledArtifact = yield* program.pipe(
        Compiler.compile(pick(2), Evaluation.make(doubles, exact))
      )

      const tennedArtifact = yield* program.pipe(
        Compiler.compile(pick(10), Evaluation.make(tens, exact))
      )

      const doubledProgram = yield* program.pipe(Program.link(doubledArtifact))
      const tennedProgram = yield* program.pipe(Program.link(tennedArtifact))

      const [doubled, tenned] = yield* Effect.all([
        Evaluation.run(
          doubledProgram,
          Evaluation.make(doubles, exact).pipe(Evaluation.withConcurrency(2))
        ),
        Evaluation.run(
          tennedProgram,
          Evaluation.make(tens, exact).pipe(Evaluation.withConcurrency(2))
        )
      ], { concurrency: 2 })

      // Parameters swapped between the concurrent runs would score either report zero.
      expect(doubled.meanScore).toBe(1)
      expect(tenned.meanScore).toBe(1)

      // Linking never mutates the source program.
      expect(yield* program.run(2)).toBe(2)
    }))

  it.effect("grades outside candidate parameter and observation scope", () =>
    Effect.gen(function*() {
      const validation = yield* Dataset.fromIterable("validation", row, [
        { id: "a", input: 3, expected: 6 }
      ])

      const scopes = yield* Ref.make<
        Array<{ readonly parameters: Node.Parameters; readonly inventory: unknown }>
      >([])

      const nodeIds = yield* Ref.make<Array<string>>([])

      const grading = Metric.make(
        "grading",
        (c: Evaluation.Case<number, number, number>) =>
          Effect.gen(function*() {
            const { parameters, inventory } = yield* Node.CurrentParameters
            yield* Ref.update(scopes, (all) => {
              all.push({ parameters, inventory })

              return all
            })
            yield* Observation.record({
              nodeId: "grader",
              input: c.input,
              exit: Exit.succeed("graded")
            })

            return c.actual === c.expected ? 1 : 0
          })
      )

      const candidate: Node.Parameters = { scale: [{ input: 1, output: 2 }] }

      const optimizer = Optimizer.make<number, number, never, never>(
        "candidate",
        { demonstrations: 1 },
        (context) =>
          Effect.gen(function*() {
            const report = yield* context.evaluate(context.validation, candidate)
            yield* Ref.update(nodeIds, (all) => {
              for (const score of report.scores) {
                for (const observation of score.observations) all.push(observation.nodeId)
              }

              return all
            })

            return { parameters: candidate, report }
          })
      )

      const artifact = yield* program.pipe(
        Compiler.compile(optimizer, Evaluation.make(validation, grading))
      )

      // The candidate parameters reached the program: the baseline scores zero, the candidate one.
      expect(artifact.results.baseline.meanScore).toBe(0)
      expect(artifact.results.selected.meanScore).toBe(1)

      // Every grader invocation saw the default scope, never the candidate parameters or inventory.
      const captured = yield* Ref.get(scopes)
      expect(captured).toHaveLength(2)

      for (const scope of captured) {
        expect(scope.parameters).toEqual({})
        expect(scope.inventory).toBeUndefined()
      }

      // The grader's own observation was discarded, not mixed into the program's.
      expect(yield* Ref.get(nodeIds)).toEqual(["scale"])
    }))

  it.effect("fails fast with the original program and grader errors", () =>
    Effect.gen(function*() {
      const cases = yield* Dataset.fromIterable("cases", row, [
        { id: "a", input: 1, expected: 2 },
        { id: "b", input: 2, expected: 4 }
      ])

      const failing = Program.make<number, number, ProgramBoom, never>("failing", (n) =>
        n === 1
          ? Effect.fail(new ProgramBoom({ message: "program exploded" }))
          : Effect.succeed(n * 2))

      const programError = yield* Evaluation.run(failing, Evaluation.make(cases, exact)).pipe(
        Effect.flip
      )

      expect(programError).toBeInstanceOf(ProgramBoom)
      expect(programError).toMatchObject(new ProgramBoom({ message: "program exploded" }))

      const failingMetric = Metric.make<
        Evaluation.Case<number, number, number>,
        number,
        GraderBoom,
        never
      >("failing-grader", () => Effect.fail(new GraderBoom({ message: "grader exploded" })))

      const graderError = yield* Evaluation.run(program, Evaluation.make(cases, failingMetric))
        .pipe(
          Effect.flip
        )

      expect(graderError).toBeInstanceOf(GraderBoom)
      expect(graderError).toMatchObject(new GraderBoom({ message: "grader exploded" }))

      const outOfRange = Metric.make<Evaluation.Case<number, number, number>, number, never, never>(
        "out-of-range",
        () => Effect.succeed(3)
      )

      const scoreError = yield* Evaluation.run(program, Evaluation.make(cases, outOfRange)).pipe(
        Effect.flip
      )

      expect(scoreError).toBeInstanceOf(MetricValidationError)
      expect(scoreError._tag).toBe("MetricValidationError")
    }))

  it.effect("propagates interruption to in-flight program runs", () =>
    Effect.gen(function*() {
      const cases = yield* Dataset.fromIterable("cases", row, [
        { id: "a", input: 1, expected: 2 }
      ])

      const started = yield* Deferred.make<void>()
      const interrupted = yield* Ref.make(false)

      const slow = Program.make<number, number, never, never>("slow", () =>
        Effect.onInterrupt(
          Effect.gen(function*() {
            yield* Deferred.succeed(started, void 0)

            return yield* Effect.never
          }),
          () => Ref.set(interrupted, true)
        ))

      const fiber = yield* Evaluation.run(slow, Evaluation.make(cases, exact)).pipe(
        Effect.forkChild
      )

      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)

      expect(yield* Ref.get(interrupted)).toBe(true)
      expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true)
    }))
})
