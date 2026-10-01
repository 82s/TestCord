/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, showToast, Toasts, UserStore } from "@webpack/common";

const AgeVerificationStatus = {
    TEEN: 2,
    ADULT: 3
} as const;

const settings = definePluginSettings({
    teen: {
        description: "Set the teen age group instead of adult",
        type: OptionType.BOOLEAN,
        default: false,
        onChange(newValue: boolean) {
            setAgeGroup();
            showToast(`Age group set to ${newValue ? "teen" : "adult"}`, Toasts.Type.SUCCESS);
        }
    }
});

function setAgeGroup() {
    const status = settings.plain.teen ? AgeVerificationStatus.TEEN : AgeVerificationStatus.ADULT;
    if (UserStore.getCurrentUser()?.ageVerificationStatus === status) return;

    // CLOSE_AGE_VERIFICATION_MODAL is only honoured while the current user is
    // pending, and INITIATE_AGE_VERIFICATION is what puts them in that state.
    FluxDispatcher.dispatch({ type: "INITIATE_AGE_VERIFICATION" });
    FluxDispatcher.dispatch({ type: "CLOSE_AGE_VERIFICATION_MODAL", status });
}

export default definePlugin({
    name: "SetAge",
    description: "Gives accounts with no age group one, so Discord stops asking you to verify your age. Stays on this client only.",
    tags: ["Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        setAgeGroup();
    },

    flux: {
        CURRENT_USER_UPDATE() {
            setAgeGroup();
        }
    }
});
