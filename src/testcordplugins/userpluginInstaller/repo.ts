/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const ALLOWED_HOSTS = new Set(["github.com", "gitlab.com", "codeberg.org"]);
const SELF_HOSTED = /^git\.[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const SEGMENT = /^[\w.-]+$/;

export interface RepoRef {
    owner: string;
    repo: string;
    link: string;
}

export interface PluginMeta {
    directory: string;
    name: string;
    description: string;
    remote: string;
    usesNative: boolean;
    usesPreSend: boolean;
}

export interface Commit {
    author: string;
    shortHash: string;
    message: string;
}

/** Only https forges we recognise, and only a plain owner/repo path. */
export function parseRepoLink(link: string): RepoRef | null {
    let url: URL;
    try {
        url = new URL(link.trim());
    } catch {
        return null;
    }

    if (url.protocol !== "https:") return null;

    const host = url.hostname.toLowerCase();
    if (!ALLOWED_HOSTS.has(host) && !SELF_HOSTED.test(host)) return null;

    const segments = url.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (segments.length !== 2 || !segments.every(segment => SEGMENT.test(segment))) return null;

    return { owner: segments[0], repo: segments[1], link: url.href };
}

export function isRepoLink(link: string) {
    return parseRepoLink(link) !== null;
}
