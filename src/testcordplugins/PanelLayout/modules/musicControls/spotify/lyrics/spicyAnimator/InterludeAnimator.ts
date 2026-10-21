/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Spline } from "./Splines";
import { Spring } from "./Spring";

const DOT_COUNT = 3;

const DotScaleSpline = new Spline([
    { Time: 0, Value: 0.75 },
    { Time: 0.7, Value: 1.05 },
    { Time: 1, Value: 1 },
]);

const DotYOffsetSpline = new Spline([
    { Time: 0, Value: 0 },
    { Time: 0.9, Value: -0.12 },
    { Time: 1, Value: 0 },
]);

const DotGlowSpline = new Spline([
    { Time: 0, Value: 0 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 1 },
]);

const DotOpacitySplineFull = new Spline([
    { Time: 0, Value: 0.35 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 1 },
]);

const DotOpacitySplineSimple = new Spline([
    { Time: 0, Value: 0.27 },
    { Time: 0.6, Value: 1 },
    { Time: 1, Value: 1 },
]);

const DOT_SCALE = { frequency: 0.7, damping: 0.6 };
const DOT_Y_OFFSET = { frequency: 1.25, damping: 0.4 };
const DOT_GLOW = { frequency: 1, damping: 0.5 };
const DOT_OPACITY = { frequency: 1, damping: 0.5 };

export const PRE_HIDDEN_DOT_LINE_SEC = 0.5;
const INTERLUDE_TIME_PADDING_SEC = -0.55;

const DOT_GROUP_EXPANSION_MS = 300;
const DOT_GROUP_COLLAPSE_MS = 400;
const MUSICAL_LINE_TRANSITION_MS = 140;

function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
    const bx = (s: number, p1: number, p2: number) => {
        const u = 1 - s;
        return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
    };
    const slope = (s: number, p1: number, p2: number) => {
        const u = 1 - s;
        return 3 * u * u * p1 + 6 * u * s * (p2 - p1) + 3 * s * s * (1 - p2);
    };

    return (x: number): number => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;

        let s = x;
        for (let i = 0; i < 8; i++) {
            const dx = bx(s, x1, x2) - x;
            if (Math.abs(dx) < 1e-5) return bx(s, y1, y2);
            const d = slope(s, x1, x2);
            if (Math.abs(d) < 1e-6) break;
            s -= dx / d;
        }

        let lo = 0;
        let hi = 1;
        s = x;
        for (let i = 0; i < 30; i++) {
            const cx = bx(s, x1, x2);
            if (Math.abs(cx - x) < 1e-5) return bx(s, y1, y2);
            if (cx < x) lo = s; else hi = s;
            s = (lo + hi) / 2;
        }
        return bx(s, y1, y2);
    };
}

const OPACITY_EASING = cubicBezier(0.61, 1, 0.88, 1);
const SCALE_EASING = cubicBezier(0.37, 0, 0.63, 1);

const DOT_COLLAPSE_STOPS = [
    0, 0, 0.094, -0.006, 0.18, -0.029, 0.433, -0.157,
    0.514, -0.185, 0.559, -0.189, 0.6, -0.182, 0.639, -0.163,
    0.676, -0.133, 0.723, -0.074, 0.767, 0.006, 0.85, 0.238,
    0.927, 0.566, 1, 1,
];

function collapseEasing(fraction: number): number {
    const stops = DOT_COLLAPSE_STOPS;
    let index = 0;
    while (index < stops.length - 4 && fraction > stops[index + 2]) index += 2;
    const x0 = stops[index];
    const y0 = stops[index + 1];
    const x1 = stops[index + 2];
    const y1 = stops[index + 3];
    return y0 + (y1 - y0) * ((fraction - x0) / Math.max(x1 - x0, 0.0001));
}

export function interludeDotTimes(startSec: number, endSec: number): Array<[number, number]> {
    const total = endSec - startSec;
    const base = total / 3;
    const padding = INTERLUDE_TIME_PADDING_SEC / 3;
    const dot1 = Math.max(startSec, startSec + base + padding);
    const dot2 = Math.max(dot1, startSec + base * 2 + padding * 2);
    const dot3 = Math.max(dot2, startSec + total + INTERLUDE_TIME_PADDING_SEC);
    return [[startSec, dot1], [dot1, dot2], [dot2, dot3]];
}

type DotState = "NotSung" | "Active" | "Sung";

function dotStateOf(t: number, start: number, end: number): DotState {
    if (t < start) return "NotSung";
    if (t >= end) return "Sung";
    return "Active";
}

function progressOf(t: number, start: number, end: number): number {
    if (t <= start) return 0;
    if (t >= end) return 1;
    return (t - start) / (end - start);
}

interface DotSprings {
    scale: Spring;
    yOffset: Spring;
    glow: Spring;
    opacity: Spring;
}

interface Tween {
    value: number;
    from: number;
    target: number;
    startedAt: number;
    durationMs: number;
    easing: (x: number) => number;
}

interface InterludeState {
    dots: DotSprings[];
    open: Tween;
    opacity: Tween;
    dotEls: HTMLElement[];
}

const stateByRow = new WeakMap<HTMLElement, InterludeState>();

function opacitySpline(simple: boolean) {
    return simple ? DotOpacitySplineSimple : DotOpacitySplineFull;
}

function sample(spline: Spline, state: DotState, pct: number): number {
    if (state === "Active") return spline.at(pct);
    if (state === "NotSung") return spline.at(0);
    return spline.at(1);
}

function newTween(value: number): Tween {
    return { value, from: value, target: value, startedAt: 0, durationMs: 0, easing: x => x };
}

function retarget(tween: Tween, target: number, now: number, durationMs: number, easing: (x: number) => number) {
    if (tween.target === target) return;
    tween.from = tween.value;
    tween.target = target;
    tween.startedAt = now;
    tween.durationMs = durationMs;
    tween.easing = easing;
}

function stepTween(tween: Tween, now: number): number {
    if (tween.value === tween.target) return tween.value;
    const elapsed = now - tween.startedAt;
    if (elapsed >= tween.durationMs) {
        tween.value = tween.target;
    } else {
        tween.value = tween.from + (tween.target - tween.from) * tween.easing(Math.max(elapsed, 0) / tween.durationMs);
    }
    return tween.value;
}

function createDot(state: DotState, pct: number, simple: boolean): DotSprings {
    const opacity = opacitySpline(simple);
    return {
        scale: new Spring(sample(DotScaleSpline, state, pct), DOT_SCALE.frequency, DOT_SCALE.damping),
        yOffset: new Spring(sample(DotYOffsetSpline, state, pct), DOT_Y_OFFSET.frequency, DOT_Y_OFFSET.damping),
        glow: new Spring(sample(DotGlowSpline, state, pct), DOT_GLOW.frequency, DOT_GLOW.damping),
        opacity: new Spring(sample(opacity, state, pct), DOT_OPACITY.frequency, DOT_OPACITY.damping),
    };
}

function isOpenTarget(posSec: number, startSec: number, endSec: number): boolean {
    return posSec >= startSec && posSec <= endSec - PRE_HIDDEN_DOT_LINE_SEC;
}

function isActive(posSec: number, startSec: number, endSec: number): boolean {
    return posSec >= startSec && posSec < endSec;
}

function write(row: HTMLElement, st: InterludeState, simple: boolean, scales: number[], ys: number[], glows: number[], opacities: number[]) {
    const open = st.open.value;
    const group = Math.min(Math.max(open, 0), 1.3);

    row.style.setProperty("--vc-dots-open", Math.min(Math.max(open, 0), 1).toFixed(3));
    row.style.setProperty("--vc-dots-scale", group.toFixed(3));
    row.style.setProperty("--vc-dots-opacity", Math.min(Math.max(st.opacity.value, 0), 1).toFixed(3));

    for (let i = 0; i < st.dotEls.length; i++) {
        const el = st.dotEls[i];
        const s = simple ? 1 : Math.min(Math.max(scales[i], 0), 1.5);
        const y = simple ? 0 : ys[i];
        const g = simple ? 0 : Math.min(Math.max(glows[i], 0), 1);
        const o = Math.min(Math.max(opacities[i], 0), 1);

        el.style.transform = `translate3d(0, ${y.toFixed(4)}em, 0) scale(${s.toFixed(3)})`;
        el.style.opacity = o.toFixed(3);
        el.style.boxShadow = g * 0.9 > 0.02
            ? `0 0 ${((4 + 6 * g) / 56).toFixed(3)}em rgb(255 255 255 / ${(g * 0.9).toFixed(2)})`
            : "none";
    }
}

function getState(row: HTMLElement): InterludeState | null {
    let st = stateByRow.get(row);
    const dotEls = Array.from(row.querySelectorAll<HTMLElement>("[data-vc-dot]"));
    if (!dotEls.length) return null;
    if (!st) {
        st = {
            dots: [],
            open: newTween(0),
            opacity: newTween(0),
            dotEls,
        };
        stateByRow.set(row, st);
    } else {
        st.dotEls = dotEls;
    }
    return st;
}

export function resetInterlude(row: HTMLElement, startSec: number, endSec: number, posSec: number, simple: boolean): void {
    const st = getState(row);
    if (!st) return;

    const times = interludeDotTimes(startSec, endSec);
    st.dots = times.map(([s, e]) => createDot(dotStateOf(posSec, s, e), progressOf(posSec, s, e), simple));

    const open = isOpenTarget(posSec, startSec, endSec) ? 1 : 0;
    st.open = newTween(open);
    st.opacity = newTween(isActive(posSec, startSec, endSec) ? 1 : 0);

    write(
        row, st, simple,
        st.dots.map(d => d.scale.Step(0)),
        st.dots.map(d => d.yOffset.Step(0)),
        st.dots.map(d => d.glow.Step(0)),
        st.dots.map(d => d.opacity.Step(0))
    );
}

export function stepInterlude(row: HTMLElement, startSec: number, endSec: number, posSec: number, dt: number, now: number, simple: boolean): void {
    const st = getState(row);
    if (!st) return;
    if (st.dots.length !== DOT_COUNT) {
        resetInterlude(row, startSec, endSec, posSec, simple);
        return;
    }

    const openTarget = isOpenTarget(posSec, startSec, endSec) ? 1 : 0;
    retarget(
        st.open, openTarget, now,
        openTarget === 0 ? DOT_GROUP_COLLAPSE_MS : DOT_GROUP_EXPANSION_MS,
        openTarget === 0 ? collapseEasing : SCALE_EASING
    );
    stepTween(st.open, now);

    retarget(st.opacity, isActive(posSec, startSec, endSec) ? 1 : 0, now, MUSICAL_LINE_TRANSITION_MS, OPACITY_EASING);
    stepTween(st.opacity, now);

    const opSpline = opacitySpline(simple);
    const times = interludeDotTimes(startSec, endSec);
    const scales: number[] = [];
    const ys: number[] = [];
    const glows: number[] = [];
    const opacities: number[] = [];

    for (let i = 0; i < DOT_COUNT; i++) {
        const [s, e] = times[i];
        const state = dotStateOf(posSec, s, e);
        const pct = progressOf(posSec, s, e);
        const d = st.dots[i];

        d.scale.SetGoal(sample(DotScaleSpline, state, pct));
        d.yOffset.SetGoal(sample(DotYOffsetSpline, state, pct));
        d.glow.SetGoal(sample(DotGlowSpline, state, pct));
        d.opacity.SetGoal(sample(opSpline, state, pct));

        scales.push(d.scale.Step(dt));
        ys.push(d.yOffset.Step(dt));
        glows.push(d.glow.Step(dt));
        opacities.push(d.opacity.Step(dt));
    }

    write(row, st, simple, scales, ys, glows, opacities);
}
