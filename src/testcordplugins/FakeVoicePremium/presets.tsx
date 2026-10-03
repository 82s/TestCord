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
    const { store } = settings;

    return {
        fakeMute: store.fakeMute,
        fakeDeafen: store.fakeDeafen,
        fakeStream: store.fakeStream,
        fakeGame: store.fakeGame,
        fakeCam: store.fakeCam,
        cutMicTransmission: store.cutMicTransmission
    };
}

export function isPresetActive(config: PresetConfig, flags: PresetConfig) {
    return PRESET_KEYS.every(key => flags[key] === config[key]);
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
    const { presets } = settings.use(["presets"]);
    const list = presets ?? [];

    const replace = (index: number, preset: FakeVoicePreset) => {
        settings.store.presets = list.map((current, i) => i === index ? preset : current);
    };

    return (
        <Flex flexDirection="column" gap="md">
            <Paragraph size="xs">
                Each preset gets its own button in the user area that applies the whole combination at once. Set your states up with the toggles or the right-click menu, then hit "Save current" to store them into a preset.
            </Paragraph>

            {list.length === 0
                ? <Paragraph size="sm">No presets yet.</Paragraph>
                : list.map((preset, index) => (
                    <Card key={preset.id}>
                        <Flex flexDirection="column" gap="md">
                            <TextInput
                                value={preset.name}
                                placeholder="Preset name"
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
                                <Button variant="dangerPrimary" size="small" onClick={() => { settings.store.presets = list.filter((_, i) => i !== index); }}>
                                    Delete
                                </Button>
                            </Flex>
                        </Flex>
                    </Card>
                ))}

            <Button
                variant="secondary"
                onClick={() => {
                    settings.store.presets = [...list, {
                        id: nanoid(),
                        name: `Preset ${list.length + 1}`,
                        config: capturePresetConfig()
                    }];
                }}
            >
                Add preset
            </Button>
        </Flex>
    );
}
