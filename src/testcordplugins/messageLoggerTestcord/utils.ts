/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";

export const cl = classNameFactory("vc-testcord-ml-");

export function mediaSrc(media: any): string | undefined {
    return media?.url ?? media?.proxyURL ?? media?.proxy_url ?? media?.proxyUrl;
}

// Title and description each come in two shapes; see embedFingerprint.
function embedText(embed: any): string | undefined {
    return embed.rawTitle ?? embed.title;
}

function embedDescription(embed: any): string | undefined {
    return embed.rawDescription ?? embed.description;
}

export function collectEmbedText(embed: any): string {
    if (!embed || typeof embed !== "object") return "";
    const parts: string[] = [];
    if (typeof embed.author?.name === "string") parts.push(embed.author.name);
    if (typeof embed.title === "string") parts.push(embed.title);
    if (typeof embed.rawTitle === "string") parts.push(embed.rawTitle);
    if (typeof embed.description === "string") parts.push(embed.description);
    if (typeof embed.rawDescription === "string") parts.push(embed.rawDescription);
    if (Array.isArray(embed.fields)) {
        for (const f of embed.fields) {
            if (typeof f?.name === "string") parts.push(f.name);
            if (typeof f?.value === "string") parts.push(f.value);
            if (typeof f?.rawName === "string") parts.push(f.rawName);
            if (typeof f?.rawValue === "string") parts.push(f.rawValue);
        }
    }
    if (typeof embed.footer?.text === "string") parts.push(embed.footer.text);
    if (typeof embed.provider?.name === "string") parts.push(embed.provider.name);
    if (typeof embed.url === "string") parts.push(embed.url);
    return parts.join("\n");
}

/**
 * Whether an embed still carries a body of its own.
 *
 * This is what separates a stripped embed, which Discord emptied and left as a husk,
 * from a replacement one. Bots that paginate or switch tabs reuse a single url across
 * every page and send a complete new embed each time, so "this field is missing" on
 * its own is no reason to restore the previous embed's field over it - that leaves the
 * new page's rows sitting under the old page's title and footer.
 */
export function embedHasBody(embed: any): boolean {
    if (!embed || typeof embed !== "object") return false;
    return !!embedText(embed) || !!embedDescription(embed) || (Array.isArray(embed.fields) && embed.fields.length > 0);
}

/**
 * Identity of an embed's content, ignoring the parts that change on a re-fetch.
 *
 * Title and description have to be read in both of the shapes they arrive in. A stored
 * snapshot is raw JSON and carries title/description, but anything Discord's own embed
 * model has touched exposes only rawTitle/rawDescription, and it has no title/description
 * at all. Reading one form made every page of a paginated bot fingerprint the same, so a
 * new page was indistinguishable from a stripped one and each edit appended the previous
 * page's embeds to the message.
 */
export function embedFingerprint(embed: any): string {
    if (!embed || typeof embed !== "object") return String(embed);
    try {
        return JSON.stringify({
            url: embed.url,
            type: embed.type,
            title: embedText(embed),
            description: embedDescription(embed),
            author: embed.author?.name ?? embed.author?.url,
            provider: embed.provider?.name,
            fields: Array.isArray(embed.fields) ? embed.fields.map((f: any) => ({ name: f.name ?? f.rawName, value: f.value ?? f.rawValue, inline: f.inline })) : undefined,
            footer: embed.footer?.text,
            image: mediaSrc(embed.image),
            thumbnail: mediaSrc(embed.thumbnail),
            video: mediaSrc(embed.video)
        });
    } catch {
        return `${embed.type ?? ""}|${embed.url ?? ""}|${embedText(embed) ?? ""}|${embedDescription(embed) ?? ""}`;
    }
}

/**
 * An embed's timestamp reaches us as a moment, and one that came back out of the database
 * can be invalid. Discord formats it with Intl, which throws "RangeError: Invalid time
 * value" and takes the whole channel render down with it, so it never reaches Discord
 * unvalidated.
 */
export function withValidEmbedTimestamps<T>(embeds: T[]): T[] {
    if (!Array.isArray(embeds)) return embeds;
    return embeds.map(embed => {
        if (!embed || typeof embed !== "object") return embed;
        const { timestamp } = embed as Record<string, unknown>;
        if (timestamp == null) return embed;
        const date = (timestamp as { isValid?: () => boolean; toDate?: () => Date; })?.isValid?.call(timestamp)
            ? (timestamp as { toDate: () => Date; }).toDate()
            : new Date(timestamp as string);
        if (date && !Number.isNaN(date.valueOf())) return { ...embed, timestamp: date } as T;
        const { timestamp: _invalid, ...rest } = embed as Record<string, unknown>;
        return rest as T;
    });
}

export function collectComponentText(component: any): string {
    if (!component || typeof component !== "object") return "";
    const parts: string[] = [];
    if (typeof component.content === "string") parts.push(component.content);
    if (typeof component.label === "string") parts.push(component.label);
    if (typeof component.placeholder === "string") parts.push(component.placeholder);
    if (typeof component.value === "string") parts.push(component.value);
    if (Array.isArray(component.components)) {
        for (const child of component.components) {
            const text = collectComponentText(child);
            if (text) parts.push(text);
        }
    }
    if (component.accessory) {
        const text = collectComponentText(component.accessory);
        if (text) parts.push(text);
    }
    if (Array.isArray(component.media)) {
        for (const item of component.media) {
            if (typeof item?.description === "string") parts.push(item.description);
            if (typeof item?.alt === "string") parts.push(item.alt);
        }
    }
    if (Array.isArray(component.items)) {
        for (const item of component.items) {
            const text = collectComponentText(item);
            if (text) parts.push(text);
        }
    }
    return parts.join("\n");
}

export function collectLoggedMessageText(message: any): string {
    if (!message || typeof message !== "object") return "";
    const parts: string[] = [];
    if (typeof message.content === "string" && message.content) parts.push(message.content);
    if (Array.isArray(message.embeds)) {
        for (const embed of message.embeds) {
            const text = collectEmbedText(embed);
            if (text) parts.push(text);
        }
    }
    const components = message.components ?? message.messageSnapshots?.flatMap?.((s: any) => s?.message?.components ?? []);
    if (Array.isArray(components)) {
        for (const component of components) {
            const text = collectComponentText(component);
            if (text) parts.push(text);
        }
    }
    if (Array.isArray(message.stickerItems)) {
        for (const sticker of message.stickerItems) {
            if (typeof sticker?.name === "string") parts.push(sticker.name);
        }
    }
    if (Array.isArray(message.stickers)) {
        for (const sticker of message.stickers) {
            if (typeof sticker?.name === "string") parts.push(sticker.name);
        }
    }
    if (typeof message.poll?.question?.text === "string") parts.push(message.poll.question.text);
    // Revisions count as content: an embed-only edit leaves the current message empty,
    // so without this the old text and embeds are neither searchable nor copyable.
    if (Array.isArray(message.editHistory)) {
        for (const edit of message.editHistory) {
            if (!edit || typeof edit !== "object") continue;
            if (typeof edit.content === "string" && edit.content) parts.push(edit.content);
            if (Array.isArray(edit.embeds)) {
                for (const embed of edit.embeds) {
                    const text = collectEmbedText(embed);
                    if (text) parts.push(text);
                }
            }
        }
    }
    return parts.join("\n");
}
