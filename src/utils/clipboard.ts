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
    if (IS_DISCORD_DESKTOP && DiscordNative.clipboard?.copy) {
        await DiscordNative.clipboard.copy(text);
        return;
    }

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (e) {
            logger.warn("navigator.clipboard.writeText was refused, falling back", e);
        }
    }

    return copyViaSelection(text);
}

export function readClipboard(): Promise<string> {
    return IS_DISCORD_DESKTOP ? DiscordNative.clipboard.read() : navigator.clipboard.readText();
}
