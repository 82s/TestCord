/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PinterestImageResult, SearchTarget } from "./shared";

export function normalizeQuery(text: string) {
    return text.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/gu, " ").trim().slice(0, 240);
}

function comparable(text: string) {
    return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function imageKey(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        // Pinterest's size folders change, but its content hash does not.
        if (url.hostname === "pinimg.com" || url.hostname.endsWith(".pinimg.com")) {
            return `p:${url.pathname.split("/").pop()?.replace(/\.[^.]+$/, "")}`;
        }
        // DeviantArt filenames are not globally unique: retain host and path.
        return `${url.hostname}${url.pathname}`;
    } catch {
        return rawUrl;
    }
}

/**
 * The same picture re-pinned by different people is stored as different files,
 * so its URL differs. Pinterest reports its size and dominant colour, and the
 * pair is a reliable fingerprint for re-uploads. Plain black/white/grey
 * dominant colours are too common to trust, so those return "".
 */
export function visualKey(item: Pick<PinterestImageResult, "width" | "height" | "dominantColor">) {
    const color = item.dominantColor?.toLowerCase();
    const m = color && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(color);
    if (!m) return "";
    const [r, g, b] = [m[1], m[2], m[3]].map(v => parseInt(v, 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) < 12) return "";
    return `${item.width}x${item.height}:${color}`;
}

export function shapeDistance(item: PinterestImageResult, target: SearchTarget) {
    if (target === "IMAGE" || target === "ALL") return 0;
    const ratio = item.width / Math.max(1, item.height);
    return Math.abs(Math.log2(ratio / (target === "BANNER" ? 2.5 : 1)));
}

/** Whether an image can be cropped to the target without losing most of it. */
export function shapeFits(item: Pick<PinterestImageResult, "width" | "height">, target: SearchTarget) {
    const ratio = item.width / Math.max(1, item.height);
    if (target === "BANNER") return ratio >= 1.2;
    if (target === "AVATAR") return ratio >= 0.55 && ratio <= 1.8;
    return true;
}

const bannerHint = /\b(banner|header|wallpaper|landscape|scenery|panorama|widescreen|desktop|portada|encabezado|paisaje|fondo)\b/i;

export function hasBannerIntent(query: string) {
    return bannerHint.test(comparable(query));
}

const profileHint = /\b(pfp|icon|avatar|profile picture|icono|perfil|icone)\b|аватар|头像|頭像|アイコン|프로필|아바타/i;
const genericAvatar = /\b(default avatar|anonymous user|user placeholder|profile placeholder|default profile|app icon|application icon|social media logo)\b/i;

export function hasProfileIntent(query: string) {
    return profileHint.test(comparable(query));
}

export function rankResults(lists: PinterestImageResult[][], query: string, target: SearchTarget) {
    const terms = comparable(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const queues = lists.map(list => list.map((item, position) => {
        const text = comparable(`${item.title} ${item.description} ${item.author ?? ""}`);
        const relevance = !text.trim() || !terms.length ? 0.5 : terms.filter(term => text.includes(term)).length / terms.length;
        const quality = Math.min(1, Math.min(item.width, item.height) / (target === "BANNER" ? 600 : 512));
        const shape = 1 / (1 + shapeDistance(item, target) * 2);
        const profile = target === "AVATAR" && profileHint.test(text) ? 0.12 : 0;
        const generic = target === "AVATAR" && genericAvatar.test(text) ? 0.4 : 0;
        // Shapes that crop badly (tall pins for a banner, panoramas for an icon)
        // stay available but always rank after images that fit the target.
        const misfit = shapeFits(item, target) ? 0 : 1;
        const score = relevance * 0.32 + shape * 0.30 + quality * 0.22 + (1 - position / Math.max(1, list.length)) * 0.16 + profile - generic - misfit;
        return { item, score };
    }).sort((a, b) => b.score - a.score));

    const out: PinterestImageResult[] = [];
    const seen = new Set<string>();
    let previous = -1;
    let streak = 0;
    while (queues.some(queue => queue.length)) {
        let best = -1;
        let bestScore = -Infinity;
        queues.forEach((queue, index) => {
            if (!queue.length) return;
            const score = queue[0].score - (previous === index ? 0.045 * streak : 0);
            if (score > bestScore) { bestScore = score; best = index; }
        });
        const { item } = queues[best].shift()!;
        const id = `${item.source ?? "PINTEREST"}:${item.id}`;
        const media = imageKey(item.url);
        const look = visualKey(item);
        if (seen.has(id) || seen.has(media) || (look && seen.has(look))) continue;
        seen.add(id); seen.add(media);
        if (look) seen.add(look);
        streak = best === previous ? streak + 1 : 1;
        previous = best;
        out.push(item);
    }
    return out;
}
