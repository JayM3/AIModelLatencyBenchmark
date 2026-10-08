import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeSavedBenchmark } from "./saved-benchmark.ts";
import type { SavedBenchmark } from "./types.ts";

/** A single-process history store with queued mutations and atomic replacement. */
export function createHistoryStore(directory: string) {
  const dataDirectory = path.resolve(directory);
  const filename = path.join(dataDirectory, "history.json");
  let pending: Promise<void> = Promise.resolve();

  async function readFile(): Promise<SavedBenchmark[]> {
    let content: string;
    try {
      content = await fs.readFile(filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Windows can report ENOENT even when the parent is a regular file.
        const parent = await fs.stat(dataDirectory).catch((parentError: NodeJS.ErrnoException) => {
          if (parentError.code === "ENOENT") return undefined;
          throw parentError;
        });
        if (parent && !parent.isDirectory()) throw new Error("History path must be a directory");
        return [];
      }
      throw error;
    }
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error("History file must contain an array");
    return parsed.map(normalizeSavedBenchmark);
  }

  async function writeFile(items: SavedBenchmark[]): Promise<void> {
    await fs.mkdir(dataDirectory, { recursive: true });
    const temporary = path.join(dataDirectory, ".history-" + randomUUID() + ".tmp");
    try {
      await fs.writeFile(temporary, JSON.stringify(items, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.rename(temporary, filename);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  function mutate(update: (items: SavedBenchmark[]) => SavedBenchmark[]): Promise<SavedBenchmark[]> {
    const operation = pending.then(async () => {
      // Do not silently replace corrupt or unreadable history with an empty file.
      const updated = update(await readFile());
      await writeFile(updated);
      return updated;
    });
    // A failed operation must not poison the queue for later, repaired requests.
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    async read(): Promise<SavedBenchmark[]> {
      await pending;
      return readFile();
    },
    save(value: SavedBenchmark): Promise<SavedBenchmark[]> {
      const item = normalizeSavedBenchmark(value);
      return mutate((history) => {
        const exists = history.some((saved) => saved.id === item.id);
        return exists ? history.map((saved) => saved.id === item.id ? item : saved) : [item, ...history];
      });
    },
    remove(id: string): Promise<SavedBenchmark[]> {
      return mutate((history) => id === "all" ? [] : history.filter((item) => item.id !== id));
    },
  };
}
