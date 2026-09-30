/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Badge } from "@components/Badge";
import { Button } from "@components/Button";
import { copyWithToast } from "@utils/discord";
import { pluralize } from "@utils/misc";
import { ChannelStore, showToast, TextInput, Toasts, useState, useStateFromStores } from "@webpack/common";

import { isGivenUp, log, notify, resetReaddCounts, syncGroup } from "../actions";
import { addMembers, describeUser, getErrorMessage, getFriends, getGroupName, openChannel, recipientIds, removeMembers, selfId } from "../api";
import { settings } from "../settings";
import { GctrapStore } from "../store";
import { GROUP_MODES, GroupConfig, GroupMode } from "../types";
import { cl, GroupAvatar, STATUS_COLORS } from "../utils";
import UserPicker from "./UserPicker";

function Field({ label, value, onCommit, min = 0, max = 99999 }: {
    label: string;
    value: number;
    onCommit(value: number): void;
    min?: number;
    max?: number;
}) {
    const [text, setText] = useState(String(value));

    return (
        <label className={cl("field")}>
            <span className={cl("field-label")}>{label}</span>
            <TextInput
                type="number"
                value={text}
                min={min}
                max={max}
                onChange={setText}
                onBlur={() => {
                    const next = Number.parseInt(text, 10);
                    if (Number.isNaN(next)) {
                        setText(String(value));
                        return;
                    }
                    const clamped = Math.min(max, Math.max(min, next));
                    setText(String(clamped));
                    if (clamped !== value) onCommit(clamped);
                }}
            />
        </label>
    );
}

function MemberChip({ userId, onRemove }: { userId: string; onRemove(): void; }) {
    const member = describeUser(userId);
    return (
        <span className={cl("chip")}>
            <span className={cl("dot")} style={{ background: STATUS_COLORS[member.status] }} />
            <span className={cl("chip-name")}>{member.name}</span>
            <button className={cl("chip-x")} onClick={onRemove} aria-label={`Remove ${member.name} from the list`}>×</button>
        </span>
    );
}

interface GroupCardProps {
    group: GroupConfig;
}

export default function GroupCard({ group }: GroupCardProps) {
    const present = useStateFromStores([ChannelStore], () => recipientIds(ChannelStore.getChannel(group.id)));
    const [label, setLabel] = useState(group.label ?? "");
    const [picked, setPicked] = useState<string[]>(group.members);
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState("");

    const channel = ChannelStore.getChannel(group.id);
    const name = group.label || getGroupName(channel);
    const missing = group.members.filter(id => !present.includes(id));
    const extras = present.filter(id => id !== selfId() && !group.members.includes(id));
    const stopped = group.members.filter(id => isGivenUp(group.id, id));
    const friends = adding ? getFriends() : [];

    const update = (patch: Partial<GroupConfig>) => GctrapStore.getState().upsertGroup({ ...group, ...patch });

    async function run(task: () => Promise<void>) {
        setBusy("Working");
        try {
            await task();
        } catch (err) {
            showToast(getErrorMessage(err), Toasts.Type.FAILURE);
            log(group, getErrorMessage(err), "error");
        } finally {
            setBusy("");
        }
    }

    return (
        <div className={cl("card")}>
            <div className={cl("card-head")}>
                <GroupAvatar channel={channel} />
                <div className={cl("card-titles")}>
                    <TextInput
                        placeholder={getGroupName(channel)}
                        value={label}
                        onChange={setLabel}
                        onBlur={() => label.trim() !== (group.label ?? "") && update({ label: label.trim() || undefined })}
                    />
                    <span className={cl("card-sub")}>
                        {name} {"·"} {pluralize(group.members.length, "allowed member")} {"·"} {pluralize(present.length, "member")} in the group
                    </span>
                </div>
                <div className={cl("card-actions")}>
                    <Button size="xs" variant="secondary" onClick={() => openChannel(group.id)}>Open</Button>
                    <Button size="xs" variant="secondary" onClick={() => copyWithToast(group.id, "Copied the group ID")}>Copy ID</Button>
                    <Button
                        size="xs"
                        variant="dangerSecondary"
                        onClick={() => {
                            GctrapStore.getState().removeGroup(group.id);
                            notify("Stopped tracking", `${name} is off the dashboard now.`);
                        }}
                    >
                        Forget
                    </Button>
                </div>
            </div>

            <div className={cl("row")}>
                {(Object.keys(GROUP_MODES) as GroupMode[]).map(mode => (
                    <Button key={mode} size="xs" variant={group.mode === mode ? "primary" : "secondary"} onClick={() => update({ mode })}>
                        {GROUP_MODES[mode]}
                    </Button>
                ))}
                <Field label="Re-add limit" value={group.readdLimit} max={100} onCommit={readdLimit => update({ readdLimit })} />
                <Field label="Re-add delay" value={group.readdDelay} max={5000} onCommit={readdDelay => update({ readdDelay })} />
            </div>

            <div className={cl("row")}>
                <Badge text={pluralize(missing.length, "member")} variant={missing.length ? "warning" : "default"} />
                <span className={cl("hint")}>out of the group right now</span>
                <Badge text={pluralize(extras.length, "stranger")} variant={extras.length ? "danger" : "default"} />
                <span className={cl("hint")}>not on the list</span>
                {stopped.length > 0 && <Badge text={`${stopped.length} given up on`} variant="warning" />}
            </div>

            <div className={cl("row")}>
                <Button
                    size="xs"
                    variant="primary"
                    disabled={!!busy}
                    onClick={() => run(async () => showToast(await syncGroup(group), Toasts.Type.SUCCESS))}
                >
                    {busy || "Sync now"}
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    disabled={!extras.length || group.mode === "addonly" || group.mode === "off"}
                    onClick={() => run(async () => {
                        const { removed } = await removeMembers(group.id, extras, settings.store.memberSize, settings.store.addDelay);
                        log(group, `Kicked ${pluralize(removed, "stranger")}`, "action");
                    })}
                >
                    Kick strangers
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    disabled={!missing.length || group.mode === "kickonly" || group.mode === "off"}
                    onClick={() => run(async () => {
                        const { added } = await addMembers(group.id, missing, settings.store.memberSize, settings.store.addDelay);
                        log(group, `Put ${pluralize(added, "member")} back in`, "action");
                    })}
                >
                    Put everyone back
                </Button>
                <Button size="xs" variant="secondary" onClick={() => resetReaddCounts(group)}>
                    Reset counters
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setAdding(!adding)}>
                    {adding ? "Done" : "Edit list"}
                </Button>
            </div>

            {adding ? (
                <div className={cl("list-editor")}>
                    <UserPicker
                        friends={friends}
                        selected={picked}
                        onToggle={userId => setPicked(current => current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId])}
                        onBulkToggle={(ids, add) => setPicked(current => add ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)))}
                    />
                    <Button
                        size="xs"
                        variant="primary"
                        onClick={() => {
                            update({ members: picked });
                            setAdding(false);
                            showToast(`Saved a list of ${pluralize(picked.length, "member")}`, Toasts.Type.SUCCESS);
                        }}
                    >
                        Save list
                    </Button>
                </div>
            ) : (
                <div className={cl("chips")}>
                    {group.members.map(id => (
                        <MemberChip
                            key={id}
                            userId={id}
                            onRemove={() => update({ members: group.members.filter(member => member !== id) })}
                        />
                    ))}
                    {!group.members.length && <span className={cl("hint")}>Nobody on the list yet, so everyone who joins gets kicked.</span>}
                </div>
            )}
        </div>
    );
}
