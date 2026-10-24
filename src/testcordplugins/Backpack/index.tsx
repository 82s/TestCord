/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BackpackedButtons, ChatBarButton, ChatBarButtonFactory, chatBarButtonListeners, ChatBarButtonMap, notifyBackpackChange } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ContextMenuApi, Menu, React } from "@webpack/common";

import backpackStyle from "./style.css?managed";

const BACKPACK_ID = "Backpack";

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
    packedButtons: {
        type: OptionType.CUSTOM,
        description: "Packed button IDs",
        hidden: true,
        default: [] as string[]
    }
});

function BackpackIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 8V6a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 10.5v8A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-8A2.5 2.5 0 0 1 6.5 8H7Zm2 0h6V6a3 3 0 1 0-6 0v2Zm-1 5a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H8Z" />
        </svg>
    );
}

function packButton(id: string) {
    const { packedButtons } = settings.plain;
    if (!packedButtons.includes(id)) {
        settings.store.packedButtons = [...packedButtons, id];
    }
    BackpackedButtons.add(id);
    notifyBackpackChange();
}

function unpackButton(id: string) {
    const { packedButtons } = settings.plain;
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

const MENU_SETTINGS_KEYS = ["packedButtons"] as const;

function BackpackMenu() {
    const { packedButtons } = settings.use(MENU_SETTINGS_KEYS);

    return (
        <Menu.Menu
            navId="backpack-menu"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Backpack"
        >
            <Menu.MenuGroup label="Packed Buttons">
                {packedButtons.map(id => {
                    const data = ChatBarButtonMap.get(id);
                    return (
                        <Menu.MenuItem
                            key={id}
                            id={`backpack-item-${id}`}
                            label={id}
                            icon={data?.icon}
                            subtext="Click to unpack"
                            action={() => unpackButton(id)}
                        />
                    );
                })}
                {packedButtons.length === 0 && (
                    <Menu.MenuItem disabled key="backpack-empty" label="No packed buttons" id="backpack-empty" />
                )}
            </Menu.MenuGroup>
            {packedButtons.length > 0 && (
                <Menu.MenuGroup>
                    <Menu.MenuItem
                        id="backpack-unpack-all"
                        label="Unpack All"
                        action={unpackAll}
                    />
                </Menu.MenuGroup>
            )}
        </Menu.Menu>
    );
}

const OPTIONS_SETTINGS_KEYS = ["packedButtons", "autoPackNewButtons", "showPackedCount"] as const;

function BackpackOptionsMenu() {
    const { packedButtons, autoPackNewButtons, showPackedCount } = settings.use(OPTIONS_SETTINGS_KEYS);

    const availableButtons = Array.from(ChatBarButtonMap.keys())
        .filter(id => id !== BACKPACK_ID)
        .sort();

    return (
        <Menu.Menu
            navId="backpack-options"
            onClose={ContextMenuApi.closeContextMenu}
            aria-label="Backpack Options"
        >
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
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

const BUTTON_SETTINGS_KEYS = ["packedButtons", "showPackedCount"] as const;

const BackpackButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { packedButtons, showPackedCount } = settings.use(BUTTON_SETTINGS_KEYS);

    if (!isMainChat) return null;

    const count = packedButtons.length;

    return (
        <ChatBarButton
            tooltip={count > 0 ? `Backpack (${count} packed)` : "Backpack"}
            onClick={e => {
                e.stopPropagation();
                ContextMenuApi.openContextMenu(e, () => <BackpackMenu />);
            }}
            onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                ContextMenuApi.openContextMenu(e, () => <BackpackOptionsMenu />);
            }}
        >
            <span className="tc-backpack-marker">
                <BackpackIcon />
                {showPackedCount && count > 0 && (
                    <span className="tc-backpack-badge">{count}</span>
                )}
            </span>
        </ChatBarButton>
    );
};

let removeButtonListener: (() => void) | null = null;

function autoPackAvailableButtons() {
    if (!settings.plain.autoPackNewButtons) return;
    for (const [id] of ChatBarButtonMap) {
        if (id === BACKPACK_ID) continue;
        if (!BackpackedButtons.has(id) && !settings.plain.packedButtons.includes(id)) {
            packButton(id);
        }
    }
}

export default definePlugin({
    id: "Backpack",
    name: "Backpack",
    description: "Collapse your other chat-bar plugin buttons behind a single button to declutter the message bar. Click to expand a menu with packed buttons. Right-click for options.",
    authors: [TestcordDevs.sirphantom89],
    dependencies: ["ChatInputButtonAPI", "ContextMenuAPI"],
    settings,

    chatBarButton: {
        icon: BackpackIcon,
        render: BackpackButton
    },

    managedStyle: backpackStyle,

    start() {
        for (const id of settings.plain.packedButtons) {
            BackpackedButtons.add(id);
        }
        autoPackAvailableButtons();
        notifyBackpackChange();

        const onButtonsChanged = () => autoPackAvailableButtons();
        chatBarButtonListeners.add(onButtonsChanged);
        removeButtonListener = () => chatBarButtonListeners.delete(onButtonsChanged);
    },

    stop() {
        removeButtonListener?.();
        removeButtonListener = null;
        BackpackedButtons.clear();
        notifyBackpackChange();
    }
});
