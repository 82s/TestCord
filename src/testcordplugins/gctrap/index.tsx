/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton } from "@api/ChatButtons";
import { ChannelToolbarButton } from "@api/HeaderBar";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Channel, RenderModalProps } from "@vencord/discord-types";
import { Modal, showToast, TabBar, Toasts, useState } from "@webpack/common";
import type { SVGProps } from "react";

import { forgetAll, forgetGroup, kickMember, log, notify, readdMember, trackGroup } from "./actions";
import { isGroup, selfId } from "./api";
import DashboardTab from "./components/DashboardTab";
import LogTab from "./components/LogTab";
import NewTab from "./components/NewTab";
import { settings } from "./settings";
import { GctrapStore } from "./store";
import { cl } from "./utils";

type Tab = "new" | "dashboard" | "log";
type CreatedGroup = Channel & { creator_id?: string; };
const BUTTON_LOCATION: ["buttonLocation"] = ["buttonLocation"];

function GctrapIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
            <path d="M12 3a3 3 0 110 6 3 3 0 010-6zm-7 4a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm14 0a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM12 11c3.31 0 6 2.01 6 4.5V18H6v-2.5C6 13.01 8.69 11 12 11zM3 14c1.93 0 3.5 1.34 3.5 3v2h-5v-2c0-1.66 1.57-3 3.5-3zm18 0c1.93 0 3.5 1.34 3.5 3v2h-5v-2c0-1.66 1.57-3 3.5-3z" />
        </svg>
    );
}

function openGctrapModal(tab: Tab = "new") {
    openModal(props => (
        <ErrorBoundary message="gctrap could not draw its window.">
            <GctrapModal initialTab={tab} {...props} />
        </ErrorBoundary>
    ));
}

function GctrapModal({ initialTab, ...modalProps }: RenderModalProps & { initialTab: Tab; }) {
    const [tab, setTab] = useState<Tab>(initialTab);

    return (
        <Modal {...modalProps} size="xl" title="gctrap" subtitle="Keep the group exactly the way you left it">
            <TabBar
                type="top"
                look="brand"
                className={cl("tabs")}
                selectedItem={tab}
                onItemSelect={(id: Tab) => setTab(id)}
            >
                <TabBar.Item className={cl("tab")} id="new">New</TabBar.Item>
                <TabBar.Item className={cl("tab")} id="dashboard">Dashboard</TabBar.Item>
                <TabBar.Item className={cl("tab")} id="log">Activity</TabBar.Item>
            </TabBar>
            {tab === "new" && (
                <NewTab
                    onTrack={(channelId, members, name) => {
                        trackGroup(channelId, members, name);
                        setTab("dashboard");
                    }}
                />
            )}
            {tab === "dashboard" && (
                <DashboardTab
                    onCreate={() => setTab("new")}
                    onTrack={channelId => {
                        trackGroup(channelId);
                        showToast("Added that group to the dashboard", Toasts.Type.SUCCESS);
                    }}
                />
            )}
            {tab === "log" && <LogTab />}
        </Modal>
    );
}

function GctrapChatButton() {
    const { buttonLocation } = settings.use(BUTTON_LOCATION);
    if (!["chatbar", "both"].includes(buttonLocation)) return null;

    return (
        <ChatBarButton tooltip="gctrap" onClick={() => openGctrapModal("dashboard")}>
            <GctrapIcon />
        </ChatBarButton>
    );
}

function GctrapHeaderButton() {
    const { buttonLocation } = settings.use(BUTTON_LOCATION);
    if (!["headerbar", "both"].includes(buttonLocation)) return null;

    return (
        <ChannelToolbarButton
            icon={GctrapIcon}
            tooltip="gctrap"
            onClick={() => openGctrapModal("dashboard")}
        />
    );
}

export default definePlugin({
    name: "gctrap",
    description: "Builds group chats in waves and keeps them exactly the way you set them up.",
    authors: [TestcordDevs.x2b],
    tags: ["Friends", "Utility"],
    settings,

    async start() {
        await GctrapStore.getState().load();
    },

    stop() {
        forgetAll();
    },

    chatBarButton: {
        icon: GctrapIcon,
        render: GctrapChatButton
    },

    headerBarButton: {
        icon: GctrapIcon,
        render: GctrapHeaderButton,
        location: "channeltoolbar"
    },

    flux: {
        CHANNEL_CREATE({ channel }: { channel?: CreatedGroup; }) {
            if (!settings.store.autoTrack || !channel || !isGroup(channel)) return;
            if (channel.creator_id !== selfId()) return;
            trackGroup(channel.id);
        },

        async CHANNEL_RECIPIENT_ADD({ channel_id, user_id }: { channel_id: string; user_id: string; }) {
            const group = GctrapStore.getState().getGroup(channel_id);
            if (!group || user_id === selfId()) return;

            if (group.members.includes(user_id)) {
                log(group, "A member you allowlisted was added back, probably by you");
                return;
            }
            await kickMember(group, user_id, "joined the group");
        },

        async CHANNEL_RECIPIENT_REMOVE({ channel_id, user_id }: { channel_id: string; user_id: string; }) {
            const group = GctrapStore.getState().getGroup(channel_id);
            if (!group) return;

            if (user_id === selfId()) {
                notify("You are out of the group", "gctrap stopped tracking it because you are no longer in there.");
                forgetGroup(group.id);
                return;
            }
            if (!group.members.includes(user_id)) return;

            await readdMember(group, user_id, "left the group");
        }
    }
});
