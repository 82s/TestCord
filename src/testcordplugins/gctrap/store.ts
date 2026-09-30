/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { proxyLazy } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { zustandCreate } from "@webpack/common";

import { GroupConfig, LogEntry, LogKind, Preset } from "./types";

const KEY_GROUPS = "gctrap_groups";
const KEY_PRESETS = "gctrap_presets";
const KEY_LOG = "gctrap_log";
const MAX_LOG = 100;

const logger = new Logger("gctrap");

let logSeq = 0;

interface GctrapState {
    ready: boolean;
    groups: GroupConfig[];
    presets: Preset[];
    log: LogEntry[];
    load: () => Promise<void>;
    getGroup: (channelId: string) => GroupConfig | undefined;
    upsertGroup: (group: GroupConfig) => void;
    removeGroup: (channelId: string) => void;
    addPreset: (preset: Preset) => void;
    removePreset: (name: string) => void;
    addLog: (group: string, kind: LogKind, text: string) => void;
    clearLog: () => void;
}

type StateSetter = (partial: Partial<GctrapState> | ((state: GctrapState) => Partial<GctrapState>)) => void;

interface GctrapStore {
    <T>(selector: (state: GctrapState) => T): T;
    getState(): GctrapState;
}

function persist(key: string, value: unknown) {
    DataStore.set(key, value).catch(err => logger.error(`Failed to save ${key}`, err));
}

/**
 * Group configs, member presets and the action log live in IndexedDB, mirrored
 * into a zustand store so the dashboard updates without polling.
 * Discord ships zustand, so the finder result is untyped until we say so here.
 */
const createStore = zustandCreate as (
    init: (set: (partial: Partial<GctrapState> | ((state: GctrapState) => Partial<GctrapState>)) => void, get: () => GctrapState) => GctrapState
) => {
    <T>(selector: (state: GctrapState) => T): T;
    getState(): GctrapState;
};

export const GctrapStore = proxyLazy(() => createStore((set, get) => ({
    ready: false,
    groups: [],
    presets: [],
    log: [],

    async load() {
        const [groups, presets, log] = await Promise.all([
            DataStore.get<GroupConfig[]>(KEY_GROUPS),
            DataStore.get<Preset[]>(KEY_PRESETS),
            DataStore.get<LogEntry[]>(KEY_LOG)
        ]);
        logSeq = log?.[Math.max(0, (log?.length ?? 1) - 1)]?.id ?? 0;
        set({ groups: groups ?? [], presets: presets ?? [], log: log ?? [], ready: true });
    },

    getGroup(channelId) {
        return get().groups.find(group => group.id === channelId);
    },

    upsertGroup(group) {
        const existing = get().groups;
        const index = existing.findIndex(item => item.id === group.id);
        const groups = index === -1 ? [...existing, group] : existing.map((item, i) => i === index ? group : item);
        set({ groups });
        persist(KEY_GROUPS, groups);
    },

    removeGroup(channelId) {
        const groups = get().groups.filter(group => group.id !== channelId);
        set({ groups });
        persist(KEY_GROUPS, groups);
    },

    addPreset(preset) {
        const presets = [...get().presets.filter(item => item.name !== preset.name), preset];
        set({ presets });
        persist(KEY_PRESETS, presets);
    },

    removePreset(name) {
        const presets = get().presets.filter(item => item.name !== name);
        set({ presets });
        persist(KEY_PRESETS, presets);
    },

    addLog(group, kind, text) {
        const log = [...get().log, { id: ++logSeq, ts: Date.now(), group, kind, text }].slice(-MAX_LOG);
        set({ log });
        persist(KEY_LOG, log);
    },

    clearLog() {
        set({ log: [] });
        persist(KEY_LOG, []);
    }
})));
