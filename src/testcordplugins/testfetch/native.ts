/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { arch, cpus, totalmem } from "os";

export function getSystemInfo() {
    const memory = process.memoryUsage();
    return {
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        rss: memory.rss,
        systemTotal: totalmem(),
        cores: cpus().length,
        arch: arch()
    };
}
