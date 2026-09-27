/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { arch, homedir, hostname, platform, release, totalmem, type as osType, userInfo } from "os";

function gitBranch(cwd: string): Promise<string | null> {
    return new Promise(resolve => {
        execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 2000 }, (error, stdout) => {
            resolve(error || !stdout ? null : stdout.trim() || null);
        });
    });
}

export async function getUname(): Promise<string> {
    const branch = await gitBranch(homedir());

    const parts = [`${userInfo().username}@${hostname()}`];
    if (branch) parts.push(`(${branch})`);

    const gib = Math.round(totalmem() / 1024 ** 3);
    return `${parts.join(" ")} ${platform()} ${release()} ${arch()} ${osType()} ${gib}GB`;
}
