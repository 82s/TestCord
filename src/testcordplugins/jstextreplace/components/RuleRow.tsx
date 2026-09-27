/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { FormSwitch } from "@components/FormSwitch";
import { DeleteIcon } from "@components/Icons";
import { TextInput, Tooltip, useEffect, useRef, useState } from "@webpack/common";

import { settings } from "..";
import { EMPTY_REPLACEMENT } from "../rules";

interface AceEditor {
    session: {
        setMode(mode: string): void;
        setUseWorker(enabled: boolean): void;
    };
    getValue(): string;
    setValue(value: string, cursor?: number): void;
    setTheme(theme: string): void;
    destroy(): void;
    resize(): void;
}

declare global {
    interface Window {
        ace: { edit(element: HTMLElement): AceEditor };
    }
}

export function RuleRow({ index, onDelete }: { index: number; onDelete(): void }) {
    const { rules } = settings.use(["rules"]);
    const current = (rules ?? [])[index];

    const [editing, setEditing] = useState(false);
    const editorRef = useRef<AceEditor | null>(null);
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!editing || !hostRef.current) return;

        const editor = window.ace.edit(hostRef.current);
        editor.setTheme("ace/theme/one_dark");
        editor.session.setMode("ace/mode/javascript");
        editor.session.setUseWorker(false);
        editor.setValue(current?.replace || EMPTY_REPLACEMENT, -1);
        editor.resize();

        editorRef.current = editor;
        return () => {
            editor.destroy();
            editorRef.current = null;
        };
    }, [editing]);

    if (!current) return null;

    const commit = (field: "find" | "onlyIfIncludes", value: string) => {
        const rules = [...(settings.plain.rules ?? [])];
        rules[index] = { ...rules[index], [field]: value };
        settings.store.rules = rules;
    };

    return (
        <div className="vc-jstr-rule">
            <div className="vc-jstr-head">
                <FormSwitch
                    title="Rule enabled"
                    value={current.enabled}
                    onChange={enabled => {
                        const rules = [...(settings.plain.rules ?? [])];
                        rules[index] = { ...rules[index], enabled };
                        settings.store.rules = rules;
                    }}
                />
                <TextInput
                    placeholder="Find, plain text or /regex/flags"
                    defaultValue={current.find}
                    spellCheck={false}
                    className="vc-jstr-input"
                    onBlur={event => commit("find", event.currentTarget.value)}
                />
                <TextInput
                    placeholder="Only if includes"
                    defaultValue={current.onlyIfIncludes}
                    spellCheck={false}
                    className="vc-jstr-input"
                    onBlur={event => commit("onlyIfIncludes", event.currentTarget.value)}
                />
                <Button
                    variant="secondary"
                    size="small"
                    onClick={() => {
                        if (editing && editorRef.current) {
                            const rules = [...(settings.plain.rules ?? [])];
                            rules[index] = { ...rules[index], replace: editorRef.current.getValue() };
                            settings.store.rules = rules;
                        }
                        setEditing(!editing);
                    }}
                >
                    {editing ? "Save" : "Edit"} replacement
                </Button>
                <Tooltip text="Delete rule">
                    {tooltip => (
                        <Button
                            {...tooltip}
                            variant="none"
                            size="iconOnly"
                            className="vc-jstr-delete"
                            onClick={onDelete}
                        >
                            <DeleteIcon />
                        </Button>
                    )}
                </Tooltip>
            </div>

            {editing && <div ref={hostRef} className="vc-jstr-editor" />}
        </div>
    );
}
