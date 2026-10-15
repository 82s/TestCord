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
const voiceState: { channelId?: string; } = {};
// The call the current user is connected to, and the channel the last speaking lookup used
let selfVoiceChannel: string | undefined;
let speakingChannel: string | undefined;
let profile: { banner?: string; } | undefined;
let fetches = 0;
let fetchFails = 0;
const fetchCacheArgs: unknown[] = [];
const usrbgState = { enabled: false, hasBackground: false };
// What ChannelRTCStore.getSelectedParticipant would return for the voice
// channel: the stream the call view currently paints, or none.
let selectedStream: { type?: unknown; id?: unknown } | null = null;
const store: Record<string, unknown> = {
    avatarRadius: 5,
    cornerRadius: 12,
    zoom: 100,
    hideTileBackground: false,
    hideUserBackgrounds: false,
    showUserBanners: false,
    preferBanners: false,
    enableGlow: false,
    glowColor: "#45475a",
    speakingIndicator: "box"
};
const windowListeners = new Map<string, Set<unknown>>();
const fakeWindow = {
    addEventListener: (type: string, fn: unknown) => { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type)!.add(fn); },
    removeEventListener: (type: string, fn: unknown) => { windowListeners.get(type)?.delete(fn); }
};
const sandbox = {
    window: fakeWindow,
    EquicordDevs: { mochienya: {} }, TestcordDevs: { DavidHiFi: {} },
    definePlugin: (plugin: unknown) => plugin,
    definePluginSettings: () => ({ store }), OptionType: { SLIDER: 5 }, style: "",
    makeRange,
    UserStore: { getUser: () => { lookups++; return user; } },
    VoiceStateStore: { getVoiceStateForUser: () => voiceState.channelId ? voiceState : undefined, addReactChangeListener: () => {}, removeReactChangeListener: () => {} },
    SelectedChannelStore: { getVoiceChannelId: () => selfVoiceChannel, addReactChangeListener: () => {}, removeReactChangeListener: () => {} },
    ChannelStore: { getChannel: () => ({ guild_id: "guild-1" }) },
    ChannelRTCStore: { getSpeakingParticipants: (channelId: string) => { speakingChannel = channelId; return [{ user: { id: "1" }, speaking: true }]; }, getSelectedParticipant: () => selectedStream, addReactChangeListener: () => {}, removeReactChangeListener: () => {} },
    UserProfileStore: { getUserProfile: () => profile, addReactChangeListener: () => {}, removeReactChangeListener: () => {} },
    IconUtils: { getUserBannerURL: () => "banner-url" },
    fetchUserProfile: (_id: string, _options: unknown, cache: unknown) => {
        fetches++;
        fetchCacheArgs.push(cache);
        if (fetchFails > 0) { fetchFails--; return Promise.reject(new Error("429")); }
        return Promise.resolve();
    },
    // the banner fetch queue paces itself and retries with timers
    setTimeout: (fn: () => void) => setImmediate(fn),
    isPluginEnabled: () => usrbgState.enabled,
    usrbg: { name: "USRBG", userHasBackground: () => usrbgState.hasBackground },
    // Discord's Flux useStateFromStores subscribes through addReactChangeListener
    // on every store it receives; the stub enforces that contract so a plain
    // object store fails here instead of crashing the tile render live.
    useStateFromStores: (stores: Array<Record<string, unknown>>) => {
        for (const store of stores) store.addReactChangeListener(() => {});
        return undefined;
    },
    getUserAvatarUrl: () => undefined
};
vm.createContext(sandbox);
vm.runInContext(transformSync(source, { loader: "tsx", format: "cjs" }).code, sandbox);
const plugin = (sandbox as typeof sandbox & { plugin: { start(): void; stop(): void; getVoiceBackgroundStyles(props: { className?: string; participantUserId?: string; children?: unknown; }): Record<string, string> | undefined; useTileBanner(props: { participantUserId?: string; }): void; }; }).plugin;

const styles = (props: { participantUserId: string; }) => plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: props.participantUserId }) ?? {};



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

test("Picture masking follows the radius slider and the theme slot is always set", () => {
    Object.assign(store, { avatarRadius: 24 });
    const result = styles({ participantUserId: "1" });
    assert.ok(result["--vc-pfp-avatar-mask"]?.includes("rx%3D'24'"));
    assert.equal(result["--vc-pfp-avatar-radius"], "24%");
    assert.equal(result["--vc-pfp-glow-slot"], "1");
    Object.assign(store, { avatarRadius: 5 });
});

test("The glow follows its own switch while the box shows or hides", () => {
    Object.assign(store, { hideTileBackground: false, enableGlow: true });
    const result = styles({ participantUserId: "1" });
    assert.equal(result["backgroundColor"], "");
    assert.equal("backgroundImage" in result, false);
    assert.equal(result["--vc-pfp-hide-bg"], "");
    assert.equal(result["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(69, 71, 90, 0.4)) drop-shadow(0 0 3px rgba(69, 71, 90, 0.6))");

    Object.assign(store, { hideTileBackground: true, enableGlow: false });
    const floating = styles({ participantUserId: "1" });
    assert.equal(floating["backgroundColor"], "transparent");
    assert.equal(floating["--vc-pfp-hide-bg"], "1");
    assert.equal(floating["--vc-pfp-glow-filter"], "");
    Object.assign(store, { enableGlow: false });
});

test("The speaking ring emits its markers only in picture mode while speaking", () => {
    Object.assign(store, { speakingIndicator: "box" });
    const boxed = styles({ participantUserId: "1" });
    assert.equal(boxed["--vc-pfp-ring-pic"], "");
    assert.equal(boxed["--vc-pfp-speaking"], "");

    Object.assign(store, { speakingIndicator: "picture" });
    const silent = styles({ participantUserId: "1" });
    assert.equal(silent["--vc-pfp-ring-pic"], "1");
    assert.equal(silent["--vc-pfp-speaking"], "");
    assert.equal(silent["--vc-pfp-glow-filter"], "");
    Object.assign(store, { speakingIndicator: "box" });
});

test("Picture mode merges the speaking bloom into the filter while speaking", () => {
    voiceState.channelId = "channel-1";
    Object.assign(store, { speakingIndicator: "picture", enableGlow: true, glowColor: "#45475a" });
    const talking = styles({ participantUserId: "1" });
    assert.equal(talking["--vc-pfp-speaking"], "1");
    assert.equal(talking["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(69, 71, 90, 0.4)) drop-shadow(0 0 3px rgba(69, 71, 90, 0.6)) drop-shadow(0 0 2px var(--green-360, #23a55a)) drop-shadow(0 0 8px var(--green-360, #23a55a))");

    Object.assign(store, { enableGlow: false });
    const bloomOnly = styles({ participantUserId: "1" });
    assert.equal(bloomOnly["--vc-pfp-glow-filter"], "drop-shadow(0 0 2px var(--green-360, #23a55a)) drop-shadow(0 0 8px var(--green-360, #23a55a))");

    Object.assign(store, { speakingIndicator: "box" });
    const boxed = styles({ participantUserId: "1" });
    assert.equal(boxed["--vc-pfp-glow-filter"], "");
    voiceState.channelId = undefined;
});

test("User backgrounds stay visible without their own switch and hide with it", () => {
    Object.assign(store, { hideTileBackground: true, hideUserBackgrounds: false });
    const keep = styles({ participantUserId: "1" });
    assert.equal(keep["backgroundColor"], "transparent");
    assert.equal("backgroundImage" in keep, false);

    Object.assign(store, { hideTileBackground: false, hideUserBackgrounds: true });
    const hideUser = styles({ participantUserId: "1" });
    assert.equal(hideUser["backgroundImage"], "none");
    assert.equal(hideUser["backgroundColor"], "");

    Object.assign(store, { hideTileBackground: true, hideUserBackgrounds: true });
    const both = styles({ participantUserId: "1" });
    assert.equal(both["backgroundImage"], "none");
    assert.equal(both["backgroundColor"], "transparent");

    Object.assign(store, { hideTileBackground: false, hideUserBackgrounds: false });
    assert.equal("backgroundImage" in styles({ participantUserId: "1" }), false);
});

test("A profile banner paints the tile unless USRBG already claims it", () => {
    profile = { banner: "banner-hash" };
    Object.assign(store, { showUserBanners: true, hideUserBackgrounds: true });
    assert.equal(styles({ participantUserId: "1" })["backgroundImage"], "none");

    Object.assign(store, { hideUserBackgrounds: false });
    const banner = styles({ participantUserId: "1" });
    assert.equal(banner["backgroundImage"], 'url("banner-url")');
    assert.equal(banner["backgroundSize"], "cover");
    assert.equal(banner["backgroundPosition"], "center");
    assert.equal(banner["backgroundRepeat"], "no-repeat");

    usrbgState.enabled = true;
    usrbgState.hasBackground = true;
    assert.equal("backgroundImage" in styles({ participantUserId: "1" }), false);

    Object.assign(store, { preferBanners: true });
    assert.equal(styles({ participantUserId: "1" })["backgroundImage"], 'url("banner-url")');

    usrbgState.enabled = false;
    usrbgState.hasBackground = false;
    Object.assign(store, { preferBanners: false });
    profile = undefined;
});

test("Users without a banner keep the default look and are fetched once", () => {
    Object.assign(store, { showUserBanners: true });
    fetches = 0;
    assert.equal("backgroundImage" in styles({ participantUserId: "2" }), false);
    assert.equal("backgroundImage" in styles({ participantUserId: "2" }), false);
    assert.equal(fetches, 1);
    Object.assign(store, { showUserBanners: false });
});

test("A failed banner fetch retries uncached so rate-limited users still get their banner", async () => {
    Object.assign(store, { showUserBanners: true });
    fetches = 0;
    fetchFails = 1;
    fetchCacheArgs.length = 0;
    styles({ participantUserId: "3" });
    for (let i = 0; i < 20 && fetches < 2; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetches, 2);
    // a cached stub profile from a failed fetch must not short-circuit the request
    assert.deepEqual(fetchCacheArgs, [false, false]);
    Object.assign(store, { showUserBanners: false });
});

test("The glow filter composes both layers from the configured hex", () => {
    Object.assign(store, { hideTileBackground: true, enableGlow: true, glowColor: "#45475a" });
    const result = styles({ participantUserId: "1" });
    assert.equal(result["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(69, 71, 90, 0.4)) drop-shadow(0 0 3px rgba(69, 71, 90, 0.6))");

    Object.assign(store, { glowColor: "#a8c" });
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(170, 136, 204, 0.4)) drop-shadow(0 0 3px rgba(170, 136, 204, 0.6))");
    Object.assign(store, { enableGlow: true, glowColor: "not-a-color" });
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-glow-filter"], "");
    Object.assign(store, { hideTileBackground: false, enableGlow: false, glowColor: "#45475a" });
});

test("Stream tiles never glow in either mode, watched or not", () => {
    voiceState.channelId = "channel-1";
    const children = { props: { children: [{ props: { participant: { type: 0, streamId: "stream-1" } } }] } };
    for (const speakingIndicator of ["picture", "box"]) {
        Object.assign(store, { speakingIndicator, enableGlow: false });
        for (const selection of [null, { type: "STREAM", id: "guild:guild-1:channel-1:1" }]) {
            selectedStream = selection;
            const stream = plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: "1", children });
            assert.equal(stream?.["--vc-pfp-stream"], "1");
            assert.equal(stream?.["--vc-pfp-speaking"], "");
            assert.equal(stream?.["--vc-pfp-glow-filter"], "");
        }
    }
    // The same speaker's own voice tile still glows.
    selectedStream = null;
    Object.assign(store, { speakingIndicator: "picture" });
    const person = styles({ participantUserId: "1" });
    assert.equal(person["--vc-pfp-stream"], "");
    assert.equal(person["--vc-pfp-speaking"], "1");
    assert.ok(person["--vc-pfp-glow-filter"].includes("--green-360"));
    Object.assign(store, { speakingIndicator: "box" });
    delete voiceState.channelId;
});

test("Speaking resolves through the call we are in while a participant's own voice state lags", () => {
    delete voiceState.channelId;
    selfVoiceChannel = "call-1";
    speakingChannel = undefined;
    store["speakingIndicator"] = "picture";
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-speaking"], "1");
    assert.equal(speakingChannel, "call-1");
    // Their own voice state wins once it has arrived
    voiceState.channelId = "other-call";
    styles({ participantUserId: "1" });
    assert.equal(speakingChannel, "other-call");
    // Not in a call and no voice state: nothing to look up, so no glow
    delete voiceState.channelId;
    selfVoiceChannel = undefined;
    speakingChannel = undefined;
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-speaking"], "");
    assert.equal(speakingChannel, undefined);
    store["speakingIndicator"] = "box";
});

test("Camera tiles keep their speaking state and tile border in picture mode", () => {
    Object.assign(store, { speakingIndicator: "picture", enableGlow: false });
    voiceState.channelId = "channel-1";
    const children = { props: { children: [{ props: { participant: { type: 2, streamId: "camera-1" } } }] } };
    const camera = plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: "1", children });
    assert.equal(camera?.["--vc-pfp-stream"], "");
    assert.equal(camera?.["--vc-pfp-camera"], "1");
    assert.equal(camera?.["--vc-pfp-speaking"], "1");
    const person = styles({ participantUserId: "1" });
    assert.equal(person["--vc-pfp-camera"], "");
    Object.assign(store, { speakingIndicator: "box" });
    delete voiceState.channelId;
});

test("Every store handed to useStateFromStores carries the Flux listener contract", () => {
    voiceState.channelId = "channel-1";
    // The tile hook subscribes to three Flux stores and the plain audio-activity
    // store; the contract-enforcing stub throws if any of them lacks the pair.
    assert.doesNotThrow(() => plugin.useTileBanner({ participantUserId: "1" }));
    delete voiceState.channelId;
});

// Strip comments so assertions only see real rules.
const rules = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("The only box ring is box mode's, and it skips stream tiles", () => {
    const css = rules(readFileSync(new URL("../src/testcordplugins/RoundedVcPfp/style.css", import.meta.url), "utf8"));
    const boxRings = [...css.matchAll(/([^{}]+)\{[^}]*0 0 0 2px var\(--green-360/g)].map(m => m[1].trim());
    assert.deepEqual(boxRings, ['div[data-selenium-video-tile][style*="--vc-pfp-speaking"]:not([style*="--vc-pfp-ring-pic"], [style*="--vc-pfp-stream"])']);
});

test("The glow filter sits on the unmasked avatar element so it traces only the picture", () => {
    const css = rules(readFileSync(new URL("../src/testcordplugins/RoundedVcPfp/style.css", import.meta.url), "utf8"));
    const block = (selector: string) => css.split("}").map(part => part.split("{")).find(([sel]) => sel.trim() === selector)?.[1] ?? "";
    const avatar = block('div[data-selenium-video-tile] div[role="img"]');
    assert.match(avatar, /filter:\s*var\(--vc-pfp-glow-filter/, "glow filter must be on the avatar element");
    assert.doesNotMatch(avatar, /mask/, "the filtered element must not carry the mask");
    const picture = block('div[data-selenium-video-tile] div[role="img"]::before');
    assert.match(picture, /background-image:\s*var\(--full-res-avatar\)/, "picture must paint on ::before");
    assert.match(picture, /mask-image:/, "picture mask must live on ::before");
    // The backdrop wrapper may hold a profile gradient; a filter there traces its box.
    assert.doesNotMatch(css, /div\[class\*="background"\]\s*\{[^}]*filter/, "no glow filter on the backdrop wrapper");
});

test("Tile styles go into a fresh style object so cleared keys leave the DOM", () => {
    // Mutating the parent's style object in place made React compare it with
    // itself, so switching to box mode kept the picture-mode ring painted.
    assert.ok(source.includes('replace: "$self.useTileBanner($2);$1={...$1,...$self.getVoiceBackgroundStyles($2)};"'));
    assert.ok(!source.includes("Object.assign($1"));
});

test("The audio-activity window listener is added on start and removed on stop", () => {
    assert.equal(windowListeners.get("testcord-vu-audio-change")?.size ?? 0, 0);
    plugin.start();
    assert.equal(windowListeners.get("testcord-vu-audio-change")?.size, 1);
    plugin.stop();
    assert.equal(windowListeners.get("testcord-vu-audio-change")?.size, 0);
});
