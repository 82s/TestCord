/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { User } from "@vencord/discord-types";

export const GROUP_MODES = {
    strict: "Kick & Re-add",
    kickonly: "Kick only",
    addonly: "Re-add only",
    off: "Paused"
} as const;
export type GroupMode = keyof typeof GROUP_MODES;

export function isGroupMode(value: string): value is GroupMode {
    return value in GROUP_MODES;
}

export interface GroupConfig {
    id: string;
    label?: string;
    mode: GroupMode;
    members: string[];
    readdLimit: number;
    readdDelay: number;
    /** How often each member has been put back in since the last reset */
    readds?: Record<string, number>;
}

export interface Preset {
    name: string;
    ids: string[];
}

export type LogKind = "info" | "action" | "warn" | "error";

export interface LogEntry {
    id: number;
    ts: number;
    group: string;
    kind: LogKind;
    text: string;
}

export interface FriendOption {
    user?: User;
    id: string;
    name: string;
    username: string;
    avatar: string;
    status: "online" | "idle" | "dnd" | "offline";
    inVoice: boolean;
}

/** Users the member list is allowed to show for a group */
export function allowedIds(members: string[], selfId: string): Set<string> {
    const ids = new Set(members);
    ids.add(selfId);
    return ids;
}
