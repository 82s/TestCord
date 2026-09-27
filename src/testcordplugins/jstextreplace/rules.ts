/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { escapeRegExp } from "@utils/text";
import { ChannelStore, GuildMemberStore, GuildStore, SelectedGuildStore, showToast, Toasts, UserStore } from "@webpack/common";

import { settings } from ".";

export interface Rule {
    find: string;
    replace: string;
    onlyIfIncludes: string;
    enabled: boolean;
}

export const makeEmptyRule = (): Rule => ({
    find: "",
    replace: "",
    onlyIfIncludes: "",
    enabled: true
});

export const EMPTY_REPLACEMENT = [
    "// Runs for every match of the find pattern. Async, so you can await anything.",
    "// Return a string to replace the match with, or nothing to leave it alone.",
    "//",
    "// _ is the context:",
    "//   _.match          the matched text",
    "//   _.fullMessage    the whole message before any rule ran",
    "//   _.captureGroups  the regex capture groups",
    "//   _.member         your member object in this server",
    "//   _.guild          the current server",
    "//   _.channel        the channel you are sending in",
    ""
].join("\n");

/** Accepts /pattern/flags for regex, anything else is literal text. */
function toRegExp(source: string) {
    const delimited = source.match(/^\/(.+)\/([a-z]*)$/i);

    const pattern = delimited ? delimited[1] : escapeRegExp(source);
    const flags = delimited ? [...new Set(delimited[2].toLowerCase().split(""))].join("") : "g";

    try {
        // iteration below goes through matchAll, which needs the global flag
        return new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
    } catch {
        return null;
    }
}

function buildContext(channelId: string, content: string, match: string, captureGroups: string[]) {
    const guildId = SelectedGuildStore.getGuildId();
    const me = UserStore.getCurrentUser();

    return {
        match,
        fullMessage: content,
        captureGroups,
        member: guildId ? GuildMemberStore.getMember(guildId, me.id) : me,
        guild: guildId ? GuildStore.getGuild(guildId) : undefined,
        channel: ChannelStore.getChannel(channelId)
    };
}

export async function applyRules(channelId: string, content: string) {
    let result = content;

    for (const rule of settings.plain.rules ?? []) {
        // rules saved before the enabled flag existed have no such field, so only an
        // explicit false counts as switched off
        if (rule.enabled === false || !rule.find || !rule.replace) continue;
        if (rule.onlyIfIncludes && !result.includes(rule.onlyIfIncludes)) continue;

        const regex = toRegExp(rule.find);
        if (!regex) continue;

        let resolveMatch: (match: RegExpMatchArray) => Promise<string>;
        try {
            const fn = new Function("_", `return (async () => { ${rule.replace} })();`);
            resolveMatch = match => Promise.resolve(fn(buildContext(
                channelId,
                content,
                match[0],
                match.slice(1).map(group => group ?? "")
            ))).then(value => (value == null ? "" : String(value)));
        } catch (error) {
            // replacements are hand written, so failing to compile is a normal thing to hit
            showToast(`Skipped a rule, it does not compile: ${(error as Error).message}`, Toasts.Type.FAILURE);
            continue;
        }

        const matches = [...result.matchAll(regex)];
        if (matches.length === 0) continue;

        const resolved = await Promise.all(
            matches.map(match => resolveMatch(match).catch(error => `[${(error as Error).message}]`))
        );

        let index = 0;
        result = result.replace(regex, () => resolved[index++]);
    }

    return result;
}
