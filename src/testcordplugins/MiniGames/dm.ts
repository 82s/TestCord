/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sleep } from "@utils/misc";
import { ChannelActionCreators, ChannelStore } from "@webpack/common";

async function waitForDmChannel(userId: string, timeoutMs = 3000): Promise<string | null> {
    const started = Date.now();
    do {
        const id = ChannelStore.getDMFromUserId?.(userId) ?? null;
        if (id) return id;
        await sleep(80);
    } while (Date.now() - started < timeoutMs);
    return null;
}

export async function ensureDmChannel(userId: string): Promise<string | null> {
    const existing = ChannelStore.getDMFromUserId?.(userId);
    if (existing) return existing;

    let result: unknown;
    try {
        result = await Promise.resolve(ChannelActionCreators.openPrivateChannel({ recipientIds: [userId], navigateToChannel: false }));
    } catch {
        result = null;
    }
    if (typeof result === "string") return result;

    return waitForDmChannel(userId);
}
