import "./test-env";
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalFilesystemStorage } from "./storage";

let root: string;
let storage: LocalFilesystemStorage;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "worktruth-storage-test-"));
  storage = new LocalFilesystemStorage(root);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalFilesystemStorage", () => {
  test("save() writes the buffer and returns a storage key under projects/<id>/", async () => {
    const buffer = Buffer.from("evidence photo bytes");
    const key = await storage.save("P-1001", buffer, "jpg");
    assert.match(key, /^projects\/P-1001\/[0-9a-f-]+\.jpg$/);
  });

  test("save() generates a different key (and filename) on every call, even for identical bytes", async () => {
    const buffer = Buffer.from("same bytes twice");
    const keyA = await storage.save("P-1002", buffer, "png");
    const keyB = await storage.save("P-1002", buffer, "png");
    assert.notEqual(keyA, keyB);
  });

  test("read() returns exactly what save() wrote", async () => {
    const buffer = Buffer.from("round trip check");
    const key = await storage.save("P-1003", buffer, "png");
    const readBack = await storage.read(key);
    assert.ok(readBack.equals(buffer));
    const raw = await readFile(path.join(root, key));
    assert.ok(raw.equals(buffer));
  });

  test("delete() removes the file", async () => {
    const buffer = Buffer.from("temporary");
    const key = await storage.save("P-1004", buffer, "jpg");
    await storage.delete(key);
    await assert.rejects(() => storage.read(key));
  });

  test("delete() of an already-missing file does not throw", async () => {
    await assert.doesNotReject(() => storage.delete("projects/P-1004/does-not-exist.jpg"));
  });

  test("save() rejects a project id that isn't a safe path segment", async () => {
    const buffer = Buffer.from("x");
    await assert.rejects(() => storage.save("../escape", buffer, "jpg"));
    await assert.rejects(() => storage.save("P-1001/evil", buffer, "jpg"));
  });

  test("save() rejects an unsafe/unexpected extension", async () => {
    const buffer = Buffer.from("x");
    await assert.rejects(() => storage.save("P-1005", buffer, "jpg; rm -rf"));
    await assert.rejects(() => storage.save("P-1005", buffer, ""));
  });

  test("read() rejects a storage key crafted to escape the storage root", async () => {
    await assert.rejects(() => storage.read("../../etc/passwd"));
    await assert.rejects(() => storage.read("projects/../../outside.jpg"));
  });
});
