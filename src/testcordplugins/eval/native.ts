/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dialog } from "electron";

import { createConsole, prepare, report } from "./shared";

export async function evalCode(_: Electron.IpcMainInvokeEvent, code: string) {
    const { response } = await dialog.showMessageBox({
        type: "warning",
        title: "Confirm code eval",
        message: "If you did not start this, press Cancel. The code below runs in the Node context of the desktop client, so it has full access to your computer.",
        detail: code,
        buttons: ["Run it", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true
    });

    if (response !== 0) return report(code, "Cancelled.", []);

    const { lines, fake } = createConsole();
    const script = prepare(code);

    // the names are passed in rather than read from module scope, because a function built
    // with new Function only sees globals. eval stays a direct eval, so the snippet can
    // still reach them the same way it would in a real console.
    const runner = new Function("require", "process", "Buffer", "console", "return eval(arguments[0]);");

    let result: unknown;
    try {
        result = await runner(require, process, Buffer, fake, script);
    } catch (error) {
        result = error;
    }

    return report(script, result, lines);
}
