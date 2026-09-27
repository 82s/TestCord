/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Link } from "@components/Link";
import { TestcordDevs } from "@utils/constants";
import { identity } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, MediaEngineStore, Select, Slider, Text, useState, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({
    expandedByDefault: {
        description: "Show the controls expanded instead of behind a toggle",
        type: OptionType.BOOLEAN,
        default: false
    },
    headers: {
        description: "Label each control instead of prefixing it with an icon",
        type: OptionType.BOOLEAN,
        default: true
    },
    outputVolume: {
        description: "Show an output volume slider",
        type: OptionType.BOOLEAN,
        default: true
    },
    inputVolume: {
        description: "Show an input volume slider",
        type: OptionType.BOOLEAN,
        default: true
    },
    outputDevice: {
        description: "Show an output device picker",
        type: OptionType.BOOLEAN,
        default: true
    },
    inputDevice: {
        description: "Show an input device picker",
        type: OptionType.BOOLEAN,
        default: true
    },
    camera: {
        description: "Show a camera picker",
        type: OptionType.BOOLEAN,
        default: false
    }
});

function VolumeSlider({
    title,
    get,
    action,
    max
}: {
    title: string;
    get: () => number;
    action: string;
    max: number;
}) {
    const value = useStateFromStores([MediaEngineStore], get);

    return (
        <>
            {settings.plain.headers && <Text variant="heading-sm/medium">{title}</Text>}
            <Slider
                minValue={0}
                maxValue={max}
                initialValue={value}
                onValueRender={v => `${v.toFixed(0)}%`}
                asValueChanges={next => FluxDispatcher.dispatch({ type: action, volume: next })}
            />
        </>
    );
}

function DeviceSelect({
    title,
    icon,
    devices,
    selected,
    action
}: {
    title: string;
    icon: string;
    devices: Record<string, { id: string; name: string }>;
    selected: string | undefined;
    action: string;
}) {
    const options = Object.values(devices).map(device => ({
        value: device.id,
        label: settings.plain.headers ? device.name : `${icon} ${device.name}`
    }));

    if (options.length === 0) return null;

    return (
        <>
            {settings.plain.headers && <Text variant="heading-sm/medium">{title}</Text>}
            <Select
                options={options}
                serialize={identity}
                isSelected={value => value === selected}
                select={id => FluxDispatcher.dispatch({ type: action, id })}
            />
        </>
    );
}

function Controls() {
    const { expandedByDefault, headers } = settings.plain;
    const [expanded, setExpanded] = useState(expandedByDefault);

    const outputDevice = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getOutputDeviceId());
    const inputDevice = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getInputDeviceId());
    const videoDevice = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getVideoDeviceId());

    return (
        <div className="vc-panelsettings-root">
            <Link className="vc-panelsettings-toggle" onClick={() => setExpanded(!expanded)}>
                {expanded ? "▼ Hide settings" : "► Settings"}
            </Link>

            {expanded && (
                <div className="vc-panelsettings-body">
                    {settings.plain.outputVolume && (
                        <VolumeSlider
                            title="Output volume"
                            get={MediaEngineStore.getOutputVolume}
                            action="AUDIO_SET_OUTPUT_VOLUME"
                            max={200}
                        />
                    )}
                    {settings.plain.inputVolume && (
                        <VolumeSlider
                            title="Input volume"
                            get={MediaEngineStore.getInputVolume}
                            action="AUDIO_SET_INPUT_VOLUME"
                            max={100}
                        />
                    )}
                    {settings.plain.outputDevice && (
                        <DeviceSelect
                            title="Output device"
                            icon="🔊"
                            devices={MediaEngineStore.getOutputDevices()}
                            selected={outputDevice}
                            action="AUDIO_SET_OUTPUT_DEVICE"
                        />
                    )}
                    {settings.plain.inputDevice && (
                        <DeviceSelect
                            title="Input device"
                            icon="🎤"
                            devices={MediaEngineStore.getInputDevices()}
                            selected={inputDevice}
                            action="AUDIO_SET_INPUT_DEVICE"
                        />
                    )}
                    {settings.plain.camera && (
                        <DeviceSelect
                            title="Camera"
                            icon="📷"
                            devices={MediaEngineStore.getVideoDevices()}
                            selected={videoDevice}
                            action="MEDIA_ENGINE_SET_VIDEO_DEVICE"
                        />
                    )}
                </div>
            )}
        </div>
    );
}

export default definePlugin({
    name: "VCPanelSettings",
    description: "Control your microphone, speakers and camera from the voice panel",
    tags: ["Voice", "Customisation"],
    authors: [TestcordDevs.x2b],
    settings,

    renderVoiceSettings() {
        return <Controls />;
    },

    patches: [
        {
            find: "this.renderChannelButtons()",
            replacement: {
                match: /this\.renderChannelButtons\(\)/,
                replace: "this.renderChannelButtons(), $self.renderVoiceSettings()"
            }
        }
    ]
});
