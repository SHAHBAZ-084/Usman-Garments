/** Serialize SQLite writes so overlapping deletes cannot lock the UI. */
let queue: Promise<unknown> = Promise.resolve();

export function withSqliteWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
