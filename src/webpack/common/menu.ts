/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import type * as t from "@vencord/discord-types";
import { filters, mapMangledModuleLazy } from "@webpack";

import { waitForComponent } from "./internal";

export const Menu = {} as t.Menu;

// Placeholders for menu items so they are never undefined before Discord's item module loads
const createPlaceholder = (name: string) => {
    const fn = (props: any) => null;
    Object.defineProperty(fn, "name", { value: name });
    return fn;
};

for (const name of [
    "MenuItem",
    "MenuCheckboxItem",
    "MenuRadioItem",
    "MenuSeparator",
    "MenuGroup",
    "MenuControlItem"
] as const) {
    (Menu as any)[name] ??= createPlaceholder(name);
}

Menu.Menu = waitForComponent<t.Menu["Menu"]>("Menu", filters.componentByCode('path:["empty"]'));
Menu.MenuSliderControl = waitForComponent<t.Menu["MenuSliderControl"]>("MenuSliderControl", filters.componentByCode("SLIDER)", "handleSize:16"));
Menu.MenuSearchControl = waitForComponent<t.Menu["MenuSearchControl"]>("MenuSearchControl", filters.componentByCode(".SEARCH)", ".focus()", "query:"));

export const ContextMenuApi: t.ContextMenuApi = mapMangledModuleLazy('type:"CONTEXT_MENU_OPEN', {
    closeContextMenu: filters.byCode("CONTEXT_MENU_CLOSE"),
    openContextMenu: filters.byCode("renderLazy:"),
    openContextMenuLazy: e => typeof e === "function" && e.toString().length < 100
});
