/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { relaunch } from "@utils/native";
import { useAwaiter } from "@utils/react";
import { Alerts, showToast, TextInput, Toasts, useState } from "@webpack/common";

import { restart, settings } from "..";
import { getPassword, ping, setPassword } from "../api";

export function ServerConfig() {
    const [password] = useAwaiter(getPassword, { fallbackValue: "" });
    const [busy, setBusy] = useState(false);

    const signIn = async () => {
        const { serverURL, username } = settings.plain;

        if (!serverURL || !username || !password) {
            showToast("Fill in the server, username and password first", Toasts.Type.FAILURE);
            return;
        }

        let host: URL;
        try {
            host = new URL(serverURL);
        } catch {
            showToast("That server URL is not valid", Toasts.Type.FAILURE);
            return;
        }

        if (!["http:", "https:"].includes(host.protocol)) {
            showToast("The server URL has to start with http:// or https://", Toasts.Type.FAILURE);
            return;
        }

        setBusy(true);
        try {
            await ping();
            restart();
            showToast("Connected to Navidrome", Toasts.Type.SUCCESS);
        } catch (error) {
            const { message } = (error as Error);

            if (!/denied|refused|not allowed|blocked|failed to fetch/i.test(message)) {
                showToast(`Could not reach Navidrome: ${message}`, Toasts.Type.FAILURE);
                return;
            }

            Alerts.show({
                title: "Allow the Navidrome server",
                body: "Discord's security policy blocks requests to servers it does not know about. Approving adds your server to the allowlist and restarts the client.",
                confirmText: "Allow and restart",
                cancelText: "Cancel",
                onConfirm: async () => {
                    const result = await VencordNative.csp.requestAddOverride(serverURL, ["connect-src"], "NavidromeRPC");
                    if (result === "ok") relaunch();
                    else showToast("Could not add the allowlist entry", Toasts.Type.FAILURE);
                }
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Flex flexDirection="column" gap="8px" className="vc-navidrome-server">
            <Paragraph size="xs">Connect to your Navidrome server.</Paragraph>

            <TextInput
                placeholder="Server, for example http://localhost:4533"
                defaultValue={settings.plain.serverURL}
                spellCheck={false}
                onBlur={event => { settings.store.serverURL = event.currentTarget.value.trim(); }}
            />
            <TextInput
                placeholder="Username"
                defaultValue={settings.plain.username}
                spellCheck={false}
                onBlur={event => { settings.store.username = event.currentTarget.value.trim(); }}
            />
            <TextInput
                placeholder="Password"
                type="password"
                defaultValue={password}
                spellCheck={false}
                onBlur={event => { void setPassword(event.currentTarget.value); }}
            />

            <Button variant="primary" disabled={busy} onClick={signIn}>
                {busy ? "Connecting..." : "Connect"}
            </Button>
        </Flex>
    );
}
