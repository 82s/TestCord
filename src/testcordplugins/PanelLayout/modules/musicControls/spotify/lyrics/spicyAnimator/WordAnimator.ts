/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LyricWord } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";

import { Spline } from "./Splines";
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

const ScaleSpline = new Spline([
    { Time: 0, Value: 0.95 },
    { Time: 0.7, Value: 1.0505 },
    { Time: 1, Value: 1 },
]);

const YOffsetSpline = new Spline([
    { Time: 0, Value: 1 / 100 },
    { Time: 0.9, Value: -(1 / 60) },
    { Time: 1, Value: 0 },
]);

const GlowSpline = new Spline([
    { Time: 0, Value: 0 },
    { Time: 0.15, Value: 1 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 0 },
]);

function targetsFor(state: WordState, progress: number): { scale: number; yOffset: number; glow: number; gradientPos: number; } {
    if (state === "Active") {
        return {
            scale: ScaleSpline.at(progress),
            yOffset: YOffsetSpline.at(progress),
            glow: GlowSpline.at(progress),
            gradientPos: -20 + 120 * progress,
        };
    }
    if (state === "Sung") {
        return { scale: ScaleSpline.at(1), yOffset: YOffsetSpline.at(1), glow: GlowSpline.at(1), gradientPos: 100 };
    }
    return { scale: ScaleSpline.at(0), yOffset: YOffsetSpline.at(0), glow: GlowSpline.at(0), gradientPos: -20 };
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

    const translateStr = `translate3d(0, ${yOffset.toFixed(4)}em, 0)`;
    if (translateStr !== w.translate) {
        w.translate = translateStr;
        el.style.transform = translateStr;
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
        // Spicy's radii are px values tuned for ~40px lyrics; em keeps the glow in proportion to this panel's text.
        const blurStr = `${((4 + 2 * Math.min(glow, 1)) / 40).toFixed(3)}em`;
        const opacityStr = `${(Math.min(glow, 1) * 35).toFixed(0)}%`;
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

export function stepWord(el: HTMLElement, state: WordState, progress: number, deltaTimeSec: number, animated = true): void {
    if (!animated) {
        applyStyle(el, 1, 0, targetsFor(state, progress).gradientPos, 0);
        return;
    }

    const springs = getOrCreateSprings(el, state, progress);
    const targets = targetsFor(state, progress);

    springs.scale.SetGoal(targets.scale);
    springs.yOffset.SetGoal(targets.yOffset);
    springs.glow.SetGoal(targets.glow);

    const currentScale = springs.scale.Step(deltaTimeSec);
    const currentYOffset = springs.yOffset.Step(deltaTimeSec);
    const currentGlow = Math.max(springs.glow.Step(deltaTimeSec), 0);

    applyStyle(el, currentScale, currentYOffset, targets.gradientPos, currentGlow);
}

export function resetWord(el: HTMLElement, state: WordState, progress: number, animated = true): void {
    const targets = targetsFor(state, progress);
    if (!animated) {
        springsByElement.delete(el);
        applyStyle(el, 1, 0, targets.gradientPos, 0);
        return;
    }

    const springs = createSprings(state, progress);
    springsByElement.set(el, springs);

    applyStyle(el, targets.scale, targets.yOffset, targets.gradientPos, targets.glow);
}

const LETTER_MIN_DURATION_SEC = 1;
const LETTER_TAIL_TRIM_SEC = 0.25;
const SUNG_LETTER_GLOW = 0.2;

const LetterScaleSpline = new Spline([
    { Time: 0, Value: 0.95 },
    { Time: 0.7, Value: 1.175 },
    { Time: 1, Value: 1 },
]);

const LetterYOffsetSpline = new Spline([
    { Time: 0, Value: 0.01 },
    { Time: 0.9, Value: -1 / 56 },
    { Time: 1, Value: 0 },
]);

const RTL_RE = /[\u0590-\u08FF]/;

let segmenter: { segment(text: string): Iterable<{ segment: string; }>; } | null | undefined;

export function segmentGraphemes(text: string): string[] {
    if (segmenter === undefined) {
        const Seg = (Intl as any).Segmenter;
        segmenter = Seg ? new Seg(undefined, { granularity: "grapheme" }) : null;
    }
    return segmenter ? Array.from(segmenter.segment(text), x => x.segment) : Array.from(text);
}

export function isLetterCapable(text: string, startSec: number, endSec: number): boolean {
    const display = text.trim();
    return !!display && endSec - startSec >= LETTER_MIN_DURATION_SEC && !RTL_RE.test(display);
}

function letterWindow(startSec: number, endSec: number): [number, number] {
    return [startSec, Math.max(endSec - LETTER_TAIL_TRIM_SEC, startSec + 0.001)];
}

function wordWindow(el: HTMLElement, word: LyricWord): [number, number] {
    return el.dataset.vcLetters ? letterWindow(word.startTime, word.endTime) : [word.startTime, word.endTime];
}

interface LetterTarget {
    scale: number;
    yOffset: number;
    glow: number;
    gradient: number;
}

function computeLetterTargets(count: number, word: LyricWord, posSec: number): LetterTarget[] {
    const [ws, we] = letterWindow(word.startTime, word.endTime);
    const span = (we - ws) / count;
    const wordState = getWordState(posSec, ws, we);

    if (wordState !== "Active") {
        const t = wordState === "NotSung" ? 0 : 1;
        const gradient = wordState === "NotSung" ? -20 : 100;
        return Array.from({ length: count }, () => ({
            scale: LetterScaleSpline.at(t),
            yOffset: LetterYOffsetSpline.at(t),
            glow: GlowSpline.at(t),
            gradient,
        }));
    }

    let activeIdx = -1;
    let activePct = 0;
    for (let i = 0; i < count; i++) {
        const ls = ws + i * span;
        const le = ws + (i + 1) * span;
        if (getWordState(posSec, ls, le) === "Active") {
            activeIdx = i;
            activePct = getWordProgress(posSec, ls, le);
            break;
        }
    }

    const restingScale = LetterScaleSpline.at(0);
    const restingY = LetterYOffsetSpline.at(0);
    const restingGlow = GlowSpline.at(0);

    return Array.from({ length: count }, (_, k) => {
        const ls = ws + k * span;
        const le = ws + (k + 1) * span;
        const letterState = getWordState(posSec, ls, le);

        let scale = restingScale;
        let yOffset = restingY;
        let glow = restingGlow;

        if (activeIdx !== -1) {
            const baseScale = LetterScaleSpline.at(activePct);
            const baseY = LetterYOffsetSpline.at(activePct);
            const baseGlow = GlowSpline.at(activePct);

            const distance = Math.abs(k - activeIdx);
            const falloff = 1 / (1 + distance ** 2.8);
            const glowFalloff = 1 / (1 + distance * 0.9);

            scale = restingScale + (baseScale - restingScale) * falloff;
            yOffset = restingY + (baseY - restingY) * falloff;
            glow = restingGlow + (baseGlow - restingGlow) * glowFalloff;
        }

        if (letterState === "NotSung") {
            scale = restingScale;
            yOffset = restingY;
            glow = restingGlow;
        } else if (letterState === "Sung" && activeIdx === -1) {
            glow = GlowSpline.at(SUNG_LETTER_GLOW);
        }

        let gradient = -20;
        if (letterState === "Sung") gradient = 100;
        else if (letterState === "Active" && k === activeIdx) gradient = -20 + 120 * Math.sin(activePct * (Math.PI / 2));

        return { scale, yOffset, glow, gradient };
    });
}

const letterSprings = new WeakMap<HTMLElement, WordSprings>();

function applyLetter(el: HTMLElement, scale: number, yOffset: number, glow: number, gradient: number, animated: boolean) {
    const s = animated ? scale : 1;
    const y = animated ? yOffset * 2 : 0;
    const g = animated ? Math.min(Math.max(glow, 0), 1) : 0;

    el.style.scale = s.toFixed(3);
    el.style.transform = `translate3d(0, ${y.toFixed(4)}em, 0)`;
    el.style.setProperty("--spicy-gradient-position", `${gradient.toFixed(1)}%`);
    el.style.setProperty("--spicy-shadow-blur", `${((4 + 12 * g) / 40).toFixed(3)}em`);
    el.style.setProperty("--spicy-shadow-opacity", `${Math.min(g * 1.85, 1) * 100 | 0}%`);
}

function letterElements(el: HTMLElement): HTMLElement[] {
    return Array.from(el.children).filter((c): c is HTMLElement => (c as HTMLElement).classList?.contains("vc-spicy-letter"));
}

function stepLetters(el: HTMLElement, word: LyricWord, posSec: number, dt: number, animated: boolean, snap: boolean) {
    const letters = letterElements(el);
    if (!letters.length) return;

    const targets = computeLetterTargets(letters.length, word, posSec);
    letters.forEach((letterEl, i) => {
        const t = targets[i];
        let springs = letterSprings.get(letterEl);
        if (!springs || snap) {
            springs = {
                scale: new Spring(t.scale, ScaleSpring.frequency, ScaleSpring.damping),
                yOffset: new Spring(t.yOffset, YOffsetSpring.frequency, YOffsetSpring.damping),
                glow: new Spring(t.glow, GlowSpring.frequency, GlowSpring.damping),
            };
            letterSprings.set(letterEl, springs);
        }

        springs.scale.SetGoal(t.scale);
        springs.yOffset.SetGoal(t.yOffset);
        springs.glow.SetGoal(t.glow);

        const dtStep = snap ? 0 : dt;
        applyLetter(letterEl, springs.scale.Step(dtStep), springs.yOffset.Step(dtStep), springs.glow.Step(dtStep), t.gradient, animated);
    });
}

export function stepWordFull(el: HTMLElement, word: LyricWord, posSec: number, dt: number, animated: boolean): void {
    const [s, e] = wordWindow(el, word);
    stepWord(el, getWordState(posSec, s, e), getWordProgress(posSec, s, e), dt, animated);
    if (el.dataset.vcLetters) stepLetters(el, word, posSec, dt, animated, false);
}

export function resetWordFull(el: HTMLElement, word: LyricWord, posSec: number, animated: boolean): void {
    const [s, e] = wordWindow(el, word);
    resetWord(el, getWordState(posSec, s, e), getWordProgress(posSec, s, e), animated);
    if (el.dataset.vcLetters) stepLetters(el, word, posSec, 0, animated, true);
}
