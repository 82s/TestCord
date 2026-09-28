/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type CaptchaProvider = "nonecap" | "nocaptchaai" | "voidsolver";

export interface VoidSolverTaskResult {
    taskId: string;
    externalTaskId?: string;
    status: string;
    solveTime?: number;
    site?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface NativeCaptchaResponse {
    success: boolean;
    token?: string;
    error?: string;
    task?: VoidSolverTaskResult;
}

export interface NativeWebhookResponse {
    status: number;
    data: string;
}

export interface WebhookField {
    name: string;
    value: string;
    inline?: boolean;
}

export interface WebhookEmbed {
    title: string;
    color: number;
    description?: string;
    fields?: WebhookField[];
    timestamp: string;
    author?: {
        name: string;
        icon_url?: string;
    };
    footer?: {
        text: string;
    };
}

export interface WebhookPayload {
    username: string;
    embeds: WebhookEmbed[];
    allowed_mentions: {
        parse: string[];
    };
}

export type WebhookResult = "claimed" | "failed";

export interface ClaimInfo {
    code: string;
    source: "discord" | "nighty";
    channelId?: string;
    channelName?: string;
    messageId?: string;
    guildId?: string;
    guildName?: string;
    authorId?: string;
    authorName?: string;
    authorAvatarUrl?: string;
    detectedAccount?: string;
    detectedAccountId?: string;
}

export interface NightyGiftDetection {
    code: string;
    accountName: string;
    guildName: string;
    channelName: string;
    authorName: string;
}
