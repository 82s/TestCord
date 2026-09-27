/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { findComponentByCodeLazy } from "@webpack";

export const ServerProfile = findComponentByCodeLazy("{guildProfile:", "GUILD_PROFILE");
export const cl = classNameFactory("vc-forwardmeta-");

export function Chevron() {
    return (
        <svg aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <path
                fill="currentColor"
                d="M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z"
            />
        </svg>
    );
}
