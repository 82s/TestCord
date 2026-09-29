/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Spring } from "./Spring";

export type WordState = "NotSung" | "Active" | "Sung";

export function getWordState(currentTimeSec: number, startTimeSec: number, endTimeSec: number): WordState {
    if (currentTimeSec < startTimeSec) return "NotSung";
    if (currentTimeSec >= endTimeSec) return "Sung";
    return "Active";
}

export function getWordProgress(currentTimeSec: number, startTimeSec: number, endTimeSec: number): number {
    if (currentTimeSec <= startTimeSec) return 0;
    if (currentTimeSec >= endTimeSec) return 1;
    return (currentTimeSec - startTimeSec) / (endTimeSec - startTimeSec);
}

interface WordSprings {
    scale: Spring;
    yOffset: Spring;
    glow: Spring;
}

const springsByElement = new WeakMap<HTMLElement, WordSprings>();

const ScaleSpring = { frequency: 0.88, damping: 0.64 };
const YOffsetSpring = { frequency: 1.45, damping: 0.4 };
const GlowSpring = { frequency: 1.18, damping: 0.56 };

function getOrCreateSprings(el: HTMLElement): WordSprings {
    let springs = springsByElement.get(el);
    if (!springs) {
        springs = {
            scale: new Spring(0.95, ScaleSpring.frequency, ScaleSpring.damping),
            yOffset: new Spring(1 / 100, YOffsetSpring.frequency, YOffsetSpring.damping),
            glow: new Spring(0, GlowSpring.frequency, GlowSpring.damping),
        };
        springsByElement.set(el, springs);
    }
    return springs;
}

function easeOutQuad(t: number): number { return t * (2 - t); }
function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

function scaleTarget(progress: number): number {
    if (progress <= 0.7) {
        return 0.95 + (1.0505 - 0.95) * easeOutQuad(progress / 0.7);
    }
    return 1.0505 - (1.0505 - 1.0) * easeOutCubic((progress - 0.7) / 0.3);
}

function yOffsetTarget(progress: number): number {
    if (progress <= 0.9) {
        return 1/100 + (-(1/60) - 1/100) * easeOutQuad(progress / 0.9);
    }

    return -(1/60) + (1/60) * easeOutCubic((progress - 0.9) / 0.1);
}

function glowTarget(progress: number): number {
    if (progress <= 0.15) {
        return progress / 0.15;
    }

    if (progress <= 0.6) {
        return 1;
    }

    return 1 - easeOutCubic((progress - 0.6) / 0.4);
}

export function stepWord(el: HTMLElement, state: WordState, progress: number, deltaTimeSec: number): void {
    const springs = getOrCreateSprings(el);

    let targetScale: number;
    let targetYOffset: number;
    let targetGlow: number;
    let targetGradientPos: number;

    if (state === "Active") {
        targetScale = scaleTarget(progress);
        targetYOffset = yOffsetTarget(progress);
        targetGlow = glowTarget(progress);
        targetGradientPos = -20 + 120 * progress;
    } else if (state === "NotSung") {
        targetScale = 0.95;
        targetYOffset = 1 / 100;
        targetGlow = 0;
        targetGradientPos = -20;
    } else {
        targetScale = 1.0;
        targetYOffset = 0;
        targetGlow = 0;
        targetGradientPos = 100;
    }

    springs.scale.SetGoal(targetScale);
    springs.yOffset.SetGoal(targetYOffset);
    springs.glow.SetGoal(targetGlow);

    const currentScale = springs.scale.Step(deltaTimeSec);
    const currentYOffset = springs.yOffset.Step(deltaTimeSec);
    const currentGlow = springs.glow.Step(deltaTimeSec);

    el.style.scale = String(currentScale);
    el.style.translate = `0 ${currentYOffset.toFixed(4)}em`;
    el.style.setProperty("--spicy-gradient-position", `${targetGradientPos}%`);
    el.style.setProperty("--spicy-shadow-blur", `${(4 + 2 * currentGlow).toFixed(2)}px`);
    el.style.setProperty("--spicy-shadow-opacity", `${Math.min(currentGlow * 35, 100).toFixed(1)}%`);
}

export function resetWord(el: HTMLElement, state: WordState): void {
    const progress = state === "Sung" ? 1 : 0;
    const scaleGoal = progress === 1 ? 1.0 : 0.95;
    const yOffsetGoal = progress === 1 ? 0 : 1 / 100;
    const glowGoal = 0;

    springsByElement.set(el, {
        scale: new Spring(scaleGoal, ScaleSpring.frequency, ScaleSpring.damping),
        yOffset: new Spring(yOffsetGoal, YOffsetSpring.frequency, YOffsetSpring.damping),
        glow: new Spring(glowGoal, GlowSpring.frequency, GlowSpring.damping),
    });

    el.style.scale = String(scaleGoal);
    el.style.translate = `0 ${yOffsetGoal.toFixed(4)}em`;
    el.style.setProperty("--spicy-gradient-position", `${state === "Sung" ? 100 : -20}%`);
    el.style.setProperty("--spicy-shadow-blur", `${(4 + 2 * glowGoal).toFixed(2)}px`);
    el.style.setProperty("--spicy-shadow-opacity", `${Math.min(glowGoal * 35, 100).toFixed(1)}%`);
}
