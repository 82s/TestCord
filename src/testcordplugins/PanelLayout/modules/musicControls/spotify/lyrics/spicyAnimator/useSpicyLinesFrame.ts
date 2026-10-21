/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { isInterludeLine, LineTimes } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/lineTiming";
import { LyricWord, SyncedLyric } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { React } from "@webpack/common";

import { resetInterlude, stepInterlude } from "./InterludeAnimator";
import { Spline } from "./Splines";
import { Spring } from "./Spring";
import { resetWordFull, stepWordFull } from "./WordAnimator";

type WordRefs = { current: (HTMLSpanElement | null)[]; };

export interface LineWordRefs {
    lead: WordRefs;
    bg: WordRefs[];
    row: HTMLElement | null;
}

export type LineRegistry = Map<number, LineWordRefs>;

export function getLineWordRefs(registry: LineRegistry, index: number): LineWordRefs {
    let refs = registry.get(index);
    if (!refs) {
        refs = { lead: { current: [] }, bg: [], row: null };
        registry.set(index, refs);
    }
    return refs;
}

export function getBgRefs(refs: LineWordRefs, bgIndex: number): WordRefs {
    return (refs.bg[bgIndex] ??= { current: [] });
}

export function rowRef(base: { current: HTMLDivElement | null; } | undefined, refs: LineWordRefs) {
    return (el: HTMLDivElement | null) => {
        if (base) base.current = el;
        refs.row = el;
    };
}

const LineGlowSpline = new Spline([
    { Time: 0, Value: 0 },
    { Time: 0.5, Value: 1 },
    { Time: 1, Value: 0 },
]);

const GLOW_REFERENCE_PX = 40;
const LINE_GLOW_FREQUENCY = 1;
const LINE_GLOW_DAMPING = 0.5;

const lineSprings = new WeakMap<HTMLElement, Spring>();

function lineElOf(refs: LineWordRefs): HTMLElement | null {
    return (refs.row?.firstElementChild as HTMLElement | null) ?? null;
}

function setVar(el: HTMLElement, name: string, value: string) {
    if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

function lineTargets(state: string, progress: number) {
    if (state === "a") return { glow: LineGlowSpline.at(progress), gradient: progress * 100 };
    if (state === "s") return { glow: LineGlowSpline.at(1), gradient: 100 };
    return { glow: LineGlowSpline.at(0), gradient: -20 };
}

function stepLine(el: HTMLElement, state: string, progress: number, dt: number, snap: boolean) {
    const t = lineTargets(state, progress);
    let spring = lineSprings.get(el);
    if (!spring) {
        spring = new Spring(t.glow, LINE_GLOW_FREQUENCY, LINE_GLOW_DAMPING);
        lineSprings.set(el, spring);
    }
    spring.SetGoal(t.glow, snap);
    const glow = Math.min(Math.max(spring.Step(dt), 0), 1);

    setVar(el, "--gradient-position", `${t.gradient.toFixed(1)}%`);
    setVar(el, "--text-shadow-blur-radius", `${((4 + 8 * glow) / GLOW_REFERENCE_PX).toFixed(3)}em`);
    setVar(el, "--text-shadow-opacity", `${Math.round(glow * 50)}%`);
}

function clearLineSweep(el: HTMLElement) {
    el.style.removeProperty("--gradient-position");
    el.style.removeProperty("--text-shadow-blur-radius");
    el.style.removeProperty("--text-shadow-opacity");
}

function isPlainLine(line: SyncedLyric) {
    return line.text !== null && !line.words?.length;
}

const BLUR_MULTIPLIER = 1.25;
const BLUR_MAX = BLUR_MULTIPLIER * 5 + BLUR_MULTIPLIER * 0.465;
const BLUR_SCALE = 0.22;

function applyBlur(lines: SyncedLyric[], registry: LineRegistry, states: string, activeIndex: number) {
    for (let i = 0; i < lines.length; i++) {
        const row = registry.get(i)?.row;
        if (!row) continue;
        const distance = Math.abs(i - activeIndex);
        const px = states[i] === "a" || distance === 0 ? 0 : Math.min(BLUR_MULTIPLIER * distance, BLUR_MAX) * BLUR_SCALE;
        setVar(row, "--BlurAmount", `${px.toFixed(2)}px`);
    }
}

const SETTLE_MS = 1600;
const JUMP_SEC = 1.2;

function forEachWord(line: SyncedLyric, refs: LineWordRefs, fn: (el: HTMLSpanElement, word: LyricWord) => void) {
    line.words?.forEach((word, k) => {
        const el = refs.lead.current[k];
        if (el) fn(el, word);
    });
    line.background?.forEach((bg, b) => {
        const group = refs.bg[b];
        if (!group) return;
        bg.words.forEach((word, k) => {
            const el = group.current[k];
            if (el) fn(el, word);
        });
    });
}

function resetAll(lines: SyncedLyric[], registry: LineRegistry, posSec: number, lineTimes: LineTimes[], animated: boolean, isSpicy: boolean) {
    for (let i = 0; i < lines.length; i++) {
        const refs = registry.get(i);
        if (!refs) continue;
        if (isInterludeLine(lines[i])) {
            if (refs.row) resetInterlude(refs.row, lineTimes[i].start, lineTimes[i].end, posSec, !animated);
            continue;
        }
        if (isPlainLine(lines[i])) {
            const el = lineElOf(refs);
            if (el && !isSpicy) {
                clearLineSweep(el);
            } else if (el) {
                const { start, end } = lineTimes[i];
                const state = posSec < start ? "n" : posSec >= end ? "s" : "a";
                const progress = end > start ? Math.min(Math.max((posSec - start) / (end - start), 0), 1) : 0;
                stepLine(el, state, progress, 0, true);
            }
            continue;
        }
        forEachWord(lines[i], refs, (el, w) => resetWordFull(el, w, posSec, animated));
    }
}

export function useSpicyLinesFrame({ lines, lineTimes, registry, statesRef, positionRef, isPlaying, pausedPosition, isSpicy = true }: {
    lines: SyncedLyric[] | null | undefined;
    lineTimes: LineTimes[] | null;
    registry: LineRegistry;
    statesRef: { current: string; };
    positionRef: { current: number; };
    isPlaying: boolean;
    pausedPosition: number;
    isSpicy?: boolean;
}) {
    const { lyricsAnimation } = settings.use(["lyricsAnimation"]);

    React.useLayoutEffect(() => {
        if (!lines || !lineTimes) return;
        resetAll(lines, registry, positionRef.current / 1000, lineTimes, lyricsAnimation, isSpicy);
        const states = statesRef.current;
        const activeIndex = states.indexOf("a");
        if (activeIndex !== -1) applyBlur(lines, registry, states, activeIndex);
    }, [lines, lineTimes, registry, lyricsAnimation, isSpicy]);

    React.useEffect(() => {
        if (!lines || !lineTimes) return;

        let rafId: number | undefined;
        let lastFrameTime = performance.now();
        let prevStates = "";
        let prevPos = positionRef.current / 1000;
        let needsReset = true;
        let blurIndex = -1;
        const settleUntil = new Map<number, number>();

        const frame = (now: number) => {
            const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
            lastFrameTime = now;

            const posSec = positionRef.current / 1000;
            const states = statesRef.current;

            if (needsReset || Math.abs(posSec - prevPos) > JUMP_SEC) {
                needsReset = false;
                settleUntil.clear();
                resetAll(lines, registry, posSec, lineTimes, lyricsAnimation, isSpicy);
            } else {
                for (let i = 0; i < lines.length; i++) {
                    const state = states[i];
                    if (state !== prevStates[i]) settleUntil.set(i, now + SETTLE_MS);

                    const until = settleUntil.get(i);
                    const settling = until !== undefined && now < until;
                    if (until !== undefined && !settling) settleUntil.delete(i);

                    if (state !== "a" && !settling) continue;

                    const refs = registry.get(i);
                    if (!refs) continue;
                    if (isInterludeLine(lines[i])) {
                        if (refs.row) stepInterlude(refs.row, lineTimes[i].start, lineTimes[i].end, posSec, dt, now, !lyricsAnimation);
                        continue;
                    }
                    if (isPlainLine(lines[i])) {
                        const el = lineElOf(refs);
                        if (el && isSpicy) {
                            const { start, end } = lineTimes[i];
                            const progress = end > start ? Math.min(Math.max((posSec - start) / (end - start), 0), 1) : 0;
                            stepLine(el, state, progress, dt, false);
                        }
                        continue;
                    }
                    forEachWord(lines[i], refs, (el, w) => stepWordFull(el, w, posSec, dt, lyricsAnimation));
                }
            }

            const activeIndex = states.indexOf("a");
            if (activeIndex !== -1 && (activeIndex !== blurIndex || states !== prevStates)) {
                blurIndex = activeIndex;
                applyBlur(lines, registry, states, activeIndex);
            }

            prevStates = states;
            prevPos = posSec;

            if (isPlaying) rafId = requestAnimationFrame(frame);
        };

        rafId = requestAnimationFrame(frame);

        return () => {
            if (rafId !== undefined) cancelAnimationFrame(rafId);
        };
    }, [lines, lineTimes, registry, isPlaying, lyricsAnimation, isSpicy, isPlaying ? 0 : pausedPosition]);
}
