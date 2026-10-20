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

    constructor(range: AnimationPoint[]) {
        this.xs = range.map(p => p.Time);
        this.ys = range.map(p => p.Value);
        this.ks = this.solveKs();
    }

    private solveKs(): number[] {
        const { xs, ys } = this;
        const n = xs.length - 1;
        const A = Array.from({ length: n + 1 }, () => new Array<number>(n + 2).fill(0));

        for (let i = 1; i < n; i++) {
            const h0 = xs[i] - xs[i - 1];
            const h1 = xs[i + 1] - xs[i];
            A[i][i - 1] = 1 / h0;
            A[i][i] = 2 * (1 / h0 + 1 / h1);
            A[i][i + 1] = 1 / h1;
            A[i][n + 1] = 3 * ((ys[i] - ys[i - 1]) / (h0 * h0) + (ys[i + 1] - ys[i]) / (h1 * h1));
        }

        const h0 = xs[1] - xs[0];
        A[0][0] = 2 / h0;
        A[0][1] = 1 / h0;
        A[0][n + 1] = (3 * (ys[1] - ys[0])) / (h0 * h0);

        const hn = xs[n] - xs[n - 1];
        A[n][n - 1] = 1 / hn;
        A[n][n] = 2 / hn;
        A[n][n + 1] = (3 * (ys[n] - ys[n - 1])) / (hn * hn);

        const m = n + 1;
        for (let col = 0; col < m; col++) {
            let pivot = col;
            for (let r = col + 1; r < m; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
            [A[col], A[pivot]] = [A[pivot], A[col]];
            for (let r = col + 1; r < m; r++) {
                const f = A[r][col] / A[col][col];
                for (let c = col; c <= m; c++) A[r][c] -= f * A[col][c];
            }
        }
        const ks = new Array<number>(m).fill(0);
        for (let r = m - 1; r >= 0; r--) {
            let sum = A[r][m];
            for (let c = r + 1; c < m; c++) sum -= A[r][c] * ks[c];
            ks[r] = sum / A[r][r];
        }
        return ks;
    }

    at(x: number): number {
        const { xs, ys, ks } = this;
        let i = 1;
        while (i < xs.length - 1 && xs[i] < x) i++;
        const h = xs[i] - xs[i - 1];
        const t = (x - xs[i - 1]) / h;
        const a = ks[i - 1] * h - (ys[i] - ys[i - 1]);
        const b = -ks[i] * h + (ys[i] - ys[i - 1]);
        return (1 - t) * ys[i - 1] + t * ys[i] + t * (1 - t) * ((1 - t) * a + t * b);
    }
}
