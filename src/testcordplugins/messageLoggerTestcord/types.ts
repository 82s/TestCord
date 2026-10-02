/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { EmbedJSON, MessageJSON } from "@vencord/discord-types";

export const LogStatus = {
    DELETED: "DELETED",
    EDITED: "EDITED",
    GHOST_PINGED: "GHOST_PINGED"
} as const;

export type LogStatus = typeof LogStatus[keyof typeof LogStatus];
export type LogViewStatus = LogStatus | "ALL";

export interface EditRecord {
    content: string;
    timestamp: string;
    // Embed-driven messages (leaderboards, paginated bots) keep everything in the
    // embed, so without this every history entry collapses to the same stub text.
    embeds?: EmbedJSON[];
    attachments?: LoggedAttachment[];
    components?: unknown[];
    stickerItems?: unknown[];
    poll?: unknown;
    flags?: number;
    webhookId?: string | null;
    // Identity of the message this revision belongs to. Embeds are only sanitized
    // and renderable once the revision can be placed back in its channel.
    id?: string;
    channel_id?: string;
}

export interface LoggedAuthor {
    id?: string;
    username?: string;
    globalName?: string;
    global_name?: string;
    bot?: boolean;
    email?: string;
    phone?: string;
    [key: string]: unknown;
}

export interface LoggedAttachment extends Record<string, unknown> {
    id?: string;
    filename?: string;
    url?: string;
    proxy_url?: string;
    content_type?: string;
    size?: number;
    width?: number;
    height?: number;
    deleted?: boolean;
    path?: string | null;
    blobUrl?: string;
    oldUrl?: string;
    oldProxyUrl?: string;
}

export type LoggedMessage = Omit<MessageJSON, "author" | "timestamp" | "attachments"> & {
    author: LoggedAuthor;
    timestamp: string;
    attachments: LoggedAttachment[];
    guildId?: string;
    guild_id?: string;
    bot?: boolean;
    webhookId?: string | null;
    deleted?: boolean;
    deletedTimestamp?: string;
    editHistory?: EditRecord[];
    ghostPinged?: boolean;
    mentioned?: boolean;
    ourCache?: boolean;
    customRenderedContent?: unknown;
    __messageloggerDiff?: unknown;
    __messageloggerDiffKey?: unknown;
    __messageloggerAggregated?: unknown;
    __messageloggerLastAppliedKey?: unknown;
};

export interface LogRecord {
    message_id: string;
    channel_id: string;
    status: LogStatus;
    message: LoggedMessage;
    protected?: boolean;
    hidden?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface MessageCreatePayload {
    channelId: string;
    guildId?: string;
    message: MessageJSON;
}

export interface MessageUpdatePayload {
    guildId?: string;
    message: Partial<MessageJSON> & Pick<MessageJSON, "id" | "channel_id">;
}

export interface MessageDeletePayload {
    channelId: string;
    guildId?: string;
    id: string;
    mlDeleted?: boolean;
}

export interface MessageDeleteBulkPayload {
    channelId: string;
    guildId?: string;
    ids: string[];
    mlDeleted?: boolean;
}

export interface FetchMessagesResponse {
    ok: boolean;
    body: (LoggedMessage[] & { extra?: LoggedMessage[]; });
}

export interface LoadMessagesPayload {
    channelId?: string;
    hasMoreAfter: boolean;
    hasMoreBefore: boolean;
    isAfter: boolean;
    isBefore: boolean;
}

export interface LogPage {
    records: LogRecord[];
    cursor?: string;
    hasMore: boolean;
    total: number;
}

export interface LogStats {
    total: number;
    deleted: number;
    edited: number;
    ghostPinged: number;
    protected: number;
    estimatedBytes: number;
}

export interface LogExport {
    format: "MessageLoggerTestcord";
    version: 1;
    exportedAt: string;
    messages: LogRecord[];
}
