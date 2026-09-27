/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";
import { randomBytes } from "crypto";
import { BrowserWindow, Notification } from "electron";
import { createServer, type Server, type Socket } from "net";

const MESSAGE_EVENT = "testcord-socket-message";
const MAX_MESSAGE_LENGTH = 2000;
const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

let server: Server | null = null;
const openSockets = new Set<Socket>();
let password = "";
let allowUnauthedLocal = false;

function notify(title: string, body: string) {
    if (Notification.isSupported()) new Notification({ title: `Socket: ${title}`, body, silent: true }).show();
}

function settings() {
    const stored = RendererSettings.store.plugins?.Socket;
    return {
        port: stored?.port || 3009,
        host: stored?.host || "127.0.0.1",
        password: stored?.password || "",
        allowUnauthedLocalConnections: stored?.allowUnauthedLocalConnections || false
    };
}

/**
 * Everything a socket sends is untrusted network input, so the first line is only ever
 * compared against the password and the rest is length capped before it reaches the renderer.
 */
function attachClient(win: Electron.BrowserWindow, socket: Socket) {
    openSockets.add(socket);
    socket.setNoDelay(true);

    let authenticated = LOOPBACK.includes(socket.remoteAddress ?? "") && allowUnauthedLocal;
    let buffer = "";

    const deliver = (line: string) => {
        const content = line.slice(0, MAX_MESSAGE_LENGTH);
        if (!content) return;
        win.webContents
            .executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(MESSAGE_EVENT)}, { detail: ${JSON.stringify(content)} }))`)
            .catch(() => { });
    };

    socket.on("data", chunk => {
        buffer += chunk.toString("utf-8");
        if (buffer.length > MAX_MESSAGE_LENGTH * 2) {
            socket.destroy();
            return;
        }

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;

            if (!authenticated) {
                if (line === password) {
                    authenticated = true;
                    socket.write("authed\n");
                    notify("client authenticated", `${socket.remoteAddress} can now send messages`);
                } else {
                    notify("rejected client", `${socket.remoteAddress} sent a bad password`);
                    socket.destroy();
                }
                return;
            }

            deliver(line);
        }
    });

    const teardown = () => {
        openSockets.delete(socket);
        notify("client disconnected", socket.remoteAddress ?? "unknown address");
    };

    socket.on("close", teardown);
    socket.on("error", teardown);
}

export function startServer() {
    if (server?.listening) return password;

    const { port, host, password: configured, allowUnauthedLocalConnections } = settings();
    password = configured;
    allowUnauthedLocal = allowUnauthedLocalConnections;

    let generated: string | null = null;
    if (!password) {
        generated = password = randomBytes(16).toString("hex");
    }

    server = createServer(socket => {
        const [win] = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
        if (!win) {
            socket.destroy();
            return;
        }
        attachClient(win, socket);
    });

    server.on("error", error => {
        notify("server error", (error as NodeJS.ErrnoException).code ?? "could not start listening");
        server = null;
    });

    server.listen(port, host, () => {
        notify("listening", `On ${host}:${port}${generated ? " with a generated session password" : ""}`);
        if (generated) console.log(`[Socket] Generated session password: ${generated}`);
    });

    return password;
}

export function stopServer() {
    for (const socket of openSockets) socket.destroy();
    openSockets.clear();
    server?.close();
    server = null;
}
