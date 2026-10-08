import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createHistoryStore } from "../src/lib/history-store.ts";
import { savedBenchmark } from "./saved-benchmark-fixture.ts";

async function temporaryHistory(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), "model-bench-history-"));
  t.after(async () => {
    const target = path.resolve(directory);
    // Only remove the dedicated temporary directory created by this test.
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith("model-bench-history-")) {
      throw new Error("Refusing to remove an unexpected test directory");
    }
    await fs.rm(target, { recursive: true, force: true });
  });
  return { directory, filename: path.join(directory, "history.json"), store: createHistoryStore(directory) };
}

test("history reads return an empty array without creating a missing data directory", async (t) => {
  const { directory } = await temporaryHistory(t);
  const missing = path.join(directory, "not-created");
  assert.deepEqual(await createHistoryStore(missing).read(), []);
  await assert.rejects(fs.stat(missing), { code: "ENOENT" });
});

test("history saves create storage, update existing IDs, and survive a new store instance", async (t) => {
  const { directory, store } = await temporaryHistory(t);
  await store.save(savedBenchmark({ id: "a" }));
  await store.save(savedBenchmark({ id: "b" }));
  await store.save(savedBenchmark({ id: "a", name: "Updated" }));
  const history = await createHistoryStore(directory).read();
  assert.deepEqual(history.map((item) => item.id), ["b", "a"]);
  assert.equal(history[1]!.name, "Updated");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["history.json"]);
});

test("queued concurrent history saves do not lose records", async (t) => {
  const { store } = await temporaryHistory(t);
  const operations = Array.from({ length: 12 }, (_, index) => store.save(savedBenchmark({ id: "run-" + index })));
  const read = store.read();
  await Promise.all(operations);
  const history = await read;
  assert.equal(history.length, 12);
  assert.equal(new Set(history.map((item) => item.id)).size, 12);
});

test("history queues saves and deletes in order and supports clearing all records", async (t) => {
  const { store } = await temporaryHistory(t);
  await Promise.all([
    store.save(savedBenchmark({ id: "a" })),
    store.save(savedBenchmark({ id: "b" })),
    store.remove("a"),
    store.save(savedBenchmark({ id: "c" })),
  ]);
  assert.deepEqual((await store.read()).map((item) => item.id), ["c", "b"]);
  assert.deepEqual(await store.remove("all"), []);
  assert.deepEqual(await store.read(), []);
});

test("history persistence strips credential fields from new and legacy records", async (t) => {
  const { filename, store } = await temporaryHistory(t);
  const marker = "fixture-secret-marker";
  const record = { ...savedBenchmark(), apiKey: marker, headers: { Authorization: marker } };
  await store.save(record);
  assert.equal((await fs.readFile(filename, "utf8")).includes(marker), false);
  await fs.writeFile(filename, JSON.stringify([record]));
  assert.equal(JSON.stringify(await store.read()).includes(marker), false);
  await store.save(savedBenchmark({ id: "new" }));
  assert.equal((await fs.readFile(filename, "utf8")).includes(marker), false);
});

test("corrupt or invalid history is reported without overwriting the original file", async (t) => {
  const { filename, store } = await temporaryHistory(t);
  for (const content of ["{broken", "{}", '[{"id":"invalid"}]']) {
    await fs.writeFile(filename, content);
    await assert.rejects(store.read());
    await assert.rejects(store.save(savedBenchmark()));
    await assert.rejects(store.remove("all"));
    assert.equal(await fs.readFile(filename, "utf8"), content);
  }
});

test("history mutation queue recovers after a corrupt file is repaired", async (t) => {
  const { filename, store } = await temporaryHistory(t);
  await fs.writeFile(filename, "not JSON");
  await assert.rejects(store.save(savedBenchmark()));
  await fs.writeFile(filename, "[]");
  await store.save(savedBenchmark());
  assert.equal((await store.read()).length, 1);
});

test("history does not treat other filesystem errors as an empty history", async (t) => {
  const { directory } = await temporaryHistory(t);
  const blocked = path.join(directory, "regular-file");
  await fs.writeFile(blocked, "not a directory");
  const store = createHistoryStore(blocked);
  await assert.rejects(store.read());
  await assert.rejects(store.save(savedBenchmark()));
  assert.equal(await fs.readFile(blocked, "utf8"), "not a directory");
});
