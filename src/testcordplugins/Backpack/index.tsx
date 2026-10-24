/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BackpackedButtons, ChatBarButton, ChatBarButtonFactory, chatBarButtonListeners, ChatBarButtonMap, notifyBackpackChange, setChatBarButtonOrderResolver } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Clickable, ContextMenuApi, Menu, openModal, Popout, React, SelectedChannelStore, useRef, useState } from "@webpack/common";

import backpackStyle from "./style.css?managed";

const BACKPACK_ID = "Backpack";

// --- Icons ---

function BackpackIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 8V6a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 10.5v8A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-8A2.5 2.5 0 0 1 6.5 8H7Zm2 0h6V6a3 3 0 1 0-6 0v2Zm-1 5a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H8Z" />
        </svg>
    );
}

function BriefcaseIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 3a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3V5a2 2 0 0 0-2-2H9Zm2 2h2v2h-2V5Zm-7 4h16v3.2A2 2 0 0 1 18 14H6a2 2 0 0 1-2-1.8V9Zm0 5.8A3.99 3.99 0 0 0 6 16h12a3.99 3.99 0 0 0 2-1.2V19H4v-4.2Z" />
        </svg>
    );
}

function BagIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 7a4 4 0 0 0-8 0v1H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-3V7Zm-6 1V7a2 2 0 1 1 4 0v1h-4Zm-5 3h2v2a1 1 0 1 0 2 0v-2h6v2a1 1 0 1 0 2 0v-2h2v9H5v-9Z" />
        </svg>
    );
}

function ChestIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a1 1 0 0 1-1 1h-6.2a2 2 0 0 0-3.6 0H4a1 1 0 0 1-1-1V5Zm0 7a1 1 0 0 1 1-1h6.2a2 2 0 0 0 3.6 0H20a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7Zm8 1a1 1 0 1 0 2 0 1 1 0 0 0-2 0Z" />
        </svg>
    );
}

function FolderIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4a2 2 0 0 1 2-2h4.586a1 1 0 0 1 .707.293L12.414 4H19a2 2 0 0 1 2 2v1h-8.586a1 1 0 0 0-.707.293L9.586 9H3V4Zm0 7h7.172l1.414-1.414A2 2 0 0 1 13 9h8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8Z" />
        </svg>
    );
}

function GridIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4h4v4H4V4Zm6 0h4v4h-4V4Zm6 0h4v4h-4V4ZM4 10h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4ZM4 16h4v4H4v-4Zm6 0h4v4h-4v-4Zm6 0h4v4h-4v-4Z" />
        </svg>
    );
}

function SparklesIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2Zm7 13l1.2 2.8L23 19l-2.8 1.2L19 23l-1.2-2.8L15 19l2.8-1.2L19 15ZM5 16l1 2.5L8.5 19.5 6 20.5 5 23l-1-2.5L1.5 19.5 4 18.5 5 16Z" />
        </svg>
    );
}

function ArchiveIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8H3a1 1 0 0 1-1-1V4Zm3 6v10h12V10H6Zm4 3h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2Zm-6-7v2h16V6H4Z" />
        </svg>
    );
}

function ReorderIcon({ width = 16, height = 16 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z" />
        </svg>
    );
}

function SettingsIcon({ width = 16, height = 16 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.44.17-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z" />
        </svg>
    );
}

function EyeIcon({ width = 16, height = 16 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5ZM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5Zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3Z" />
        </svg>
    );
}

function getBackpackIcon(type: string) {
    switch (type) {
        case "briefcase": return BriefcaseIcon;
        case "bag": return BagIcon;
        case "chest": return ChestIcon;
        case "folder": return FolderIcon;
        case "grid": return GridIcon;
        case "sparkles": return SparklesIcon;
        case "archive": return ArchiveIcon;
        case "backpack":
        default: return BackpackIcon;
    }
}

// --- Settings ---

const settings = definePluginSettings({
    autoPackNewButtons: {
        type: OptionType.BOOLEAN,
        description: "Automatically pack newly added chat bar buttons into the backpack",
        default: true
    },
    showPackedCount: {
        type: OptionType.BOOLEAN,
        description: "Show a badge with the number of packed buttons",
        default: true
    },
    iconType: {
        type: OptionType.SELECT,
        description: "Icon style for Backpack",
        options: [
            { label: "Classic Backpack", value: "backpack", default: true },
            { label: "Briefcase", value: "briefcase" },
            { label: "Duffle / Bag", value: "bag" },
            { label: "Storage Chest", value: "chest" },
            { label: "Folder", value: "folder" },
            { label: "Apps Grid", value: "grid" },
            { label: "Sparkles", value: "sparkles" },
            { label: "Archive Box", value: "archive" }
        ]
    },
    showInChatBar: {
        type: OptionType.BOOLEAN,
        description: "Show Backpack in the chat bar",
        default: true
    },
    showInHeaderBar: {
        type: OptionType.BOOLEAN,
        description: "Show Backpack in the channel header bar (top toolbar)",
        default: false
    },
    showInTitleBar: {
        type: OptionType.BOOLEAN,
        description: "Show Backpack in the window title bar",
        default: false
    },
    closeOnUse: {
        type: OptionType.BOOLEAN,
        description: "Close the backpack preview tray after clicking a packed button",
        default: false
    },
    packedButtons: {
        type: OptionType.CUSTOM,
        description: "Packed button IDs",
        hidden: true,
        default: [] as string[]
    },
    buttonOrder: {
        type: OptionType.CUSTOM,
        description: "Custom button display order",
        hidden: true,
        default: [] as string[]
    }
});

function applyCustomOrder(buttons: { key: string; render: ChatBarButtonFactory; }[]) {
    const order = settings.store.buttonOrder ?? [];
    if (!order.length) return buttons;
    const orderMap = new Map(order.map((id, index) => [id, index]));
    return [...buttons].sort((a, b) => {
        const idxA = orderMap.has(a.key) ? orderMap.get(a.key) ?? 9999 : 9999;
        const idxB = orderMap.has(b.key) ? orderMap.get(b.key) ?? 9999 : 9999;
        return idxA - idxB;
    });
}

function packButton(id: string) {
    const packedButtons = settings.plain.packedButtons ?? [];
    if (!packedButtons.includes(id)) {
        settings.store.packedButtons = [...packedButtons, id];
    }
    BackpackedButtons.add(id);
    notifyBackpackChange();
}

function unpackButton(id: string) {
    const packedButtons = settings.plain.packedButtons ?? [];
    if (packedButtons.includes(id)) {
        settings.store.packedButtons = packedButtons.filter(b => b !== id);
    }
    BackpackedButtons.delete(id);
    notifyBackpackChange();
}

function unpackAll() {
    settings.store.packedButtons = [];
    BackpackedButtons.clear();
    notifyBackpackChange();
}

let latestChatBarProps: any = null;

function getFallbackChatBarProps() {
    if (latestChatBarProps) return latestChatBarProps;
    const channelId = SelectedChannelStore.getChannelId();
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    return {
        channel,
        disabled: false,
        isEmpty: false,
        type: { analyticsName: "normal" },
        isMainChat: true,
        isAnyChat: true
    };
}

// --- Backpack Popout & Preview Tray ---

const TRAY_SETTINGS_KEYS = ["packedButtons", "showPackedCount", "iconType"] as const;

function BackpackPopoutTray({
    onClose,
    chatBarProps
}: {
    onClose: () => void;
    chatBarProps?: any;
}) {
    const { packedButtons = [], showPackedCount, iconType = "backpack" } = settings.use(TRAY_SETTINGS_KEYS);
    const order = settings.store.buttonOrder ?? [];
    const orderMap = new Map(order.map((id, index) => [id, index]));

    const sortedPacked = [...packedButtons].sort((a, b) => {
        const idxA = orderMap.has(a) ? orderMap.get(a) ?? 9999 : 9999;
        const idxB = orderMap.has(b) ? orderMap.get(b) ?? 9999 : 9999;
        return idxA - idxB;
    });

    const Icon = getBackpackIcon(iconType);
    const effectiveProps = chatBarProps ?? getFallbackChatBarProps();

    return (
        <div className="tc-backpack-popout" onClick={e => e.stopPropagation()}>
            <div className="tc-backpack-popout-header">
                <div className="tc-backpack-popout-title">
                    <Icon width={18} height={18} />
                    <span>Backpack</span>
                    {showPackedCount && sortedPacked.length > 0 && (
                        <span className="tc-backpack-badge-inline">{sortedPacked.length}</span>
                    )}
                </div>
                <div className="tc-backpack-popout-actions">
                    <Clickable
                        className="tc-backpack-header-btn"
                        aria-label="Reorder Buttons"
                        onClick={e => {
                            e.stopPropagation();
                            openReorderModal();
                        }}
                    >
                        <ReorderIcon width={16} height={16} />
                    </Clickable>
                    <Clickable
                        className="tc-backpack-header-btn"
                        aria-label="Options"
                        onClick={e => {
                            e.stopPropagation();
                            ContextMenuApi.openContextMenu(e, () => (
                                <BackpackOptionsMenu onOpenPreview={() => { }} />
                            ));
                        }}
                    >
                        <SettingsIcon width={16} height={16} />
                    </Clickable>
                </div>
            </div>

            <div className="tc-backpack-popout-body">
                {sortedPacked.length === 0 ? (
                    <div className="tc-backpack-empty-state">
                        <p className="tc-backpack-empty-title">Your backpack is empty</p>
                        <p className="tc-backpack-empty-sub">Pack chat-bar buttons to declutter your message bar.</p>
                        <Button
                            size="small"
                            variant="primary"
                            onClick={e => {
                                e.stopPropagation();
                                ContextMenuApi.openContextMenu(e, () => (
                                    <BackpackOptionsMenu onOpenPreview={() => { }} />
                                ));
                            }}
                        >
                            Pack Buttons
                        </Button>
                    </div>
                ) : (
                    <div className="tc-backpack-buttons-grid">
                        {sortedPacked.map(id => {
                            const data = ChatBarButtonMap.get(id);
                            if (!data) return null;
                            const ButtonComponent = data.render;
                            return (
                                <div
                                    key={id}
                                    className="tc-backpack-button-item"
                                    onClickCapture={() => {
                                        if (settings.store.closeOnUse) {
                                            setTimeout(onClose, 100);
                                        }
                                    }}
                                >
                                    <ErrorBoundary noop>
                                        <ButtonComponent
                                            {...effectiveProps}
                                            isMainChat={true}
                                            isAnyChat={true}
                                        />
                                    </ErrorBoundary>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function openPreviewModal() {
    openModal(modalProps => (
        <ModalRoot {...modalProps} size={ModalSize.DYNAMIC}>
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, flex: 1, color: "var(--header-primary)" }}>
                        Backpack Preview
                    </h2>
                    <ModalCloseButton onClick={modalProps.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <BackpackPopoutTray onClose={modalProps.onClose} />
            </ModalContent>
        </ModalRoot>
    ));
}

// --- Reorder Modal ---

function BackpackReorderModal(props: RenderModalProps) {
    const [buttons, setButtons] = useState(() => {
        const allKeys = Array.from(ChatBarButtonMap.keys()).filter(id => id !== BACKPACK_ID);
        const order = settings.store.buttonOrder ?? [];
        const orderMap = new Map(order.map((id, index) => [id, index]));
        return allKeys.sort((a, b) => {
            const idxA = orderMap.has(a) ? orderMap.get(a) ?? 9999 : 9999;
            const idxB = orderMap.has(b) ? orderMap.get(b) ?? 9999 : 9999;
            return idxA - idxB;
        });
    });

    const move = (fromIndex: number, toIndex: number) => {
        if (toIndex < 0 || toIndex >= buttons.length) return;
        const next = [...buttons];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        setButtons(next);
        settings.store.buttonOrder = next;
        setChatBarButtonOrderResolver(applyCustomOrder);
    };

    const reset = () => {
        const original = Array.from(ChatBarButtonMap.keys()).filter(id => id !== BACKPACK_ID);
        setButtons(original);
        settings.store.buttonOrder = [];
        setChatBarButtonOrderResolver(applyCustomOrder);
    };

    return (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader separator={false}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
                    <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0, flex: 1, color: "var(--header-primary)" }}>
                        Reorder Chat Bar Buttons
                    </h2>
                    <ModalCloseButton onClick={props.onClose} />
                </div>
            </ModalHeader>
            <ModalContent>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", margin: "0 0 12px 0" }}>
                    Buttons at the top appear first (leftmost) in the chat bar and inside the backpack.
                </p>
                <div className="tc-backpack-reorder-list">
                    {buttons.map((id, index) => {
                        const data = ChatBarButtonMap.get(id);
                        const Icon = data?.icon;
                        const isPacked = BackpackedButtons.has(id);
                        return (
                            <div key={id} className="tc-backpack-reorder-row">
                                <div className="tc-backpack-reorder-info">
                                    <span className="tc-backpack-reorder-index">{index + 1}</span>
                                    {Icon && <Icon width={20} height={20} />}
                                    <span className="tc-backpack-reorder-label">{id}</span>
                                    {isPacked && (
                                        <span className="tc-backpack-reorder-packed-tag">Packed</span>
                                    )}
                                </div>
                                <div className="tc-backpack-reorder-controls">
                                    <Button
                                        size="min"
                                        variant="secondary"
                                        disabled={index === 0}
                                        onClick={() => move(index, index - 1)}
                                    >
                                        ▲
                                    </Button>
                                    <Button
                                        size="min"
                                        variant="secondary"
                                        disabled={index === buttons.length - 1}
                                        onClick={() => move(index, index + 1)}
                                    >
                                        ▼
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </ModalContent>
            <ModalFooter>
                <Button variant="secondary" onClick={reset} style={{ marginRight: "auto" }}>
                    Reset Order
                </Button>
                <Button variant="primary" onClick={props.onClose}>
                    Done
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function openReorderModal() {
    openModal(modalProps => <BackpackReorderModal {...modalProps} />);
}

// --- Context & Options Menus ---

const OPTIONS_SETTINGS_KEYS = [
    "packedButtons",
    "autoPackNewButtons",
    "showPackedCount",
    "iconType",
    "showInChatBar",
    "showInHeaderBar",
    "showInTitleBar",
    "closeOnUse"
] as const;

function BackpackOptionsMenu({ onOpenPreview }: { onOpenPreview?: () => void; }) {
    const {
        packedButtons = [],
        autoPackNewButtons,
        showPackedCount,
        iconType,
        showInChatBar,
        showInHeaderBar,
        showInTitleBar,
        closeOnUse
    } = settings.use(OPTIONS_SETTINGS_KEYS);

    const availableButtons = Array.from(ChatBarButtonMap.keys())
        .filter(id => id !== BACKPACK_ID)
        .sort();

    return (
        <Menu.Menu
            navId="backpack-options"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Backpack Options"
        >
            <Menu.MenuGroup label="Preview & Access">
                <Menu.MenuItem
                    id="backpack-preview-action"
                    label="Preview Backpack (Access Buttons)"
                    icon={EyeIcon}
                    action={() => {
                        if (onOpenPreview) {
                            onOpenPreview();
                        } else {
                            openPreviewModal();
                        }
                    }}
                />
                <Menu.MenuItem
                    id="backpack-reorder-action"
                    label="Reorder Chat Bar Buttons..."
                    icon={ReorderIcon}
                    action={() => openReorderModal()}
                />
            </Menu.MenuGroup>

            <Menu.MenuGroup label="Pack / Unpack Buttons">
                {availableButtons.map(id => {
                    const data = ChatBarButtonMap.get(id);
                    const isPacked = packedButtons.includes(id) || BackpackedButtons.has(id);
                    return (
                        <Menu.MenuCheckboxItem
                            key={`backpack-opt-${id}`}
                            id={`backpack-opt-${id}`}
                            label={id}
                            icon={data?.icon}
                            checked={isPacked}
                            action={() => isPacked ? unpackButton(id) : packButton(id)}
                        />
                    );
                })}
                {availableButtons.length === 0 && (
                    <Menu.MenuItem disabled key="backpack-no-buttons" label="No other chat bar buttons" id="backpack-no-buttons" />
                )}
                {packedButtons.length > 0 && (
                    <Menu.MenuItem
                        id="backpack-unpack-all"
                        label="Unpack All"
                        color="danger"
                        action={unpackAll}
                    />
                )}
            </Menu.MenuGroup>

            <Menu.MenuGroup label="Icon Style">
                {[
                    { id: "backpack", label: "Classic Backpack", icon: BackpackIcon },
                    { id: "briefcase", label: "Briefcase", icon: BriefcaseIcon },
                    { id: "bag", label: "Duffle / Bag", icon: BagIcon },
                    { id: "chest", label: "Storage Chest", icon: ChestIcon },
                    { id: "folder", label: "Folder", icon: FolderIcon },
                    { id: "grid", label: "Apps Grid", icon: GridIcon },
                    { id: "sparkles", label: "Sparkles", icon: SparklesIcon },
                    { id: "archive", label: "Archive Box", icon: ArchiveIcon },
                ].map(opt => (
                    <Menu.MenuRadioItem
                        key={`backpack-icon-${opt.id}`}
                        id={`backpack-icon-${opt.id}`}
                        group="backpack-icon-type"
                        label={opt.label}
                        icon={opt.icon}
                        checked={iconType === opt.id}
                        action={() => {
                            settings.store.iconType = opt.id;
                            syncBarButtons();
                        }}
                    />
                ))}
            </Menu.MenuGroup>

            <Menu.MenuGroup label="Placements">
                <Menu.MenuCheckboxItem
                    id="backpack-place-chatbar"
                    label="Show in Chat Bar"
                    checked={showInChatBar}
                    action={() => {
                        settings.store.showInChatBar = !showInChatBar;
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="backpack-place-headerbar"
                    label="Show in Header Bar (Toolbar)"
                    checked={showInHeaderBar}
                    action={() => {
                        settings.store.showInHeaderBar = !showInHeaderBar;
                        syncBarButtons();
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="backpack-place-titlebar"
                    label="Show in Title Bar"
                    checked={showInTitleBar}
                    action={() => {
                        settings.store.showInTitleBar = !showInTitleBar;
                        syncBarButtons();
                    }}
                />
            </Menu.MenuGroup>

            <Menu.MenuGroup label="Preferences">
                <Menu.MenuCheckboxItem
                    id="backpack-autopack"
                    label="Auto-pack New Buttons"
                    checked={autoPackNewButtons}
                    action={() => {
                        settings.store.autoPackNewButtons = !autoPackNewButtons;
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="backpack-show-count"
                    label="Show Packed Count Badge"
                    checked={showPackedCount}
                    action={() => {
                        settings.store.showPackedCount = !showPackedCount;
                    }}
                />
                <Menu.MenuCheckboxItem
                    id="backpack-close-on-use"
                    label="Close Tray on Button Click"
                    checked={closeOnUse}
                    action={() => {
                        settings.store.closeOnUse = !closeOnUse;
                    }}
                />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

// --- Chat Bar, Header Bar, and Title Bar Buttons ---

const BUTTON_SETTINGS_KEYS = ["packedButtons", "showPackedCount", "showInChatBar", "iconType"] as const;

const BackpackButton: ChatBarButtonFactory = props => {
    latestChatBarProps = props;
    const { showInChatBar, iconType = "backpack", showPackedCount } = settings.use(BUTTON_SETTINGS_KEYS);

    if (!props.isMainChat || !showInChatBar) return null;

    const count = (settings.store.packedButtons ?? []).length;
    const [popoutOpen, setPopoutOpen] = useState(false);
    const CurrentIcon = getBackpackIcon(iconType);
    const triggerRef = useRef<HTMLDivElement>(null);

    return (
        <Popout
            targetElementRef={triggerRef}
            shouldShow={popoutOpen}
            position="top"
            align="right"
            spacing={8}
            onRequestClose={() => setPopoutOpen(false)}
            renderPopout={() => (
                <BackpackPopoutTray
                    onClose={() => setPopoutOpen(false)}
                    chatBarProps={props}
                />
            )}
        >
            {popoutProps => (
                <div
                    ref={triggerRef}
                    style={{ display: "inline-flex" }}
                    onKeyDown={popoutProps.onKeyDown}
                    onMouseDown={popoutProps.onMouseDown}
                >
                    <ChatBarButton
                        tooltip={count > 0 ? `Backpack (${count} packed)` : "Backpack"}
                        onClick={e => {
                            e.stopPropagation();
                            setPopoutOpen(prev => !prev);
                        }}
                        onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            ContextMenuApi.openContextMenu(e, () => (
                                <BackpackOptionsMenu onOpenPreview={() => setPopoutOpen(true)} />
                            ));
                        }}
                        buttonProps={{
                            "aria-controls": popoutProps["aria-controls"],
                            "aria-expanded": popoutProps["aria-expanded"]
                        }}
                    >
                        <span className="tc-backpack-marker">
                            <CurrentIcon />
                            {showPackedCount && count > 0 && (
                                <span className="tc-backpack-badge">{count}</span>
                            )}
                        </span>
                    </ChatBarButton>
                </div>
            )}
        </Popout>
    );
};

function HeaderBarBackpackComponent() {
    const { iconType = "backpack", showPackedCount } = settings.use(["iconType", "showPackedCount", "packedButtons"]);
    const count = (settings.store.packedButtons ?? []).length;
    const [popoutOpen, setPopoutOpen] = useState(false);
    const Icon = getBackpackIcon(iconType);
    const triggerRef = useRef<HTMLDivElement>(null);

    return (
        <Popout
            targetElementRef={triggerRef}
            shouldShow={popoutOpen}
            position="bottom"
            align="right"
            onRequestClose={() => setPopoutOpen(false)}
            renderPopout={() => <BackpackPopoutTray onClose={() => setPopoutOpen(false)} />}
        >
            {popoutProps => (
                <div
                    ref={triggerRef}
                    style={{ display: "inline-flex" }}
                    onKeyDown={popoutProps.onKeyDown}
                    onMouseDown={popoutProps.onMouseDown}
                >
                    <ChannelToolbarButton
                        icon={Icon}
                        tooltip={count > 0 ? `Backpack (${count} packed)` : "Backpack"}
                        selected={popoutOpen}
                        onClick={e => {
                            e.stopPropagation();
                            setPopoutOpen(prev => !prev);
                        }}
                        onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            ContextMenuApi.openContextMenu(e, () => (
                                <BackpackOptionsMenu onOpenPreview={() => setPopoutOpen(true)} />
                            ));
                        }}
                        showBadge={showPackedCount && count > 0}
                        aria-controls={popoutProps["aria-controls"]}
                        aria-expanded={popoutProps["aria-expanded"]}
                    />
                </div>
            )}
        </Popout>
    );
}

function TitleBarBackpackComponent() {
    const { iconType = "backpack" } = settings.use(["iconType", "packedButtons"]);
    const count = (settings.store.packedButtons ?? []).length;
    const [popoutOpen, setPopoutOpen] = useState(false);
    const Icon = getBackpackIcon(iconType);
    const triggerRef = useRef<HTMLDivElement>(null);

    return (
        <Popout
            targetElementRef={triggerRef}
            shouldShow={popoutOpen}
            position="bottom"
            align="right"
            onRequestClose={() => setPopoutOpen(false)}
            renderPopout={() => <BackpackPopoutTray onClose={() => setPopoutOpen(false)} />}
        >
            {popoutProps => (
                <div
                    ref={triggerRef}
                    style={{ display: "inline-flex" }}
                    onKeyDown={popoutProps.onKeyDown}
                    onMouseDown={popoutProps.onMouseDown}
                >
                    <HeaderBarButton
                        icon={Icon}
                        tooltip={count > 0 ? `Backpack (${count} packed)` : "Backpack"}
                        selected={popoutOpen}
                        onClick={e => {
                            e.stopPropagation();
                            setPopoutOpen(prev => !prev);
                        }}
                        onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            ContextMenuApi.openContextMenu(e, () => (
                                <BackpackOptionsMenu onOpenPreview={() => setPopoutOpen(true)} />
                            ));
                        }}
                        aria-controls={popoutProps["aria-controls"]}
                        aria-expanded={popoutProps["aria-expanded"]}
                    />
                </div>
            )}
        </Popout>
    );
}

let headerBarRegistered = false;
let titleBarRegistered = false;

function syncBarButtons() {
    const { showInHeaderBar, showInTitleBar } = settings.store;

    if (showInHeaderBar && !headerBarRegistered) {
        addChannelToolbarButton(BACKPACK_ID, HeaderBarBackpackComponent);
        headerBarRegistered = true;
    } else if (!showInHeaderBar && headerBarRegistered) {
        removeChannelToolbarButton(BACKPACK_ID);
        headerBarRegistered = false;
    }

    if (showInTitleBar && !titleBarRegistered) {
        addHeaderBarButton(BACKPACK_ID, TitleBarBackpackComponent);
        titleBarRegistered = true;
    } else if (!showInTitleBar && titleBarRegistered) {
        removeHeaderBarButton(BACKPACK_ID);
        titleBarRegistered = false;
    }
}

let removeButtonListener: (() => void) | null = null;

function autoPackAvailableButtons() {
    if (!settings.plain.autoPackNewButtons) return;
    const packedButtons = settings.plain.packedButtons ?? [];
    for (const [id] of ChatBarButtonMap) {
        if (id === BACKPACK_ID) continue;
        if (!BackpackedButtons.has(id) && !packedButtons.includes(id)) {
            packButton(id);
        }
    }
}

export default definePlugin({
    id: "Backpack",
    name: "Backpack",
    description: "Collapse your other chat-bar plugin buttons behind a single button to declutter the message bar. Click to expand packed buttons. Right-click for options and preview.",
    authors: [TestcordDevs.sirphantom89],
    dependencies: ["ChatInputButtonAPI", "ContextMenuAPI", "HeaderBarAPI"],
    settings,

    chatBarButton: {
        icon: BackpackIcon,
        render: BackpackButton
    },

    managedStyle: backpackStyle,

    start() {
        for (const id of settings.plain.packedButtons ?? []) {
            BackpackedButtons.add(id);
        }
        autoPackAvailableButtons();
        notifyBackpackChange();

        setChatBarButtonOrderResolver(applyCustomOrder);
        syncBarButtons();

        const onButtonsChanged = () => autoPackAvailableButtons();
        chatBarButtonListeners.add(onButtonsChanged);
        removeButtonListener = () => chatBarButtonListeners.delete(onButtonsChanged);
    },

    stop() {
        removeButtonListener?.();
        removeButtonListener = null;

        setChatBarButtonOrderResolver(null);

        if (headerBarRegistered) {
            removeChannelToolbarButton(BACKPACK_ID);
            headerBarRegistered = false;
        }
        if (titleBarRegistered) {
            removeHeaderBarButton(BACKPACK_ID);
            titleBarRegistered = false;
        }

        BackpackedButtons.clear();
        notifyBackpackChange();
    }
});
