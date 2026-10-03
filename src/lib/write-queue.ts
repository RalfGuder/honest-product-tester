const writeQueues =
  globalThis.__honestProductTesterWriteQueues ?? new Map<string, Promise<unknown>>();

globalThis.__honestProductTesterWriteQueues = writeQueues;

declare global {
  var __honestProductTesterWriteQueues: Map<string, Promise<unknown>> | undefined;
}

/** Serializes async writes that share a key, so read-modify-write cycles never interleave. */
export async function queueWrite<T>(key: string, task: () => Promise<T>) {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);

  writeQueues.set(key, next);

  try {
    return await next;
  } finally {
    if (writeQueues.get(key) === next) {
      writeQueues.delete(key);
    }
  }
}
