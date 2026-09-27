/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

const logger = new Logger("Clipboard");

/**
 * `navigator.clipboard` is unavailable or refused often enough to be worth a fallback:
 * it is missing outright on some Electron wrappers and insecure contexts, and it rejects
 * with NotAllowedError whenever the document is not focused. A copy button that then does
 * nothing is indistinguishable from a broken one, so selection + execCommand is the
 * last resort. That path is deprecated but remains the only synchronous option.
 */
function copyViaSelection(text: string): Promise<void> {
    const area = document.createElement("textarea");
    area.value = text;
    // Keep it out of view and out of the tab order, and stop iOS from scrolling to it.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";

    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);

    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch (e) {
        logger.error("execCommand copy failed", e);
    } finally {
        area.remove();
        if (previous) {
            selection?.removeAllRanges();
            selection?.addRange(previous);
        }
    }

    return ok ? Promise.resolve() : Promise.reject(new Error("Copying to the clipboard was refused."));
}

export async function copyToClipboard(text: string): Promise<void> {
    // Both paths are guarded, not just the web one. `DiscordNative.clipboard.copy` is not
    // dependable on every client: where the async clipboard is missing it reaches for
    // `navigator.clipboard` internally and throws a TypeError on `.writeText` from inside
    // its own implementation, which used to escape the copy entirely. Whichever path is
    // taken, a throw falls through to the selection fallback.
    const native = IS_DISCORD_DESKTOP ? DiscordNative.clipboard : undefined;
    if (native?.copy) {
        try {
            await native.copy(text);
            return;
        } catch (e) {
            logger.warn("DiscordNative clipboard copy failed, falling back", e);
        }
    }

    try {
        const { clipboard } = navigator;
        if (clipboard?.writeText) {
            await clipboard.writeText(text);
            return;
        }
    } catch (e) {
        logger.warn("navigator.clipboard was unusable, falling back", e);
    }

    return copyViaSelection(text);
}

export async function readClipboard(): Promise<string> {
    const native = IS_DISCORD_DESKTOP ? DiscordNative.clipboard : undefined;
    if (native?.read) {
        try {
            return await native.read();
        } catch (e) {
            logger.warn("DiscordNative clipboard read failed, falling back", e);
        }
    }

    try {
        const { clipboard } = navigator;
        if (clipboard?.readText) return await clipboard.readText();
    } catch (e) {
        logger.warn("navigator.clipboard was unusable for reading", e);
    }

    throw new Error("Reading the clipboard is not available on this client.");
}
