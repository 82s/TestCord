/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Spring } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/spicyAnimator/Spring";

const SMOOTH_SCROLL_FREQUENCY = 1;
const SMOOTH_SCROLL_DAMPING = 1;
const SETTLE_PX = 0.25;
const SETTLE_SPEED = 0.05;
const MAX_STEP = 0.05;
const MAX_ELAPSED = 0.1;

export class SmoothScroller {
    private spring: Spring | null = null;
    private raf: number | null = null;
    private lastTs: number | null = null;
    private lastPosition: number | null = null;
    private getGoal: (() => number) | null = null;

    constructor(public readonly container: HTMLElement) { }

    scrollTo(getGoal: () => number, instant = false) {
        this.getGoal = getGoal;

        if (instant) {
            this.stop();
            this.container.scrollTo({ top: this.clamp(getGoal()), behavior: "instant" as ScrollBehavior });
            return;
        }

        const current = this.container.scrollTop;
        if (!this.spring) {
            this.spring = new Spring(current, SMOOTH_SCROLL_FREQUENCY, SMOOTH_SCROLL_DAMPING);
        } else if (this.raf === null) {
            this.spring.SetGoal(current, true);
        }

        if (this.raf === null) {
            this.lastTs = null;
            this.lastPosition = null;
            this.raf = requestAnimationFrame(this.step);
        }
    }

    stop() {
        if (this.raf !== null) cancelAnimationFrame(this.raf);
        this.raf = null;
        this.lastTs = null;
        this.lastPosition = null;
    }

    private clamp(top: number) {
        const max = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
        return Math.min(max, Math.max(0, top));
    }

    private step = (ts: number) => {
        this.raf = null;

        const { container, spring, getGoal } = this;
        if (!container.isConnected || !spring || !getGoal) return;

        const goal = this.clamp(getGoal());
        spring.SetGoal(goal);

        let elapsed = this.lastTs === null ? 1 / 60 : Math.min((ts - this.lastTs) / 1000, MAX_ELAPSED);
        this.lastTs = ts;

        let position = spring.Step(Math.min(elapsed, MAX_STEP));
        elapsed -= MAX_STEP;
        while (elapsed > 0) {
            position = spring.Step(Math.min(elapsed, MAX_STEP));
            elapsed -= MAX_STEP;
        }
        position = this.clamp(position);

        const moved = this.lastPosition === null ? Infinity : Math.abs(position - this.lastPosition);
        this.lastPosition = position;
        const settled = Math.abs(position - goal) < SETTLE_PX && moved < SETTLE_SPEED;

        const pixel = 1 / (window.devicePixelRatio || 1);
        const top = settled ? goal : Math.round(position / pixel) * pixel;
        container.scrollTo({ top, behavior: "instant" as ScrollBehavior });

        if (!settled) this.raf = requestAnimationFrame(this.step);
    };
}
