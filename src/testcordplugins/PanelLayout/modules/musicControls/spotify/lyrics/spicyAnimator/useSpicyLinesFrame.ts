/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LineTimes } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/lineTiming";
import { LyricWord, SyncedLyric } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { React } from "@webpack/common";

import { getWordProgress, getWordState, resetWord, stepWord } from "./WordAnimator";

type WordRefs = { current: (HTMLSpanElement | null)[]; };

export interface LineWordRefs {
    lead: WordRefs;
    bg: WordRefs[];
}

export type LineRegistry = Map<number, LineWordRefs>;

export function getLineWordRefs(registry: LineRegistry, index: number): LineWordRefs {
    let refs = registry.get(index);
    if (!refs) {
        refs = { lead: { current: [] }, bg: [] };
        registry.set(index, refs);
    }
    return refs;
}

export function getBgRefs(refs: LineWordRefs, bgIndex: number): WordRefs {
    return (refs.bg[bgIndex] ??= { current: [] });
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

function resetAll(lines: SyncedLyric[], registry: LineRegistry, posSec: number) {
    for (let i = 0; i < lines.length; i++) {
        const refs = registry.get(i);
        if (!refs) continue;
        forEachWord(lines[i], refs, (el, w) =>
            resetWord(el, getWordState(posSec, w.startTime, w.endTime), getWordProgress(posSec, w.startTime, w.endTime))
        );
    }
}

export function useSpicyLinesFrame({ lines, lineTimes, registry, statesRef, positionRef, isPlaying, pausedPosition }: {
    lines: SyncedLyric[] | null | undefined;
    lineTimes: LineTimes[] | null;
    registry: LineRegistry;
    statesRef: { current: string; };
    positionRef: { current: number; };
    isPlaying: boolean;
    pausedPosition: number;
}) {
    React.useLayoutEffect(() => {
        if (!lines || !lineTimes) return;
        resetAll(lines, registry, positionRef.current / 1000);
    }, [lines, lineTimes, registry]);

    React.useEffect(() => {
        if (!lines || !lineTimes) return;

        let rafId: number | undefined;
        let lastFrameTime = performance.now();
        let prevStates = "";
        let prevPos = positionRef.current / 1000;
        let needsReset = true;
        const settleUntil = new Map<number, number>();

        const frame = (now: number) => {
            const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
            lastFrameTime = now;

            const posSec = positionRef.current / 1000;
            const states = statesRef.current;

            if (needsReset || Math.abs(posSec - prevPos) > JUMP_SEC) {
                needsReset = false;
                settleUntil.clear();
                resetAll(lines, registry, posSec);
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
                    forEachWord(lines[i], refs, (el, w) =>
                        stepWord(el, getWordState(posSec, w.startTime, w.endTime), getWordProgress(posSec, w.startTime, w.endTime), dt)
                    );
                }
            }

            prevStates = states;
            prevPos = posSec;

            if (isPlaying) rafId = requestAnimationFrame(frame);
        };

        rafId = requestAnimationFrame(frame);

        return () => {
            if (rafId !== undefined) cancelAnimationFrame(rafId);
        };
    }, [lines, lineTimes, registry, isPlaying, isPlaying ? 0 : pausedPosition]);
}
