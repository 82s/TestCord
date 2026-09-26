/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    cordCatApiKey: {
        type: OptionType.STRING,
        description: "CordCat API key (required). Get one at https://api.cord.cat",
        default: "",
    },
    cordCatApiBaseUrl: {
        type: OptionType.STRING,
        description: "Base URL for the CordCat intelligence query API.",
        default: "https://api.cord.cat",
    },
    dsaBrowseBaseUrl: {
        type: OptionType.STRING,
        description: "Base URL for the DSA lookup browse UI.",
        default: "https://dsa.discord.food",
    },
});
