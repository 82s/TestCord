/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Margins } from "@components/margins";
import { Notice } from "@components/Notice";

function AutoRedeemWarning() {
    return (
        <>
            <Notice.Warning className={Margins.bottom8}>
                <strong>Automated redemption and external-service warning.</strong>
                <p>You are responsible for ensuring that every redemption attempt is authorized and complies with Discord&apos;s rules. Do not use automation, third-party CAPTCHA services, proxies, or webhooks to claim codes unfairly, evade safeguards, misuse another account, or expose personal data and credentials.</p>
                <p>Nothing in this notice excludes liability that cannot be excluded under applicable law.</p>
            </Notice.Warning>
            <Notice.Warning>
                Automatic CAPTCHA solving sends the site key, request data, Discord page URL, and your user agent to the selected third-party service and may spend credits. If solving fails, AutoRedeem falls back to retrying the code with backoff. NoCaptchaAI does not currently document hCaptcha token tasks, so its compatible task mode may stop working if the provider rejects it.
            </Notice.Warning>
        </>
    );
}

export const AutoRedeemLegalWarning = ErrorBoundary.wrap(AutoRedeemWarning, { noop: true });
