/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    prefix: {
        type: OptionType.STRING,
        description: "Prefix used for remote commands.",
        default: "."
    },
    allowedChannelIds: {
        type: OptionType.STRING,
        description: "Extra channel IDs where commands are accepted. DMs and group DMs always work. Use .bind in a channel to add it.",
        default: "",
        placeholder: "123456789012345678, 987654321098765432"
    },
    allowedUserIds: {
        type: OptionType.STRING,
        description: "Other user IDs allowed to send remote commands. They get the same control as you, including .eval and plugin changes. DMs with them already count as allowed channels.",
        default: "",
        placeholder: "123456789012345678, 987654321098765432",
        isValid(value: string) {
            const ids = value.split(/[\s,]+/).filter(Boolean);
            return ids.every(id => /^\d{17,20}$/.test(id)) || "Use 17 to 20 digit user IDs separated by commas.";
        }
    },
    allowAllChannels: {
        type: OptionType.BOOLEAN,
        description: "Accept commands in every channel instead of only DMs and the channels above.",
        default: false
    },
    sendConfirmations: {
        type: OptionType.BOOLEAN,
        description: "Send a ✅ reply when a command succeeds. Errors and command output still show up.",
        default: true
    },
    responseDeleteDelay: {
        type: OptionType.NUMBER,
        description: "Seconds before success and error replies are deleted. 0 keeps them.",
        default: 5
    },
    infoDeleteDelay: {
        type: OptionType.NUMBER,
        description: "Seconds before command output like help, lists, and system info is deleted. 0 keeps it.",
        default: 30
    },
    deleteCommandMessages: {
        type: OptionType.BOOLEAN,
        description: "Delete the command message after it runs.",
        default: false
    },
    commandDeleteDelay: {
        type: OptionType.NUMBER,
        description: "Seconds before command messages are deleted.",
        default: 5
    },
    enableEval: {
        type: OptionType.BOOLEAN,
        description: "Allow .eval to run JavaScript in the client. Only enable this if you understand the risk.",
        default: false
    }
});
