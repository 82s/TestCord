/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, session, Session } from "electron";

/**
 * Electron only keeps one listener per Session/webRequest event: every new
 * registration replaces the previous one. Discord's own desktop core registers
 * an onHeadersReceived listener on development builds (allowDevHosts), silently
 * replacing ours and leaving the stock CSP in place, which breaks themes.
 *
 * This multiplexer intercepts registrations and dispatches to all of them in
 * registration order, feeding each listener the headers as modified by the
 * previous ones.
 */

type HeadersReceivedListener = (
    details: Electron.OnHeadersReceivedListenerDetails,
    callback: (response: Electron.HeadersReceivedResponse) => void
) => void;

interface ListenerEntry {
    matches: (url: string, resourceType: string) => boolean;
    listener: HeadersReceivedListener;
}

const patched = new WeakSet<Electron.WebRequest>();

export function patchWebRequestMultiplexer() {
    // Sessions can only be created once the app is ready, and their first
    // listener usually registers the moment that happens, so deferring the
    // install to whenReady is already too late. Session instances are created
    // lazily on first access, so hook the creation instead: patchSession then
    // runs before the caller that triggered it can register anything.
    app.on("session-created", patchSession);

    try {
        patchSession(session.defaultSession);
    } catch {
        // App is not ready yet, the session-created hook above handles it
    }
}

function patchSession(ses: Session) {
    const webRequest = ses.webRequest;
    if (patched.has(webRequest)) return;

    patched.add(webRequest);

    const listeners: ListenerEntry[] = [];

    // Electron may define the webRequest methods on the instance itself or on its prototype, depending on version/build
    const originalOnHeadersReceived = webRequest.onHeadersReceived ?? Object.getPrototypeOf(webRequest)?.onHeadersReceived;
    if (typeof originalOnHeadersReceived !== "function") {
        console.warn("[Testcord] Could not find webRequest.onHeadersReceived to patch");
        return;
    }

    const dispatch = (details: Electron.OnHeadersReceivedListenerDetails, callback: (response: Electron.HeadersReceivedResponse) => void) => {
        const response: Electron.HeadersReceivedResponse = { cancel: false, responseHeaders: details.responseHeaders };

        const run = (index: number) => {
            // Electron's response type also allows plain string values, its request details do not
            details.responseHeaders = response.responseHeaders as Record<string, string[]>;

            for (let i = index; i < listeners.length; i++) {
                const entry = listeners[i];
                if (!entry.matches(details.url, details.resourceType)) continue;

                let handled = false;
                try {
                    entry.listener(details, res => {
                        handled = true;
                        if (res.cancel) response.cancel = true;
                        if (res.responseHeaders) response.responseHeaders = res.responseHeaders;
                    });
                } catch (err) {
                    console.error("[Testcord] webRequest listener threw", err);
                    continue;
                }

                if (handled) return run(i + 1);
            }

            callback(response);
        };

        run(0);
    };

    webRequest.onHeadersReceived = function (...args: unknown[]) {
        const hasFilter = args.length > 1;
        const listener = (hasFilter ? args[1] : args[0]) as HeadersReceivedListener | null;

        // Electron erases the whole listener on a null, not just one filter
        if (listener == null) {
            listeners.length = 0;
        } else {
            const filter = hasFilter ? (args[0] as Electron.WebRequestFilter) : null;
            listeners.push({ matches: createMatcher(filter), listener });
        }

        if (listeners.length)
            Reflect.apply(originalOnHeadersReceived, this, [dispatch]);
        else
            Reflect.apply(originalOnHeadersReceived, this, [null]);
    };
}

// Mirrors the match pattern syntax Electron/Chromium use for filter urls
function createMatcher(filter: Electron.WebRequestFilter | null) {
    const urls = filter?.urls?.length ? filter.urls : ["<all_urls>"];
    const types = filter?.types?.length ? new Set<string>(filter.types) : null;
    const excludeUrls = filter?.excludeUrls;

    const matchers = urls.map(createUrlMatcher);
    const excluded = excludeUrls?.map(createUrlMatcher);

    return (url: string, resourceType: string) => {
        if (types && !types.has(resourceType)) return false;
        if (!matchers.some(matcher => matcher(url))) return false;

        return !excluded?.some(matcher => matcher(url));
    };
}

function createUrlMatcher(pattern: string) {
    if (pattern === "<all_urls>") {
        return (url: string) => /^(https?|wss?|file|ftp):/.test(url) || url.startsWith("urn:");
    }

    const match = /^(\*|http|https|file|ftp|urn):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (!match) return () => false;

    const [, scheme, host, path] = match;
    const schemeRegex = scheme === "*" ? "https?" : scheme === "urn" ? "urn" : `${scheme}s?`;
    const hostRegex = host === "*" ? "[^/]+" : host.startsWith("*.") ? `(?:[^/]+\\.)?${escapeRegExp(host.slice(2))}` : escapeRegExp(host);
    const pathRegex = path === "/*" ? "/.*" : escapeRegExp(path);

    const regex = new RegExp(`^${schemeRegex}://${hostRegex}${pathRegex}`);
    return (url: string) => regex.test(url);
}

function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
