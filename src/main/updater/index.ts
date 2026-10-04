/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcEvents } from "@shared/IpcEvents";
import { ipcMain } from "electron";

import gitRemote from "~git-remote";

import { serializeErrors } from "./common";

if (!IS_UPDATER_DISABLED) {
    require(IS_STANDALONE ? "./http" : "./git");
} else {
    ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
    ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(() => ({ changes: [], diverged: false })));
    ipcMain.handle(IpcEvents.UPDATE, serializeErrors(() => "upToDate" as const));
    ipcMain.handle(IpcEvents.FORCE_UPDATE, serializeErrors(() => "upToDate" as const));
    ipcMain.handle(IpcEvents.BUILD, serializeErrors(() => false));
}
