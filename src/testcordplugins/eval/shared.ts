/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const CONTENT_LIMIT = 2000;

export function stringify(value: unknown): string {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
    if (value === undefined) return "undefined";
    if (typeof value === "function") return value.toString();

    try {
        return JSON.stringify(value, null, 2) ?? String(value);
    } catch {
        return String(value);
    }
}

export function createConsole() {
    const lines: string[] = [];
    const push = (...things: unknown[]) => {
        for (const thing of things) {
            for (const line of stringify(thing).split("\n")) lines.push(line);
        }
    };

    return { lines, fake: { log: push, error: push, warn: push, info: push, debug: push } };
}

export function prepare(code: string) {
    const script = code.trim().replace(/^`{3}(js|javascript)?\n?/, "").replace(/\n?`{3}$/, "").trim();
    return script.includes("await") ? `(async () => { ${script} })()` : script;
}

function fence(body: string, lang = "") {
    const ticks = body.includes("```") ? "````" : "```";
    return `${ticks}${lang}\n${body}\n${ticks}`;
}

export function report(code: string, result: unknown, logged: string[]) {
    const output = [stringify(result), ...logged].filter(Boolean).join("\n\n");
    const content = `${fence(code)}\n${fence(output, "js")}`;

    if (content.length <= CONTENT_LIMIT) return content;
    return `${content.slice(0, CONTENT_LIMIT - 60)}\n... output truncated, ${content.length} characters total`;
}
