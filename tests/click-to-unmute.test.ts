/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/testcordplugins/ClickToUnmute/index.tsx", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export default definePlugin(", "globalThis.plugin = definePlugin(");
const sandbox = {
    TestcordDevs: { DavidHiFi: {}, Kurtzon: {} },
    definePlugin: (plugin: unknown) => plugin
};
vm.createContext(sandbox);
vm.runInContext(transformSync(source, { loader: "tsx", format: "cjs" }).code, sandbox);
const plugin = (sandbox as typeof sandbox & { plugin: { patches: Array<{ replacement: Array<{ match: RegExp; replace: string; }>; }>; }; }).plugin;
const patch = plugin.patches[0].replacement[0];
const match = new RegExp(patch.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));

test("Mute icon patch compiles after identifier expansion and preserves the row identity", () => {
    for (const suffix of [")", "}", "]"]) {
        const code = `user:rowUser,disconnected:false,localMute:isMuted,children:muteIcon},"mute"${suffix}`;
        assert.equal(code.replace(match, patch.replace), `user:rowUser,disconnected:false,localMute:isMuted,children:isMuted?$self.renderClickable(rowUser,muteIcon):muteIcon},"mute"${suffix}`);
    }
});

test("Unrelated icons and rows without local mute stay unchanged", () => {
    for (const code of ['user:u,disconnected:false,children:icon},"mute")', 'user:u,disconnected:false,localMute:m,children:icon},"deafen")']) {
        assert.equal(code.replace(match, patch.replace), code);
    }
});
