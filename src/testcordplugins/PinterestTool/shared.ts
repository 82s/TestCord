/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@utils/css";
import { OptionType, PluginNative } from "@utils/types";

export type SearchTarget = "IMAGE" | "ALL" | "AVATAR" | "BANNER";
export type SearchKind = Exclude<SearchTarget, "ALL">;
export type MediaFilter = "ALL" | "GIFS" | "STATIC";
// Kept as a union so favorites saved by versions with DeviantArt still load.
export type ResultSource = "PINTEREST" | "DEVIANTART";
export type AppearanceSetting = "AUTO" | "DARK" | "LIGHT";
export type ResolvedAppearance = "dark" | "light";

/** Optional per-search options forwarded to the native (Electron main process) side. */
export interface SearchExtras {
    pinterestCookie?: string;
}

export const PINTEREST_THEMES = [
    { label: "Pinterest", value: "pinterest", accent: "#e60023", accentHover: "#ff2446", soft: "rgba(230, 0, 35, .16)" },
    { label: "Blurple", value: "blurple", accent: "#5865f2", accentHover: "#7380ff", soft: "rgba(88, 101, 242, .18)" },
    { label: "Violet", value: "violet", accent: "#8b5cf6", accentHover: "#a179ff", soft: "rgba(139, 92, 246, .18)" },
    { label: "Cyan", value: "cyan", accent: "#0891b2", accentHover: "#06b6d4", soft: "rgba(8, 145, 178, .18)" },
    { label: "Emerald", value: "emerald", accent: "#059669", accentHover: "#10b981", soft: "rgba(5, 150, 105, .18)" }
] as const;

export type PinterestTheme = typeof PINTEREST_THEMES[number]["value"] | "custom";

export function resolvePinterestTheme(value: string | undefined): PinterestTheme {
    if (value === "custom") return value;
    return PINTEREST_THEMES.find(theme => theme.value === value)?.value ?? "pinterest";
}

function normalizeHexColor(value: string) {
    const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    return match ? `#${match[1].toLowerCase()}` : "#f59e0b";
}

function hexToRgb(hex: string) {
    const normalized = normalizeHexColor(hex).slice(1);
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function mixWithWhite(hex: string, amount = 0.18) {
    const { r, g, b } = hexToRgb(hex);
    const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function getContrastText(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    // YIQ gives a predictable UI contrast choice for very light custom colours.
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 165 ? "#111214" : "#ffffff";
}

export function getPinterestThemeStyle(theme: PinterestTheme, customAccent = "#f59e0b") {
    if (theme === "custom") {
        const accent = normalizeHexColor(customAccent);
        const { r, g, b } = hexToRgb(accent);

        return {
            "--pt-accent": accent,
            "--pt-accent-hover": mixWithWhite(accent),
            "--pt-accent-soft": `rgba(${r}, ${g}, ${b}, .18)`,
            "--pt-accent-contrast": getContrastText(accent)
        } as Record<string, string>;
    }

    const selected = PINTEREST_THEMES.find(option => option.value === theme) ?? PINTEREST_THEMES[0];
    return {
        "--pt-accent": selected.accent,
        "--pt-accent-hover": selected.accentHover,
        "--pt-accent-soft": selected.soft,
        "--pt-accent-contrast": getContrastText(selected.accent)
    } as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Light / dark appearance
// ---------------------------------------------------------------------------

interface AppearancePalette {
    bg: string;
    surface: string;
    raised: string;
    text: string;
    muted: string;
    border: string;
    popover: string;
    popoverText: string;
    input: string;
    hover: string;
}

const APPEARANCE_PALETTES: Record<ResolvedAppearance, AppearancePalette> = {
    dark: {
        bg: "#13191d",
        surface: "#1b2328",
        raised: "#263138",
        text: "#f1f5f4",
        muted: "#b5bac1",
        border: "rgba(255, 255, 255, .10)",
        popover: "#111214",
        popoverText: "#dbdee1",
        input: "#11181d",
        hover: "rgba(255, 255, 255, .07)"
    },
    light: {
        bg: "#f1f5f4",
        surface: "#ffffff",
        raised: "#e3e5e8",
        text: "#11181d",
        muted: "#4e5058",
        border: "rgba(0, 0, 0, .14)",
        popover: "#ffffff",
        popoverText: "#2e3338",
        input: "#e3e5e8",
        hover: "rgba(0, 0, 0, .07)"
    }
};

/** Relative luminance (0 = black, 1 = white) of a #rrggbb colour. */
export function getRelativeLuminance(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function getContrastRatio(a: string, b: string) {
    const la = getRelativeLuminance(a);
    const lb = getRelativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mixHex(from: string, to: string, amount: number) {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    const mix = (x: number, y: number) => Math.round(x + (y - x) * amount);
    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(mix(a.r, b.r))}${toHex(mix(a.g, b.g))}${toHex(mix(a.b, b.b))}`;
}

/** Text colour that stays black or white depending on which reads better on `background`. */
export function getReadableTextOn(background: string) {
    return getContrastRatio(background, "#ffffff") >= getContrastRatio(background, "#111214") ? "#ffffff" : "#111214";
}

/**
 * The accent is also used as *text* (icons, links). Nudge it toward black or white
 * until it reaches a readable contrast against the surface it sits on.
 */
export function ensureReadableAccent(accent: string, surface: string, minimumRatio = 4.5) {
    const start = normalizeHexColor(accent);
    if (getContrastRatio(start, surface) >= minimumRatio) return start;

    const target = getRelativeLuminance(surface) > 0.5 ? "#000000" : "#ffffff";
    for (let step = 1; step <= 20; step++) {
        const candidate = mixHex(start, target, step / 20);
        if (getContrastRatio(candidate, surface) >= minimumRatio) return candidate;
    }
    return target;
}

export function resolveAppearance(setting: AppearanceSetting, discordIsDark: boolean): ResolvedAppearance {
    if (setting === "DARK") return "dark";
    if (setting === "LIGHT") return "light";
    return discordIsDark ? "dark" : "light";
}

/**
 * CSS variables for one appearance. Besides the plugin's own --pt-* palette this also
 * overrides the Discord variables that Discord's components (search bar, modal chrome)
 * read, so everything inside the tool follows the same light/dark choice even when
 * the rest of Discord uses a different theme.
 */
export function getAppearanceStyle(mode: ResolvedAppearance, accent: string) {
    const p = APPEARANCE_PALETTES[mode];
    return {
        "--pt-bg": p.bg,
        "--pt-surface": p.surface,
        "--pt-raised": p.raised,
        "--pt-text": p.text,
        "--pt-muted": p.muted,
        "--pt-border": p.border,
        "--pt-popover": p.popover,
        "--pt-popover-text": p.popoverText,
        "--pt-input": p.input,
        "--pt-hover": p.hover,
        "--pt-accent-text": ensureReadableAccent(accent, p.surface),
        "--text-default": p.text,
        "--text-normal": p.text,
        "--text-strong": p.text,
        "--text-muted": p.muted,
        "--header-primary": p.text,
        "--header-secondary": p.muted,
        "--interactive-normal": p.muted,
        "--interactive-hover": p.text,
        "--input-background": p.input,
        "--background-base-lower": p.bg,
        "--background-base-low": p.surface,
        "--background-secondary": p.surface,
        "--background-tertiary": p.raised,
        "--background-mod-subtle": p.hover,
        "--background-modifier-hover": p.hover,
        "--border-subtle": p.border,
        colorScheme: mode
    } as Record<string, string>;
}

/**
 * "Auto" appearance: the window uses Discord's own colour variables, so it
 * matches the user's Discord theme (dark, light, midnight or a custom theme).
 * Older variable names and the plugin palette are fallbacks. Discord's own
 * variables are not overridden here, which would make them refer to themselves.
 */
function getDiscordAppearanceStyle(mode: ResolvedAppearance, accent: string) {
    const p = APPEARANCE_PALETTES[mode];
    const v = (names: string[], fallback: string) => names.reduceRight((inner, name) => `var(${name}, ${inner})`, fallback);
    return {
        "--pt-bg": v(["--background-base-lower", "--background-secondary"], p.bg),
        "--pt-surface": v(["--background-base-low", "--background-primary"], p.surface),
        "--pt-raised": v(["--background-surface-high", "--background-secondary-alt"], p.raised),
        "--pt-text": v(["--text-default", "--text-normal"], p.text),
        "--pt-muted": v(["--text-muted"], p.muted),
        "--pt-border": v(["--border-subtle", "--background-modifier-accent"], p.border),
        "--pt-popover": v(["--background-surface-highest", "--background-floating"], p.popover),
        "--pt-popover-text": v(["--text-default", "--text-normal"], p.popoverText),
        "--pt-input": v(["--input-background-default", "--input-background", "--background-tertiary"], p.input),
        "--pt-hover": v(["--background-mod-subtle", "--background-modifier-hover"], p.hover),
        "--pt-accent-text": ensureReadableAccent(accent, p.surface),
        colorScheme: mode
    } as Record<string, string>;
}

/** Accent theme + light/dark palette in one style object (later keys win: accent vars). */
export function getPinterestFullStyle(theme: PinterestTheme, customAccent: string, mode: ResolvedAppearance, followDiscord = false) {
    const accentStyle = getPinterestThemeStyle(theme, customAccent);
    const accent = accentStyle["--pt-accent"];
    const base = followDiscord ? getDiscordAppearanceStyle(mode, accent) : getAppearanceStyle(mode, accent);
    return { ...base, ...accentStyle } as Record<string, string>;
}

export interface PinterestGuide {
    label: string;
    query: string;
}

export interface PinterestImageResult {
    id: string;
    title: string;
    description: string;
    url: string;
    width: number;
    height: number;
    dominantColor: string | null;
    pinterestUrl: string | null;
    isGif: boolean;
    /** Lightweight preview used by the grid (full-size `url` is used when applying). */
    thumbUrl?: string;
    /** Original URL to fall back to if a de-blurred URL is refused. */
    fallbackUrl?: string;
    source?: ResultSource;
    author?: string;
    authorUrl?: string | null;
}

export interface PinterestSearchPayload {
    query: string;
    guides: PinterestGuide[];
    results: PinterestImageResult[];
    bookmark: string[] | null;
    /** Non-fatal message, e.g. one of the two sources did not answer. */
    notice?: string;
    failedSources?: ResultSource[];
}

export interface NativeMediaResult {
    data: ArrayBuffer;
    dataUrl: string;
    type: string;
    filename: string;
}

export interface SearchBucketState {
    data: PinterestSearchPayload | null;
    activeQuery: string;
    bookmark: string[] | null;
    page: number;
    loadingNextPage: boolean;
    error: string;
}

export const cl = classNameFactory("vc-pinterest-tool-");

export const settings = definePluginSettings({
    colorTheme: {
        type: OptionType.SELECT,
        description: "Color theme used by Pinterest Tool",
        options: [
            ...PINTEREST_THEMES.map(theme => ({
                label: theme.label,
                value: theme.value,
                default: theme.value === "pinterest"
            })),
            {
                label: "Custom",
                value: "custom"
            }
        ]
    },
    customAccent: {
        type: OptionType.STRING,
        description: "Custom Pinterest Tool accent color (hex)",
        default: "#f59e0b",
        placeholder: "#f59e0b"
    },
    appearance: {
        type: OptionType.SELECT,
        description: "Light or dark look for the Pinterest Tool window. Auto follows Discord's own theme and keeps text readable on either.",
        options: [
            { label: "Auto (follow Discord)", value: "AUTO", default: true },
            { label: "Dark", value: "DARK" },
            { label: "Light", value: "LIGHT" }
        ]
    },
    randomizeSearch: {
        type: OptionType.BOOLEAN,
        description: "Add a random style keyword to manual Pinterest searches (less precise, more variety)",
        default: false
    },
    effectsStep: {
        type: OptionType.BOOLEAN,
        description: "Show the Effects & filters step (colors, presets, tint) before Discord's image editor. Not used for animated GIFs, which would lose their animation.",
        default: true
    },
    editBeforeApply: {
        type: OptionType.BOOLEAN,
        description: "Open Discord's image editor before applying a Pinterest avatar or banner",
        default: true
    }
});

export const Native = VencordNative.pluginHelpers["Pinterest Tool"] as PluginNative<typeof import("./native")>;
