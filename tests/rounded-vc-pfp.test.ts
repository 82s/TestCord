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

import { makeRange } from "../src/utils/types";

const source = readFileSync(new URL("../src/testcordplugins/RoundedVcPfp/index.tsx", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export default definePlugin(", "globalThis.plugin = definePlugin(");
let lookups = 0;
let user: { getDefaultAvatarURL?: unknown; } = {};
const sandbox = {
    EquicordDevs: { mochienya: {} }, TestcordDevs: { DavidHiFi: {} },
    definePlugin: (plugin: unknown) => plugin,
    definePluginSettings: () => ({ store: { cornerRadius: 12 } }), OptionType: { SLIDER: 5 }, style: "",
    makeRange,
    UserStore: { getUser: () => { lookups++; return user; } },
    VoiceStateStore: { getVoiceStateForUser: () => undefined },
    getUserAvatarUrl: () => undefined
};
vm.createContext(sandbox);
vm.runInContext(transformSync(source, { loader: "tsx", format: "cjs" }).code, sandbox);
const plugin = (sandbox as typeof sandbox & { plugin: { getVoiceBackgroundStyles(props: { className?: string; participantUserId?: string; }): Record<string, string> | undefined; }; }).plugin;

test("Only participant tiles receive avatar styles", () => {
    for (const props of [{ participantUserId: "1" }, { className: "other", participantUserId: "1" }, { className: "tile" }]) {
        assert.equal(plugin.getVoiceBackgroundStyles(props), undefined);
    }
    assert.equal(lookups, 0);
});

test("The callable default avatar fallback applies to tiles", () => {
    user = { getDefaultAvatarURL: () => "default-avatar" };
    const result = plugin.getVoiceBackgroundStyles({ className: "tile_example", participantUserId: "1" });
    assert.equal(result?.["--full-res-avatar"], 'url("default-avatar")');
    assert.equal(result?.["--vc-pfp-radius"], "12px");
});

test("A missing or noncallable default avatar uses the CDN fallback", () => {
    for (const value of [undefined, "not-a-function"]) {
        user = { getDefaultAvatarURL: value };
        assert.equal(plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: "1" })?.["--full-res-avatar"], 'url("https://cdn.discordapp.com/embed/avatars/0.png")');
    }
});
