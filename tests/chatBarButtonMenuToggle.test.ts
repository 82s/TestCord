import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SettingsStore } from "../src/shared/SettingsStore.ts";

function makeStore() {
    const store = new SettingsStore<any>(
        { uiElements: { chatBarButtons: {} } },
        { readOnly: true, getDefaultValue: ({ target, key }) => target[key] }
    );
    return store;
}

// mirrors src/api/ChatButtons.tsx
const isEnabled = (store: SettingsStore<any>, id: string) =>
    store.store.uiElements.chatBarButtons[id]?.enabled !== false;

function setEnabled(store: SettingsStore<any>, id: string, enabled: boolean) {
    const { chatBarButtons } = store.store.uiElements;
    if (isEnabled(store, id) === enabled) return;
    chatBarButtons[id] ??= {};
    chatBarButtons[id].enabled = enabled;
}

test("buttons are shown until the user turns them off", () => {
    const store = makeStore();
    assert.equal(isEnabled(store, "VencordTimestamps"), true);
    assert.deepEqual(store.plain.uiElements.chatBarButtons, {});

    setEnabled(store, "VencordTimestamps", false);
    assert.equal(isEnabled(store, "VencordTimestamps"), false);
    assert.equal(store.plain.uiElements.chatBarButtons.VencordTimestamps.enabled, false);

    setEnabled(store, "VencordTimestamps", true);
    assert.equal(isEnabled(store, "VencordTimestamps"), true);
});

test("a write through a captured reference still notifies listeners", () => {
    const store = makeStore();
    const changed: string[] = [];
    store.addPrefixChangeListener("uiElements.chatBarButtons", (_v, path) => changed.push(path));

    // what the context menu captures while it builds its rows
    const { chatBarButtons } = store.store.uiElements;
    chatBarButtons["VencordTimestamps"] ??= {};
    chatBarButtons["VencordTimestamps"].enabled = false;

    assert.ok(
        changed.includes("uiElements.chatBarButtons.VencordTimestamps.enabled"),
        `expected a prefix notification, got ${JSON.stringify(changed)}`
    );
    assert.equal(store.plain.uiElements.chatBarButtons.VencordTimestamps.enabled, false);
});

test("setting the current state is a no-op", () => {
    const store = makeStore();
    const writes: string[] = [];
    store.addGlobalChangeListener((_d, path) => writes.push(path));

    setEnabled(store, "ComposeMode", true);

    assert.deepEqual(writes, []);
    assert.deepEqual(store.plain.uiElements.chatBarButtons, {});
});

/*
 * The submenu rows are Discord components handed to Discord's own renderer and `ChatButtons`
 * pulls in `@webpack`, so the wiring is pinned by reading the source instead of running it:
 * the checkbox must read its state live, the click must stop propagating into the parent
 * row, and a settings change must invalidate the patched children of open menus.
 */
const chatButtonsSource = readFileSync(new URL("../src/api/ChatButtons.tsx", import.meta.url), "utf8");
const contextMenuSource = readFileSync(new URL("../src/api/ContextMenu.ts", import.meta.url), "utf8");

function section(source: string, from: string, to?: string): string {
    const start = source.indexOf(from);
    assert.notEqual(start, -1, `"${from}" not found`);
    const end = to ? source.indexOf(to, start) : source.length;
    return source.slice(start, end === -1 ? source.length : end);
}

test("checkbox state is read live instead of being captured while the menu was built", () => {
    const patch = section(chatButtonsSource, 'addContextMenuPatch("textarea-context"');

    assert.match(patch, /checked=\{isChatBarButtonEnabled\(id\)\}/);
    // Reading the store once and closing over it is what froze the row at its initial value.
    assert.doesNotMatch(patch, /const \{ chatBarButtons \} = SettingsStore\.store\.uiElements/);
});

test("the row action toggles the live store and keeps the submenu open", () => {
    const patch = section(chatButtonsSource, 'addContextMenuPatch("textarea-context"');

    assert.match(patch, /setChatBarButtonEnabled\(id, !isChatBarButtonEnabled\(id\)\)/);
    assert.match(patch, /e\?\.stopPropagation\(\)/);
});

test("a chat bar button setting change refreshes open menus", () => {
    const listener = section(chatButtonsSource, "SettingsStore.addGlobalChangeListener", "const chatBarButtonListeners");

    assert.match(listener, /refreshContextMenus\(\)/);
    assert.match(listener, /path\.startsWith\("uiElements\.chatBarButtons"\)/);
});

test("refreshing invalidates the patched children of an open menu", () => {
    const refresh = section(contextMenuSource, "export function refreshContextMenus", "/**\n * Add a context menu patch");
    assert.match(refresh, /openMenuListeners/);

    const hook = section(contextMenuSource, "export function _usePatchContextMenu", "function cloneMenuChildren");
    assert.match(hook, /openMenuListeners\.add\(listener\)/, "open menus must register a refresh listener");
    assert.match(hook, /mountRef\.current\.stale = true/, "a refresh must invalidate the patched children");
    // The memo is only reused while it is fresh, otherwise the refresh is a no-op.
    assert.match(hook, /if \(!state\.stale && state\.patchedChildren/);
});