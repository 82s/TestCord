/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import type { Channel, User } from "@vencord/discord-types";
import { ChannelStore, GuildChannelStore, GuildStore, MessageActions, UserStore } from "@webpack/common";

import { settings } from "./settings";

export const logger = new Logger("RemoteControl");

export interface ParsedCommand {
    name: string;
    rawArgs: string;
    named: Map<string, string>;
    positional: string[];
}

export interface RemoteContext {
    channelId: string;
    messageId: string;
    channel: Channel;
    guildId?: string;
    parsed: ParsedCommand;
}

interface SendResult {
    id?: string;
    body?: {
        id?: string;
    };
}

const TOKEN_RE = /(?:([\w-]+):(?:\s+(?=["'])|)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+))|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+))/g;
const deletionTimers = new Set<ReturnType<typeof setTimeout>>();
const recentSends = new Map<string, number>();

export function parseCommand(content: string, prefix: string): ParsedCommand | null {
    if (!prefix || !content.startsWith(prefix)) return null;

    const body = content.slice(prefix.length).trim();
    const match = /^([\w-]+)(?:\s+([\s\S]*))?$/.exec(body);
    if (!match) return null;

    const rawArgs = match[2]?.trim() ?? "";
    const named = new Map<string, string>();
    const positional: string[] = [];

    TOKEN_RE.lastIndex = 0;
    let token: RegExpExecArray | null;

    while ((token = TOKEN_RE.exec(rawArgs))) {
        const key = token[1]?.toLowerCase();
        const quoted = token[2] ?? token[3] ?? token[5] ?? token[6];
        const value = unescapeToken(quoted ?? token[4] ?? token[7] ?? "");
        const isUrl = !quoted && value.startsWith("//");

        if (key && !isUrl) named.set(key, value);
        else positional.push(key ? `${key}:${value}` : value);
    }

    return {
        name: match[1].toLowerCase(),
        rawArgs,
        named,
        positional
    };
}

function unescapeToken(value: string) {
    return value.replace(/\\(["'\\])/g, "$1");
}

export function splitWords(input: string, count: number) {
    const head: string[] = [];
    let rest = input.trim();

    for (let i = 0; i < count; i++) {
        const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
        if (!match) break;

        head.push(match[1]);
        rest = match[2] ?? "";
    }

    return { head, rest };
}

export function stripOptions(input: string, keys: string[]) {
    let result = input;

    for (const key of keys) {
        result = result.replace(new RegExp(`(?:^|\\s)${key}:\\s*(?:"[^"]*"|'[^']*'|\\S+)`, "gi"), " ");
    }

    return result.trim();
}

export function parseBoolean(input: string): boolean | null {
    const value = input.toLowerCase();
    if (["1", "true", "yes", "on", "enable", "enabled"].includes(value)) return true;
    if (["0", "false", "no", "off", "disable", "disabled"].includes(value)) return false;
    return null;
}

export function parseDuration(input: string): number | null {
    const value = input.trim().toLowerCase();
    if (!value) return null;

    const plain = Number(value);
    if (Number.isFinite(plain)) return plain > 0 ? plain * 1000 : null;

    const cleaned = value.replace(/(\d+(?:\.\d+)?)\s*(d|h|m|s)/g, "");
    if (cleaned.trim()) return null;

    const regex = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/g;
    let match: RegExpExecArray | null;
    let total = 0;

    while ((match = regex.exec(value))) {
        const amount = Number(match[1]);
        switch (match[2]) {
            case "d":
                total += amount * 86_400_000;
                break;
            case "h":
                total += amount * 3_600_000;
                break;
            case "m":
                total += amount * 60_000;
                break;
            case "s":
                total += amount * 1000;
                break;
        }
    }

    return total > 0 ? total : null;
}

export function getAllowedChannelIds() {
    return new Set(
        (settings.store.allowedChannelIds ?? "")
            .split(/[\s,]+/)
            .map(id => id.trim())
            .filter(id => /^\d{17,20}$/.test(id))
    );
}

export function getAllowedUserIds() {
    return new Set(
        (settings.store.allowedUserIds ?? "")
            .split(/[\s,]+/)
            .map(id => id.trim())
            .filter(id => /^\d{17,20}$/.test(id))
    );
}

export function isChannelAllowed(channel: Channel) {
    if (settings.store.allowAllChannels) return true;
    if (getAllowedChannelIds().has(channel.id)) return true;
    return channel.isDM() || channel.isGroupDM();
}

export function bindChannel(channelId: string) {
    const ids = getAllowedChannelIds();
    ids.add(channelId);
    settings.store.allowedChannelIds = [...ids].join(", ");
}

export function unbindChannel(channelId: string) {
    const ids = getAllowedChannelIds();
    if (!ids.delete(channelId)) return false;
    settings.store.allowedChannelIds = [...ids].join(", ");
    return true;
}

export function resolveChannel(input: string | undefined, guildId?: string): Channel | undefined {
    if (!input) return undefined;

    const mention = /^<#(\d+)>$/.exec(input)?.[1];
    const id = mention ?? (/^\d{17,20}$/.test(input) ? input : undefined);
    if (id) return ChannelStore.getChannel(id) ?? undefined;

    const query = input.replace(/^#/, "").toLowerCase();
    if (guildId) {
        const guild = GuildStore.getGuild(guildId);
        if (guild) {
            const channels = GuildChannelStore.getChannels(guild.id);
            const all = [...channels.SELECTABLE, ...channels.VOCAL].map(entry => entry.channel);
            const unique = [...new Map(all.map(channel => [channel.id, channel])).values()];

            return unique.find(channel => channel.name?.toLowerCase() === query)
                ?? unique.find(channel => channel.name?.toLowerCase().includes(query));
        }
    }

    return ChannelStore.getSortedPrivateChannels().find(channel => channel.name?.toLowerCase() === query)
        ?? ChannelStore.getSortedPrivateChannels().find(channel => channel.name?.toLowerCase().includes(query));
}

export function resolveUser(input: string | undefined): User | undefined {
    if (!input) return undefined;

    const mention = /^<@!?(\d+)>$/.exec(input)?.[1];
    const id = mention ?? (/^\d{17,20}$/.test(input) ? input : undefined);
    if (id) return UserStore.getUser(id) ?? undefined;

    const query = input.replace(/^@/, "").toLowerCase();
    const users = Object.values(UserStore.getUsers());

    return users.find(user => user.username.toLowerCase() === query || user.globalName?.toLowerCase() === query)
        ?? users.find(user => user.username.toLowerCase().includes(query) || user.globalName?.toLowerCase().includes(query));
}

export function resolveGuild(input: string | undefined) {
    if (!input) return undefined;
    if (/^\d{17,20}$/.test(input)) return GuildStore.getGuild(input) ?? undefined;

    const query = input.toLowerCase();
    const guilds = Object.values(GuildStore.getGuilds());

    return guilds.find(guild => guild.name.toLowerCase() === query)
        ?? guilds.find(guild => guild.name.toLowerCase().includes(query));
}

export function rememberSent(channelId: string, content: string) {
    if (recentSends.size > 100) {
        const now = Date.now();
        for (const [key, expiresAt] of recentSends) {
            if (expiresAt <= now) recentSends.delete(key);
        }
    }

    recentSends.set(sendKey(channelId, content), Date.now() + 15_000);
}

export function consumeRecentSend(channelId: string, content: string) {
    const key = sendKey(channelId, content);
    const expiresAt = recentSends.get(key);
    if (expiresAt === undefined) return false;

    recentSends.delete(key);
    return expiresAt > Date.now();
}

function sendKey(channelId: string, content: string) {
    return `${channelId}\u0000${content}`;
}

export function scheduleDeletion(callback: () => void | Promise<void>, delayMs: number) {
    if (delayMs <= 0) return;

    const timer = setTimeout(() => {
        deletionTimers.delete(timer);
        Promise.resolve(callback()).catch(error => logger.warn("Failed to delete a message", error));
    }, delayMs);

    deletionTimers.add(timer);
}

export function deleteMessage(channelId: string, messageId: string) {
    Promise.resolve(MessageActions.deleteMessage(channelId, messageId))
        .catch(error => logger.warn("Failed to delete a message", error));
}

export function clearRuntimeState() {
    for (const timer of deletionTimers) clearTimeout(timer);
    deletionTimers.clear();
    recentSends.clear();
}

export function splitMessage(content: string) {
    const limit = 1900;
    if (content.length <= limit) return [content];

    const chunks: string[] = [];
    let current = "";

    for (const line of content.split("\n")) {
        if (current && current.length + line.length + 1 > limit) {
            chunks.push(current);
            current = "";
        }

        current += `${current ? "\n" : ""}${line}`;

        while (current.length > limit) {
            chunks.push(current.slice(0, limit));
            current = current.slice(limit);
        }
    }

    if (current) chunks.push(current);
    return chunks;
}

export async function reply(ctx: RemoteContext, content: string, info = false) {
    const delay = Math.max(0, info ? settings.store.infoDeleteDelay : settings.store.responseDeleteDelay) * 1000;
    const chunks = splitMessage(content);

    for (const [index, chunk] of chunks.entries()) {
        rememberSent(ctx.channelId, chunk);
        if (index > 0) await sleep(400);

        let messageId: string | undefined;

        try {
            const result = await sendMessage(ctx.channelId, { content: chunk }) as SendResult | undefined;
            messageId = result?.body?.id ?? result?.id;
        } catch (error) {
            logger.warn(`Failed to send reply part ${index + 1} of ${chunks.length}`, error);
            continue;
        }

        if (messageId && delay > 0) {
            const { channelId } = ctx;
            scheduleDeletion(() => MessageActions.deleteMessage(channelId, messageId), delay);
        }
    }
}

export function replyInfo(ctx: RemoteContext, content: string) {
    return reply(ctx, content, true);
}

export function replyDone(ctx: RemoteContext, content = "Done.") {
    if (!settings.store.sendConfirmations) return Promise.resolve();
    return reply(ctx, `✅ ${content}`);
}

export function replyError(ctx: RemoteContext, content: string) {
    return reply(ctx, `❌ ${content}`);
}
