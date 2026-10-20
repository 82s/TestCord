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

function targetsFor(state: WordState, progress: number): { scale: number; yOffset: number; glow: number; gradientPos: number; } {
    if (state === "Active") {
        return {
            scale: scaleTarget(progress),
            yOffset: yOffsetTarget(progress),
            glow: glowTarget(progress),
            gradientPos: -20 + 120 * progress,
        };
    }
    if (state === "Sung") {
        return { scale: 1.0, yOffset: 0, glow: 0, gradientPos: 100 };
    }
    return { scale: 0.95, yOffset: 1 / 100, glow: 0, gradientPos: -20 };
}

function createSprings(state: WordState, progress: number): WordSprings {
    const targets = targetsFor(state, progress);
    return {
        scale: new Spring(targets.scale, ScaleSpring.frequency, ScaleSpring.damping),
        yOffset: new Spring(targets.yOffset, YOffsetSpring.frequency, YOffsetSpring.damping),
        glow: new Spring(targets.glow, GlowSpring.frequency, GlowSpring.damping),
    };
}

function getOrCreateSprings(el: HTMLElement, state: WordState, progress: number): WordSprings {
    let springs = springsByElement.get(el);
    if (!springs) {
        springs = createSprings(state, progress);
        springsByElement.set(el, springs);
    }
    return springs;
}

const MAX_SCALE = 1.08;
const MIN_SCALE = 0.9;

interface WrittenStyle {
    scale: string;
    translate: string;
    gradient: string;
    shadowBlur: string;
    shadowOpacity: string;
    glowing: boolean;
}

const writtenByElement = new WeakMap<HTMLElement, WrittenStyle>();

function applyStyle(el: HTMLElement, scale: number, yOffset: number, gradientPos: number, glow: number): void {
    let w = writtenByElement.get(el);
    if (!w) {
        w = { scale: "", translate: "", gradient: "", shadowBlur: "", shadowOpacity: "", glowing: false };
        writtenByElement.set(el, w);
    }

    const scaleStr = scale.toFixed(3);
    if (scaleStr !== w.scale) {
        w.scale = scaleStr;
        el.style.scale = scaleStr;
    }

    const translateStr = `0 ${yOffset.toFixed(3)}em`;
    if (translateStr !== w.translate) {
        w.translate = translateStr;
        el.style.translate = translateStr;
    }

    const gradientStr = `${gradientPos.toFixed(1)}%`;
    if (gradientStr !== w.gradient) {
        w.gradient = gradientStr;
        el.style.setProperty("--spicy-gradient-position", gradientStr);
    }

    const glowing = glow > 0.02;
    if (glowing !== w.glowing) {
        w.glowing = glowing;
        el.classList.toggle("vc-spicy-glow", glowing);
    }
    if (glowing) {
        const blurStr = `${(4 + 2 * glow).toFixed(1)}px`;
        const opacityStr = `${Math.min(glow * 35, 100).toFixed(0)}%`;
        if (blurStr !== w.shadowBlur) {
            w.shadowBlur = blurStr;
            el.style.setProperty("--spicy-shadow-blur", blurStr);
        }
        if (opacityStr !== w.shadowOpacity) {
            w.shadowOpacity = opacityStr;
            el.style.setProperty("--spicy-shadow-opacity", opacityStr);
        }
    }
}

export function stepWord(el: HTMLElement, state: WordState, progress: number, deltaTimeSec: number): void {
    const springs = getOrCreateSprings(el, state, progress);
    const targets = targetsFor(state, progress);

    springs.scale.SetGoal(targets.scale);
    springs.yOffset.SetGoal(targets.yOffset);
    springs.glow.SetGoal(targets.glow);

    const currentScale = Math.min(Math.max(springs.scale.Step(deltaTimeSec), MIN_SCALE), MAX_SCALE);
    const currentYOffset = springs.yOffset.Step(deltaTimeSec);
    const currentGlow = Math.max(springs.glow.Step(deltaTimeSec), 0);

    applyStyle(el, currentScale, currentYOffset, targets.gradientPos, currentGlow);
}

export function resetWord(el: HTMLElement, state: WordState, progress: number): void {
    const springs = createSprings(state, progress);
    springsByElement.set(el, springs);

    const targets = targetsFor(state, progress);
    applyStyle(el, targets.scale, targets.yOffset, targets.gradientPos, targets.glow);
}
