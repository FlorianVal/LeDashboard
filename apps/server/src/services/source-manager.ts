import type Database from "better-sqlite3";
import type {
  CollectionResult,
  Collector,
  CurrentValueInput,
  MetricSampleInput,
} from "../collectors/types.js";

export type SourceState = {
  sourceId: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

type SourceStateRow = {
  source_id: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
};

export class SourceRepository {
  constructor(private readonly sqlite: Database.Database) {}

  recordAttempt(sourceId: string, attemptedAt: string): void {
    this.sqlite.prepare(`
      INSERT INTO source_state (source_id, last_attempt_at)
      VALUES (?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at
    `).run(sourceId, attemptedAt);
  }

  recordFailure(sourceId: string, attemptedAt: string, error: string): void {
    this.sqlite.prepare(`
      INSERT INTO source_state (source_id, last_attempt_at, last_error)
      VALUES (?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_error = excluded.last_error
    `).run(sourceId, attemptedAt, error);
  }

  commitSuccess(
    sourceId: string,
    attemptedAt: string,
    result: CollectionResult,
  ): void {
    const insertSample = this.sqlite.prepare(`
      INSERT OR IGNORE INTO samples_raw (metric_key, ts, value)
      VALUES (?, ?, ?)
    `);
    const upsertCurrentValue = this.sqlite.prepare(`
      INSERT INTO current_values (key, ts, numeric_value, text_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        ts = excluded.ts,
        numeric_value = excluded.numeric_value,
        text_value = excluded.text_value
    `);
    const recordSuccess = this.sqlite.prepare(`
      INSERT INTO source_state
        (source_id, last_attempt_at, last_success_at, last_error)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(source_id) DO UPDATE SET
        last_attempt_at = excluded.last_attempt_at,
        last_success_at = excluded.last_success_at,
        last_error = NULL
    `);

    const commit = this.sqlite.transaction(
      (
        samples: readonly MetricSampleInput[],
        currentValues: readonly CurrentValueInput[],
      ) => {
        for (const sample of samples) {
          insertSample.run(sample.key, sample.ts, sample.value);
        }
        for (const value of currentValues) {
          upsertCurrentValue.run(
            value.key,
            value.ts,
            value.numericValue ?? null,
            value.textValue ?? null,
          );
        }
        recordSuccess.run(sourceId, attemptedAt, attemptedAt);
      },
    );

    commit(result.samples, result.currentValues);
  }

  getSourceState(sourceId: string): SourceState | null {
    const row = this.sqlite.prepare(`
      SELECT source_id, last_attempt_at, last_success_at, last_error
      FROM source_state
      WHERE source_id = ?
    `).get(sourceId) as SourceStateRow | undefined;

    return row
      ? {
          sourceId: row.source_id,
          lastAttemptAt: row.last_attempt_at,
          lastSuccessAt: row.last_success_at,
          lastError: row.last_error,
        }
      : null;
  }
}

export class SourceManager {
  private readonly intervals = new Map<
    string,
    ReturnType<typeof setInterval>
  >();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repository: SourceRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runOnce(collector: Collector): Promise<void> {
    const attemptedAt = this.now().toISOString();
    this.repository.recordAttempt(collector.id, attemptedAt);

    let result: CollectionResult;
    try {
      result = await collector.collect();
    } catch {
      const error = new Error(`Collection failed for ${collector.id}`);
      this.repository.recordFailure(collector.id, attemptedAt, error.message);
      throw error;
    }

    if (collector.requiresSamples && result.samples.length === 0) {
      const error = new Error(`${collector.id} returned no required samples`);
      this.repository.recordFailure(collector.id, attemptedAt, error.message);
      throw error;
    }

    try {
      this.repository.commitSuccess(collector.id, attemptedAt, result);
    } catch {
      const error = new Error(`Collection failed for ${collector.id}`);
      this.repository.recordFailure(collector.id, attemptedAt, error.message);
      throw error;
    }
  }

  private runScheduled(collector: Collector): void {
    if (this.inFlight.has(collector.id)) return;
    this.inFlight.add(collector.id);
    void this.runOnce(collector)
      .catch(() => undefined)
      .finally(() => this.inFlight.delete(collector.id));
  }

  start(collectors: readonly Collector[]): void {
    for (const collector of collectors) {
      const existing = this.intervals.get(collector.id);
      if (existing) clearInterval(existing);

      const run = () => this.runScheduled(collector);

      run();
      this.intervals.set(
        collector.id,
        setInterval(run, collector.intervalSeconds * 1000),
      );
    }
  }

  stop(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}
