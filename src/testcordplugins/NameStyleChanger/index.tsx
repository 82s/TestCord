/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import showMeYourName from "@plugins/showMeYourName";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, GuildMemberStore, React, UserStore } from "@webpack/common";

const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Cherry+Bomb+One&family=Chicle&family=MedievalSharp&family=MuseoModerno:wght@400;600;700&family=Nosifer&family=Pixelify+Sans:wght@400;600;700&family=Zilla+Slab:wght@400;600;700&display=swap";

const fontOptions = [
    { label: "gg sans (Default)", value: "gg-sans", default: true },
    { label: "Tempo", value: "tempo" },
    { label: "Sakura", value: "sakura" },
    { label: "Jellybean", value: "jellybean" },
    { label: "Modern", value: "modern" },
    { label: "Medieval", value: "medieval" },
    { label: "8Bit", value: "8bit" },
    { label: "Vampyre", value: "vampyre" }
];

const fontMap: Record<string, string> = {
    "gg-sans": "var(--font-primary), 'GG Sans', sans-serif",
    "tempo": "'Zilla Slab', serif",
    "sakura": "'Cherry Bomb One', cursive",
    "jellybean": "'Chicle', cursive",
    "modern": "'MuseoModerno', sans-serif",
    "medieval": "'Neo Castel', 'MedievalSharp', serif",
    "8bit": "'Pixelify Sans', monospace",
    "vampyre": "'Sinistre', 'Nosifer', cursive"
};

const DisplayNameFonts: any = findByPropsLazy("DEFAULT", "CHERRY_BOMB", "CHICLE", "MUSEO_MODERNO");

function getFontId(fontKey: string): number {
    try {
        if (DisplayNameFonts) {
            switch (fontKey) {
                case "tempo":
                    return DisplayNameFonts.ZILLA_SLAB ?? 1;
                case "sakura":
                    return DisplayNameFonts.CHERRY_BOMB ?? 2;
                case "jellybean":
                    return DisplayNameFonts.CHICLE ?? DisplayNameFonts.MONKEY_BARS ?? 3;
                case "modern":
                    return DisplayNameFonts.MUSEO_MODERNO ?? 4;
                case "medieval":
                    return DisplayNameFonts.NEO_CASTEL ?? 5;
                case "8bit":
                    return DisplayNameFonts.MAINFRAME ?? 6;
                case "vampyre":
                    return DisplayNameFonts.HEADBANG ?? DisplayNameFonts.SINISTRE ?? 7;
                case "gg-sans":
                default:
                    return DisplayNameFonts.DEFAULT ?? 0;
            }
        }
    } catch { }
    return 0;
}

let originalGetUser: typeof UserStore.getUser | null = null;
let originalGetCurrentUser: typeof UserStore.getCurrentUser | null = null;
let originalGetMember: typeof GuildMemberStore.getMember | null = null;

let originalSmynGetMessageNameElement: typeof showMeYourName.getMessageNameElement | null = null;
let originalSmynGetTypingMemberListElement: typeof showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement | null = null;
let originalSmynGetMentionElement: typeof showMeYourName.getMentionNameElement | null = null;
let originalSmynGetActiveNowElement: typeof showMeYourName.getActiveNowNameElement | null = null;

let fontLink: HTMLLinkElement | null = null;

function loadFonts() {
    if (document.getElementById("testcord-name-style-fonts")) return;
    fontLink = document.createElement("link");
    fontLink.id = "testcord-name-style-fonts";
    fontLink.rel = "stylesheet";
    fontLink.href = GOOGLE_FONTS_URL;
    document.head.appendChild(fontLink);
}

function unloadFonts() {
    const el = document.getElementById("testcord-name-style-fonts");
    if (el) el.remove();
    fontLink = null;
}

function applyDisplayNameStylesToUser(target: any, selectedFont?: string) {
    if (!target) return;
    const font = selectedFont ?? settings.store.font;

    if (!font || font === "gg-sans") {
        if (target._nsOriginalDisplayNameStyles !== undefined) {
            target.displayNameStyles = target._nsOriginalDisplayNameStyles;
            delete target._nsOriginalDisplayNameStyles;
        }
        return;
    }

    if (target._nsOriginalDisplayNameStyles === undefined) {
        target._nsOriginalDisplayNameStyles = target.displayNameStyles ?? null;
    }

    const fontId = getFontId(font);
    const existing = target._nsOriginalDisplayNameStyles;

    target.displayNameStyles = {
        ...(existing ?? {}),
        fontId,
        font_id: fontId,
        effectId: existing?.effectId ?? existing?.effect_id ?? 0,
        effect_id: existing?.effect_id ?? existing?.effectId ?? 0,
        colors: Array.isArray(existing?.colors) ? existing.colors : []
    };
}

function restoreDisplayNameStylesOnUser(target: any) {
    if (!target) return;
    if (target._nsOriginalDisplayNameStyles !== undefined) {
        target.displayNameStyles = target._nsOriginalDisplayNameStyles;
        delete target._nsOriginalDisplayNameStyles;
    }
}

function notifyUpdate() {
    const me = UserStore.getCurrentUser();
    if (me) {
        applyDisplayNameStylesToUser(me);
        try {
            FluxDispatcher.dispatch({ type: "USER_UPDATE", user: me });
        } catch { }
    }
    try {
        UserStore.emitChange();
        GuildMemberStore?.emitChange?.();
    } catch { }
}

const settings = definePluginSettings({
    font: {
        type: OptionType.SELECT,
        description: "Font style for your username and display name",
        options: fontOptions,
        onChange: () => {
            notifyUpdate();
        }
    }
});

export default definePlugin({
    name: "NameStyleChanger",
    description: "Change the font style of your own username and display name across Discord.",
    tags: ["Customisation", "Appearance"],
    authors: [TestcordDevs.x2b, TestcordDevs.sirphantom89],
    settings,

    start() {
        loadFonts();

        originalGetUser = UserStore.getUser;
        originalGetCurrentUser = UserStore.getCurrentUser;

        UserStore.getUser = function (userId: string) {
            const user = originalGetUser!.apply(this, arguments as any);
            if (!user) return user;
            const currentUserId = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore)?.id : UserStore.getCurrentUser()?.id;
            if (user.id === currentUserId) {
                applyDisplayNameStylesToUser(user);
            }
            return user;
        };

        UserStore.getCurrentUser = function () {
            const user = originalGetCurrentUser!.apply(this, arguments as any);
            if (user) {
                applyDisplayNameStylesToUser(user);
            }
            return user;
        };

        if (GuildMemberStore?.getMember) {
            originalGetMember = GuildMemberStore.getMember;
            GuildMemberStore.getMember = function (guildId: string, userId: string) {
                const member = originalGetMember!.apply(this, arguments as any);
                if (!member) return member;
                const currentUserId = UserStore.getCurrentUser()?.id;
                if (userId === currentUserId) {
                    applyDisplayNameStylesToUser(member);
                }
                return member;
            };
        }

        if (showMeYourName) {
            if (showMeYourName.getMessageNameElement) {
                originalSmynGetMessageNameElement = showMeYourName.getMessageNameElement;
                showMeYourName.getMessageNameElement = (props: any) => {
                    const el = originalSmynGetMessageNameElement!(props);
                    return this.wrapChildren(el, props);
                };
            }
            if (showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement) {
                originalSmynGetTypingMemberListElement = showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement;
                showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement = (props: any) => {
                    const el = originalSmynGetTypingMemberListElement!(props);
                    return this.wrapChildren(el, props);
                };
            }
            if (showMeYourName.getMentionNameElement) {
                originalSmynGetMentionElement = showMeYourName.getMentionNameElement;
                showMeYourName.getMentionNameElement = (props: any) => {
                    const el = originalSmynGetMentionElement!(props);
                    return this.wrapChildren(el, { author: { id: props?.userId } });
                };
            }
            if (showMeYourName.getActiveNowNameElement) {
                originalSmynGetActiveNowElement = showMeYourName.getActiveNowNameElement;
                showMeYourName.getActiveNowNameElement = (props: any) => {
                    const el = originalSmynGetActiveNowElement!(props);
                    return this.wrapChildren(el, props);
                };
            }
        }

        notifyUpdate();
    },

    stop() {
        unloadFonts();

        if (originalGetUser) UserStore.getUser = originalGetUser;
        if (originalGetCurrentUser) UserStore.getCurrentUser = originalGetCurrentUser;
        if (originalGetMember && GuildMemberStore) GuildMemberStore.getMember = originalGetMember;

        originalGetUser = null;
        originalGetCurrentUser = null;
        originalGetMember = null;

        if (showMeYourName) {
            if (originalSmynGetMessageNameElement) {
                showMeYourName.getMessageNameElement = originalSmynGetMessageNameElement;
                originalSmynGetMessageNameElement = null;
            }
            if (originalSmynGetTypingMemberListElement) {
                showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement = originalSmynGetTypingMemberListElement;
                originalSmynGetTypingMemberListElement = null;
            }
            if (originalSmynGetMentionElement) {
                showMeYourName.getMentionNameElement = originalSmynGetMentionElement;
                originalSmynGetMentionElement = null;
            }
            if (originalSmynGetActiveNowElement) {
                showMeYourName.getActiveNowNameElement = originalSmynGetActiveNowElement;
                originalSmynGetActiveNowElement = null;
            }
        }

        const me = UserStore.getCurrentUser();
        if (me) restoreDisplayNameStylesOnUser(me);

        try {
            UserStore.emitChange();
            GuildMemberStore?.emitChange?.();
        } catch { }
    },

    patches: [
        {
            find: '="SYSTEM_TAG"',
            replacement: {
                match: /(onClick:\i,onContextMenu:\i,children:)(.{1,400}?)(?=,"data-text":)/,
                replace: "$1$self.wrapChildren($2,arguments[0])"
            }
        }
    ],

    wrapChildren(children: any, context: any) {
        if (!children) return children;
        const authorId = context?.message?.author?.id ?? context?.author?.id ?? context?.user?.id;
        const currentUserId = UserStore.getCurrentUser()?.id;

        if (!authorId || authorId !== currentUserId) return children;

        const font = settings.store.font || "gg-sans";
        if (font === "gg-sans") return children;

        const fontFamily = fontMap[font];
        if (!fontFamily) return children;

        if (React.isValidElement(children) && (children.props as any)?.["data-namestyle"]) {
            return children;
        }

        return (
            <span style={{ fontFamily }} data-namestyle="true">
                {children}
            </span>
        );
    }
});
