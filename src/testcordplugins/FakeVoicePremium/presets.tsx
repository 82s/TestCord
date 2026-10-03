/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { Paragraph } from "@components/Paragraph";
import { Checkbox, TextInput } from "@webpack/common";
import { nanoid } from "nanoid";

import { settings } from "./settings";

export const PRESET_KEYS = ["fakeMute", "fakeDeafen", "fakeStream", "fakeGame", "fakeCam", "cutMicTransmission"] as const;

export type PresetConfig = Record<(typeof PRESET_KEYS)[number], boolean>;

export interface FakeVoicePreset {
    id: string;
    name: string;
    config: PresetConfig;
}

export const PRESET_LABELS: Record<keyof PresetConfig, string> = {
    fakeMute: "Fake Mute",
    fakeDeafen: "Fake Deafen",
    fakeStream: "Fake Stream",
    fakeGame: "Fake Game",
    fakeCam: "Fake Camera",
    cutMicTransmission: "Cut Mic Transmission"
};

export function capturePresetConfig(): PresetConfig {
    const { plain } = settings;

    return {
        fakeMute: plain.fakeMute,
        fakeDeafen: plain.fakeDeafen,
        fakeStream: plain.fakeStream,
        fakeGame: plain.fakeGame,
        fakeCam: plain.fakeCam,
        cutMicTransmission: plain.cutMicTransmission
    };
}

// Settings store reads hand back proxies, and the persistence IPC refuses to clone
// them: writing a single proxied entry back into presets poisons the whole settings
// tree and every later save of every setting fails with "An object could not be
// cloned". Always rebuild entries from this raw copy instead of touching store values.
function rawPresets(): FakeVoicePreset[] {
    return (settings.plain.presets ?? []).map(preset => ({
        id: preset.id,
        name: preset.name,
        config: { ...preset.config }
    }));
}

export function PresetIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                d="M2 5h6v2H2V5zM14 5h8v2h-8V5zM2 11h2v2H2v-2zM10 11h12v2H10v-2zM2 17h10v2H2v-2zM18 17h4v2h-4v-2z"
            />
            <circle cx="10" cy="6" r="3" fill="currentColor" />
            <circle cx="6" cy="12" r="3" fill="currentColor" />
            <circle cx="14" cy="18" r="3" fill="currentColor" />
        </svg>
    );
}

export function PresetSettings() {
    // Subscribing keeps this component re-rendering on change, but every value it acts
    // on comes from rawPresets() — a subscription hands back proxies, and writing those
    // back makes the settings tree impossible to serialise, which silently drops the
    // save entirely.
    settings.use(["presets"]);
    const list = rawPresets();

    const write = (next: FakeVoicePreset[]) => {
        settings.store.presets = next;
    };

    const replace = (index: number, preset: FakeVoicePreset) =>
        write(rawPresets().map((current, i) => i === index ? preset : current));

    const remove = (index: number) =>
        write(rawPresets().filter((_, i) => i !== index));

    const add = () => {
        const current = rawPresets();

        write([...current, {
            id: nanoid(),
            name: `Button ${current.length + 1}`,
            config: capturePresetConfig()
        }]);
    };

    return (
        <Flex flexDirection="column" gap="md">
            <Paragraph size="xs">
                Each button here gets its own button in the user area that spoofs only what you tick below, leaving the states above untouched. Clicking one makes it the live combination; changing a state above, using the right-click menu, a keybind or a slash command hands control back to those states. Hit "Save current" to copy the states from above into this button.
            </Paragraph>

            {list.length === 0
                ? <Paragraph size="sm">No buttons yet.</Paragraph>
                : list.map((preset, index) => (
                    <Card key={preset.id}>
                        <Flex flexDirection="column" gap="md">
                            <TextInput
                                value={preset.name}
                                placeholder="Button name"
                                onChange={name => replace(index, { ...preset, name })}
                            />

                            <Flex flexDirection="column" gap="sm">
                                {PRESET_KEYS.map(key => (
                                    <Checkbox
                                        key={key}
                                        type="row"
                                        value={preset.config[key]}
                                        onChange={(_event, value) => replace(index, { ...preset, config: { ...preset.config, [key]: value } })}
                                    >
                                        {PRESET_LABELS[key]}
                                    </Checkbox>
                                ))}
                            </Flex>

                            <Flex flexDirection="row" gap="sm">
                                <Button variant="secondary" size="small" onClick={() => replace(index, { ...preset, config: capturePresetConfig() })}>
                                    Save current
                                </Button>
                                <Button variant="dangerPrimary" size="small" onClick={() => remove(index)}>
                                    Delete
                                </Button>
                            </Flex>
                        </Flex>
                    </Card>
                ))}

            <Button variant="secondary" onClick={add}>
                Add button
            </Button>
        </Flex>
    );
}
