/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { app } from "electron";

const EMBED_ORIGIN = "https://open.spotify.com";
const RETRY_INTERVAL = 150;
const RETRY_BUDGET = 100;

/**
 * Runs inside the Spotify embed, so it cannot touch anything but its own document.
 * Anchoring on the aria labels of the transport buttons rather than on a class name,
 * since Spotify rebuilds and re-hashes its own stylesheet often enough that a hashed
 * selector stops matching without warning.
 */
const INJECT = `
(() => {
    const MESSAGE = "vc-spotifyaddtoqueue__";
    let attempts = 0;

    const trackId = () => location.href.match(/\\/embed\\/(?:track|episode)\\/([A-Za-z0-9]{1,64})/)?.[1] ?? null;

    const mount = () => {
        const next = document.querySelector('[aria-label="Next"], [aria-label="Next track"]');
        const play = document.querySelector('[aria-label="Play"], [aria-label="Pause"]');
        const host = next?.parentElement ?? play?.parentElement;
        if (!host || host.querySelector('[data-vc-add-to-queue]')) return true;

        const button = document.createElement("button");
        button.dataset.vcAddToQueue = "true";
        button.type = "button";
        button.title = "Add to queue";
        button.setAttribute("aria-label", "Add to queue");
        Object.assign(button.style, {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            padding: "0",
            border: "none",
            borderRadius: "50%",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            opacity: "0.7"
        });

        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-520H200v-80h240v-80h80v160h240v80H520v200h160v80H520v240h-80v-240H200v-80h240v-200Z"/></svg>';

        button.addEventListener("click", () => {
            const id = trackId();
            if (id) window.top.postMessage(MESSAGE + id, "*");
        });
        button.addEventListener("mouseenter", () => { button.style.opacity = "1"; });
        button.addEventListener("mouseleave", () => { button.style.opacity = "0.7"; });

        next ? host.insertBefore(button, next) : host.appendChild(button);
        return true;
    };

    const timer = setInterval(() => {
        if (mount() || ++attempts > ${RETRY_BUDGET}) clearInterval(timer);
    }, ${RETRY_INTERVAL});

    globalThis.addEventListener("pagehide", () => clearInterval(timer), { once: true });
})();
`;

app.on("browser-window-created", (_, win) => {
    win.webContents.on("frame-created", (_, { frame }) => {
        frame?.once("dom-ready", () => {
            if (!frame.url.startsWith(`${EMBED_ORIGIN}/embed/`)) return;
            if (!RendererSettings.store.plugins?.SpotifyAddToQueue?.enabled) return;

            frame.executeJavaScript(INJECT).catch(() => { });
        });
    });
});
