/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { sleep } from "@utils/misc";
import { ChannelStore, UserStore } from "@webpack/common";

import { addMembers, getGroupName, recipientIds, removeMembers, selfId } from "./api";
import { settings } from "./settings";
import { GctrapStore } from "./store";
import { GroupConfig, isGroupMode, LogKind } from "./types";

export function log(group: Pick<GroupConfig, "id" | "label">, text: string, kind: LogKind = "info"): void {
    GctrapStore.getState().addLog(group.label ?? getGroupName(ChannelStore.getChannel(group.id)), kind, text);
}

export function notify(title: string, body: string): void {
    if (settings.store.notify) showNotification({ title, body });
}

/** Start watching a group, or leave the existing config alone if it is tracked */
export function trackGroup(channelId: string, members?: readonly string[], name?: string): void {
    const store = GctrapStore.getState();
    if (store.getGroup(channelId)) return;

    const recipients = recipientIds(ChannelStore.getChannel(channelId)).filter(id => id !== selfId());
    const { defaultMode } = settings.store;
    store.upsertGroup({
        id: channelId,
        label: name?.trim() || undefined,
        mode: isGroupMode(defaultMode) ? defaultMode : "strict",
        members: [...new Set(members ?? recipients)],
        readdLimit: settings.store.readdLimit,
        readdDelay: settings.store.readdDelay,
        readds: {}
    });
    store.addLog(name?.trim() || getGroupName(ChannelStore.getChannel(channelId)), "info", "Started tracking this group");
}

/** Members that hit the re-add limit, so leaving the group is their last word */
const givenUp = new Map<string, Set<string>>();

export function isGivenUp(channelId: string, userId: string): boolean {
    return givenUp.get(channelId)?.has(userId) ?? false;
}

export function forgetGroup(channelId: string): void {
    givenUp.delete(channelId);
}

export function forgetAll(): void {
    givenUp.clear();
}

function giveUp(channelId: string, userId: string): void {
    const list = givenUp.get(channelId) ?? new Set<string>();
    list.add(userId);
    givenUp.set(channelId, list);
}

function nameOf(userId: string): string {
    const user = UserStore.getUser(userId);
    return user?.globalName || user?.username || userId;
}

/** Take a member out, unless the group is set to only ever add people back */
export async function kickMember(group: GroupConfig, userId: string, reason: string): Promise<void> {
    if (group.mode === "addonly" || group.mode === "off") return;

    const { removed } = await removeMembers(group.id, [userId], settings.store.memberSize, settings.store.addDelay);
    if (!removed) return;

    log(group, `${reason}: kicked ${nameOf(userId)}`, "action");
    notify(`${group.label ?? getGroupName(ChannelStore.getChannel(group.id))} lost a member`, `${nameOf(userId)} ${reason} and was kicked.`);
}

/**
 * Put a member back in. Every re-add is counted against readdLimit so a member
 * that keeps walking out is not hammered forever. Returns false when the group
 * only kicks, the member is back already, or the limit is reached.
 */
export async function readdMember(group: GroupConfig, userId: string, reason: string): Promise<boolean> {
    if (group.mode === "kickonly" || group.mode === "off") return false;
    if (isGivenUp(group.id, userId)) return false;
    if (recipientIds(ChannelStore.getChannel(group.id)).includes(userId)) return false;

    if (group.readdDelay > 0) await sleep(group.readdDelay);

    const current = GctrapStore.getState().getGroup(group.id);
    if (!current || current.mode === "kickonly" || current.mode === "off") return false;

    const { added } = await addMembers(group.id, [userId], settings.store.memberSize, settings.store.addDelay);
    if (!added) return false;

    const count = bumpReaddCount(current, userId);
    if (current.readdLimit > 0 && count > current.readdLimit) {
        giveUp(group.id, userId);
        log(group, `${nameOf(userId)} ${reason} and hit the re-add limit, leaving them out`, "warn");
        return true;
    }

    log(group, `${reason}: put ${nameOf(userId)} back in`, "action");
    return true;
}

function bumpReaddCount(group: GroupConfig, userId: string): number {
    const readds = { ...group.readds, [userId]: (group.readds?.[userId] ?? 0) + 1 };
    GctrapStore.getState().upsertGroup({ ...group, readds });
    return readds[userId];
}

/**
 * Bring a group in line with its allowlist in one pass, honouring the mode:
 * missing members go back in unless the group only kicks, extras get kicked out
 * unless the group only adds.
 */
export async function syncGroup(group: GroupConfig): Promise<string> {
    const present = recipientIds(ChannelStore.getChannel(group.id));
    const missing = group.members.filter(id => !present.includes(id) && !isGivenUp(group.id, id));
    const extras = present.filter(id => id !== selfId() && !group.members.includes(id));

    const parts: string[] = [];

    if (missing.length && group.mode !== "kickonly" && group.mode !== "off") {
        const res = await addMembers(group.id, missing, settings.store.memberSize, settings.store.addDelay);
        parts.push(`${res.added} of ${missing.length} put back in`);
    }
    if (extras.length && group.mode !== "addonly" && group.mode !== "off") {
        const res = await removeMembers(group.id, extras, settings.store.memberSize, settings.store.addDelay);
        parts.push(`${res.removed} of ${extras.length} extras kicked out`);
    }

    log(group, `Synced: ${parts.length ? parts.join(", ") : "nothing to do"}`, "action");
    return parts.length ? parts.join(", ") : "Already in order";
}

export function resetReaddCounts(group: GroupConfig, userIds?: readonly string[]): void {
    if (!userIds?.length) {
        GctrapStore.getState().upsertGroup({ ...group, readds: {} });
        givenUp.delete(group.id);
        return;
    }

    const readds = { ...group.readds };
    for (const id of userIds) delete readds[id];
    GctrapStore.getState().upsertGroup({ ...group, readds });

    const list = givenUp.get(group.id);
    if (list) for (const id of userIds) list.delete(id);
}
