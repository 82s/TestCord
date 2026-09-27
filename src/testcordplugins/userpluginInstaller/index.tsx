/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { ErrorCard } from "@components/ErrorCard";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { TestcordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { useAwaiter, useForceUpdater } from "@utils/react";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { showToast, Toasts, useState } from "@webpack/common";

import { type Commit, isRepoLink, type PluginMeta } from "./repo";

const Native = VencordNative.pluginHelpers.UserpluginInstaller as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    channels: {
        description: "Only offer the install button in these channels (comma separated, empty for all)",
        type: OptionType.STRING,
        default: ""
    },
    notifyOnUpdate: {
        description: "Tell me when an installed plugin has updates waiting",
        type: OptionType.BOOLEAN,
        default: true
    },
    ignoreUpdates: {
        description: "Never notify about updates for these plugins (comma separated)",
        type: OptionType.STRING,
        default: ""
    },
    git: {
        type: OptionType.COMPONENT,
        description: "Git has to be installed and reachable for any of this to work",
        component: () => (
            <Flex gap="4px">
                <Button
                    variant="secondary"
                    size="small"
                    onClick={async () => {
                        try {
                            showToast(`Found ${await Native.checkGit()}`, Toasts.Type.SUCCESS);
                        } catch (error) {
                            showToast((error as Error).message, Toasts.Type.FAILURE);
                        }
                    }}
                >
                    Check git
                </Button>
                <Button
                    variant="secondary"
                    size="small"
                    onClick={async () => {
                        await Native.ensurePluginsDirectory();
                        showToast("The userplugins folder is ready", Toasts.Type.SUCCESS);
                    }}
                >
                    Create the folder
                </Button>
            </Flex>
        )
    },
    installed: {
        type: OptionType.COMPONENT,
        description: "Plugins you have installed",
        component: InstalledPlugins
    }
});

function listed(value: string) {
    return value.split(",").map(entry => entry.trim()).filter(Boolean);
}

function reloadSoon() {
    window.setTimeout(() => window.location.reload(), 1200);
}

async function install(link: string) {
    let meta: PluginMeta;
    try {
        meta = await Native.clonePlugin(link);
    } catch (error) {
        showToast((error as Error).message, Toasts.Type.FAILURE);
        return;
    }

    openModal(props => (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader>
                <Paragraph>Install {meta.name}?</Paragraph>
            </ModalHeader>
            <ModalContent>
                <Paragraph size="sm">{meta.description}</Paragraph>
                {meta.remote && <Paragraph size="xs">From {meta.remote}</Paragraph>}

                {(meta.usesNative || meta.usesPreSend) && (
                    <ErrorCard>
                        <Paragraph size="xs">
                            {meta.usesPreSend
                                ? "This plugin reads and rewrites messages before they are sent."
                                : "This plugin ships native code that runs on your machine."}
                            {" "}Only install it if you trust the author.
                        </Paragraph>
                    </ErrorCard>
                )}
            </ModalContent>
            <ModalFooter>
                <Flex gap="4px" justifyContent="end">
                    <Button variant="secondary" onClick={() => props.onClose()}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={async () => {
                            props.onClose();
                            try {
                                await Native.build();
                            } catch (error) {
                                await Native.discardPlugin(meta.directory);
                                showToast(`The build failed, nothing was installed: ${(error as Error).message}`, Toasts.Type.FAILURE);
                                return;
                            }
                            showToast(`${meta.name} installed, reloading`, Toasts.Type.SUCCESS);
                            reloadSoon();
                        }}
                    >
                        Install
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    ));
}

function PluginRow({ plugin }: { plugin: PluginMeta }) {
    const [commits] = useAwaiter(() => Native.pendingCommits(plugin.directory), { fallbackValue: [] as Commit[] });
    const [busy, setBusy] = useState(false);
    const forceUpdate = useForceUpdater();

    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await action();
        } catch (error) {
            showToast((error as Error).message, Toasts.Type.FAILURE);
        } finally {
            setBusy(false);
            forceUpdate();
        }
    };

    return (
        <div className="vc-userplugin-row">
            <div>
                <Paragraph size="sm">{plugin.name}</Paragraph>
                <Paragraph size="xs">{plugin.description}</Paragraph>
                {commits.length > 0 && (
                    <Paragraph size="xs">
                        {commits.length} update{commits.length === 1 ? "" : "s"} waiting, newest{" "}
                        {commits[0].shortHash} by {commits[0].author}
                    </Paragraph>
                )}
            </div>
            <Flex gap="4px">
                <Button
                    variant="secondary"
                    size="small"
                    disabled={busy || commits.length === 0}
                    onClick={() => run(async () => {
                        await Native.updatePlugin(plugin.directory);
                        await Native.build();
                        showToast(`${plugin.name} updated, reloading`, Toasts.Type.SUCCESS);
                        reloadSoon();
                    })}
                >
                    Update
                </Button>
                <Button
                    variant="dangerSecondary"
                    size="small"
                    disabled={busy}
                    onClick={() => run(() => Native.removePlugin(plugin.directory))}
                >
                    Remove
                </Button>
            </Flex>
        </div>
    );
}

function InstalledPlugins() {
    const [plugins] = useAwaiter(() => Native.getUserplugins(), { fallbackValue: [] as PluginMeta[] });

    if (plugins.length === 0) return <Paragraph size="xs">No userplugins installed yet.</Paragraph>;

    return (
        <div className="vc-userplugin-list">
            {plugins.map(plugin => <PluginRow key={plugin.directory} plugin={plugin} />)}
        </div>
    );
}

export default definePlugin({
    name: "UserpluginInstaller",
    description: "Install and update userplugins without leaving Discord",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.x2b],
    settings,

    async start() {
        const ignored = listed(settings.plain.ignoreUpdates).map(entry => entry.toLowerCase());
        const plugins = await Native.getUserplugins();

        const stale: string[] = [];
        for (const plugin of plugins) {
            if (ignored.includes(plugin.directory.toLowerCase())) continue;
            if (await Native.hasUpdates(plugin.directory)) stale.push(plugin.name);
        }

        if (stale.length === 0 || !settings.plain.notifyOnUpdate) return;

        showNotification({
            title: "Userplugin updates available",
            body: `${stale.join(", ")} ${stale.length === 1 ? "has" : "have"} updates waiting.`
        });
    },

    renderMessageAccessory: props => {
        const { channels } = settings.plain;
        if (channels && !listed(channels).includes(props.message.channel_id)) return null;

        const links = (props.message.content ?? "").match(/https:\/\/\S+/g) ?? [];
        const repos = links.filter(isRepoLink);
        if (repos.length === 0) return null;

        return (
            <Button variant="secondary" size="small" onClick={() => install(repos[0])}>
                {repos.length === 1 ? "Install this plugin" : `Install a plugin (${repos.length} found)`}
            </Button>
        );
    }
});
