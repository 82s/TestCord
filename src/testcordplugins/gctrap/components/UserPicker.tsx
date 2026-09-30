/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Avatar, TextInput, useMemo, useState } from "@webpack/common";

import { FriendOption } from "../types";
import { cl,STATUS_COLORS } from "../utils";

const FILTERS = ["all", "online", "idle", "dnd", "voice"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = {
    all: "All",
    online: "Online",
    idle: "Idle",
    dnd: "DND",
    voice: "In Voice"
};

function CheckMark() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

interface UserPickerProps {
    friends: readonly FriendOption[];
    selected: readonly string[];
    onToggle(userId: string): void;
    onBulkToggle(userIds: readonly string[], add: boolean): void;
}

export default function UserPicker({ friends, selected, onToggle, onBulkToggle }: UserPickerProps) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("all");

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return friends.filter(friend => {
            if (filter === "voice" && !friend.inVoice) return false;
            if (filter !== "all" && filter !== "voice" && friend.status !== filter) return false;
            if (!needle) return true;
            return friend.name.toLowerCase().includes(needle)
                || friend.username.toLowerCase().includes(needle)
                || friend.id.includes(needle);
        });
    }, [friends, query, filter]);

    const allVisible = visible.length > 0 && visible.every(friend => selected.includes(friend.id));

    return (
        <div className={cl("picker")}>
            <TextInput
                placeholder="Search by name or ID"
                value={query}
                onChange={setQuery}
            />
            <div className={cl("filters")}>
                {FILTERS.map(name => (
                    <Button
                        key={name}
                        size="xs"
                        variant={filter === name ? "primary" : "secondary"}
                        onClick={() => setFilter(name)}
                    >
                        {FILTER_LABELS[name]}
                    </Button>
                ))}
                <span className={cl("count")}>{selected.length} selected</span>
            </div>
            <div className={cl("list")}>
                {visible.map(friend => (
                    <div
                        key={friend.id}
                        role="button"
                        tabIndex={0}
                        className={cl("row", { picked: selected.includes(friend.id) })}
                        onClick={() => onToggle(friend.id)}
                        onKeyDown={event => event.key === "Enter" && onToggle(friend.id)}
                    >
                        <span className={cl("dot")} style={{ background: STATUS_COLORS[friend.status] }} />
                        <Avatar size="SIZE_24" src={friend.avatar} />
                        <span className={cl("row-main")}>
                            <span className={cl("row-name")}>{friend.name}</span>
                            <span className={cl("row-sub")}>@{friend.username}</span>
                        </span>
                        {friend.inVoice && <span className={cl("badge")}>voice</span>}
                        {selected.includes(friend.id) && <span className={cl("check")}><CheckMark /></span>}
                    </div>
                ))}
                {!visible.length && <div className={cl("empty")}>Nobody matches that.</div>}
            </div>
            <div className={cl("picker-foot")}>
                <Button size="xs" variant="secondary" onClick={() => onBulkToggle(visible.map(f => f.id), !allVisible)}>
                    {allVisible ? "Deselect visible" : "Select visible"}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => onBulkToggle(selected, false)}>
                    Clear
                </Button>
            </div>
        </div>
    );
}
