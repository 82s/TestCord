/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface AnimationPoint {
    Time: number;
    Value: number;
}

export class Spline {
    private xs: number[];
    private ys: number[];
    private ks: number[];

    constructor(points: AnimationPoint[]) {
        if (points.length < 2) throw new Error("Need at least 2 points for interpolation");
        const sorted = [...points].sort((a, b) => a.Time - b.Time);
        this.xs = sorted.map(p => p.Time);
        this.ys = sorted.map(p => p.Value);
        this.ks = Spline.naturalCoefficients(this.xs, this.ys);
    }

    private static naturalCoefficients(xs: number[], ys: number[]): number[] {
        const n = xs.length;
        const ks = new Array<number>(n).fill(0);

        if (n === 2) {
            const slope = (ys[1] - ys[0]) / (xs[1] - xs[0]);
            ks[0] = slope;
            ks[1] = slope;
            return ks;
        }

        const a = new Array<number>(n).fill(0);
        const b = new Array<number>(n).fill(0);
        const c = new Array<number>(n).fill(0);
        const d = new Array<number>(n).fill(0);

        b[0] = 2 / (xs[1] - xs[0]);
        c[0] = 1 / (xs[1] - xs[0]);
        d[0] = 3 * (ys[1] - ys[0]) / ((xs[1] - xs[0]) * (xs[1] - xs[0]));

        for (let i = 1; i < n - 1; i++) {
            const dx0 = xs[i] - xs[i - 1];
            const dx1 = xs[i + 1] - xs[i];
            a[i] = 1 / dx0;
            b[i] = 2 * (1 / dx0 + 1 / dx1);
            c[i] = 1 / dx1;
            d[i] = 3 * ((ys[i] - ys[i - 1]) / (dx0 * dx0) + (ys[i + 1] - ys[i]) / (dx1 * dx1));
        }

        const last = n - 1;
        const dxLast = xs[last] - xs[last - 1];
        a[last] = 1 / dxLast;
        b[last] = 2 / dxLast;
        c[last] = 0;
        d[last] = 3 * (ys[last] - ys[last - 1]) / (dxLast * dxLast);

        for (let i = 1; i < n; i++) {
            const m = a[i] / b[i - 1];
            b[i] -= m * c[i - 1];
            d[i] -= m * d[i - 1];
        }

        ks[last] = d[last] / b[last];
        for (let i = n - 2; i >= 0; i--) {
            ks[i] = (d[i] - c[i] * ks[i + 1]) / b[i];
        }

        return ks;
    }

    at(x: number): number {
        const { xs, ys, ks } = this;
        const t = Math.min(Math.max(x, xs[0]), xs[xs.length - 1]);

        let i = 1;
        while (i < xs.length - 1 && xs[i] < t) i++;
        const seg = i - 1;

        const dx = xs[seg + 1] - xs[seg];
        if (dx === 0) return ys[seg];

        const localT = (t - xs[seg]) / dx;
        const a = ks[seg] * dx - (ys[seg + 1] - ys[seg]);
        const b = -ks[seg + 1] * dx + (ys[seg + 1] - ys[seg]);

        return (1 - localT) * ys[seg] + localT * ys[seg + 1]
            + localT * (1 - localT) * (a * (1 - localT) + b * localT);
    }
}
