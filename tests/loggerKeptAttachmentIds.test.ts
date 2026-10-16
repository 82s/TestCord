/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { transformSync } from "esbuild";

// Attachment pruning walks every old log record. A record without an
// attachments array must not throw, or the cursor walk dies mid-transaction.
const source = readFileSync(new URL("../src/testcordplugins/messageLoggerTestcord/db.ts", import.meta.url), "utf8");

function loadDb(records: unknown[]) {
    const cursorAt = (i: number): unknown => i < records.length
        ? { value: records[i], continue: async () => cursorAt(i + 1) }
        : null;
    const fakeDb = {
        transaction: () => ({ store: { index: () => ({ openCursor: async () => cursorAt(0) }) } })
    };
    const modules: Record<string, unknown> = {
        "@webpack/common": { lodash: {} },
        idb: { openDB: async () => fakeDb },
        "./search": { createSearchMatcher: () => () => true },
        "./types": {},
        "./utils": { embedFingerprint: () => "" }
    };
    const module = { exports: {} as Record<string, unknown> };
    const sandbox = {
        module, exports: module.exports,
        require: (name: string) => modules[name],
        IDBKeyRange: { upperBound: (value: unknown) => value },
        Promise, Set, Map, Date, Object, Array, JSON, Math
    };
    vm.createContext(sandbox);
    vm.runInContext(transformSync(source, { loader: "ts", format: "cjs" }).code, sandbox);
    return module.exports as { getKeptAttachmentIds(cutoffMs: number, preservedChannelId?: string): Promise<Set<string>>; };
}

test("Kept attachment ids skip records without attachment arrays", async () => {
    const db = loadDb([
        { protected: true, channel_id: "c1", message: {} },
        { protected: true, channel_id: "c1", message: { attachments: null, editHistory: [{}, { attachments: [{ id: "222" }] }] } },
        { protected: false, channel_id: "open", message: { attachments: [{ id: "333" }, null] } },
        { protected: false, channel_id: "c2", message: { attachments: [{ id: "444" }] } },
        { protected: true, channel_id: "c1" }
    ]);
    const kept = await db.getKeptAttachmentIds(Date.now(), "open");
    assert.deepEqual([...kept].sort(), ["222", "333"]);
});
