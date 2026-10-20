/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SyncedLyric } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";

export interface LineTimes {
    start: number;
    end: number;
}

const NO_END_FALLBACK_SEC = 5;
const PIN_LOOKAHEAD = 2;

function getLineEndTime(line: SyncedLyric): number {
    let end = line.words?.length ? line.words[line.words.length - 1].endTime : line.time;
    for (const bg of line.background ?? []) end = Math.max(end, bg.endTime);
    return end;
}

export function computeLineTimes(lines: SyncedLyric[]): LineTimes[] {
    return lines.map((line, i) => {
        const next = lines[i + 1];
        const hasWordTiming = line.text !== null && (!!line.words?.length || !!line.background?.length);
        const end = hasWordTiming
            ? getLineEndTime(line)
            : (next ? next.time : line.time + NO_END_FALLBACK_SEC);

        return { start: line.time, end: Math.max(end, line.time) };
    });
}

export function computeLineStates(times: LineTimes[], posSec: number): string {
    let out = "";
    for (let i = 0; i < times.length; i++) {
        const t = times[i];
        out += posSec < t.start ? "n" : posSec >= t.end ? "s" : "a";
    }
    return out;
}

export function pickScrollIndex(states: string, times: LineTimes[]): number | null {
    if (!states.length) return null;

    const active: number[] = [];
    let sung = 0;
    let notSung = 0;
    for (let i = 0; i < states.length; i++) {
        const c = states[i];
        if (c === "a") active.push(i);
        else if (c === "s") sung++;
        else notSung++;
    }

    if (!active.length) {
        if (notSung === states.length) return 0;
        if (sung === states.length) return states.length - 1;
        return null;
    }

    const first = active[0];
    const lookahead = times[first + PIN_LOOKAHEAD];
    if (!lookahead || times[first].end <= lookahead.start) return first;

    const last = active[active.length - 1];
    return last - first <= 1 ? first : last;
}
