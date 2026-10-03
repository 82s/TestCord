/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * Pinterest Tool modifications Copyright (c) 2026 szcx404
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { copyWithToast, openImageModal } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { Logger } from "@utils/Logger";
import { classes } from "@utils/misc";
import { saveFile } from "@utils/web";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, showToast, Toasts, useEffect, useLayoutEffect, useMemo, useRef, useState } from "@webpack/common";

// @webpack/common's "ReactDOM" export is not guaranteed to exist across
// Vencord/Equicord/Testcord versions (it was removed in some recent builds
// in favor of individual named exports like createRoot). Looking up the
// react-dom module directly by its own exported props is more resilient
// than depending on @webpack/common re-exporting it as "ReactDOM".
const ReactDOMPortal = findByPropsLazy("createPortal");
import { Dispatch, PointerEvent as ReactPointerEvent, ReactNode, SetStateAction } from "react";

import { drawScene, FONT_STACKS, FX_DEFAULT, FX_PRESETS, type FontKey, type Fx, hitTestLayers, type ImageCache, type ImageLayer, isPristine, type Layer, type TextLayer } from "./effects";
import { bytesToDataUrl, canDecodeAnimated, dataUrlToBytes, decodeGif, type DecodedGif, encodeFittedGif, fitUnderLimit, TARGET_BYTES } from "./gif";
import { PLUGIN_ICON } from "./icon";
import { direction, t, useLocale } from "./i18n";
import { imageKey, shapeDistance, visualKey } from "./searchRanking";
import { AppearanceSetting, cl, getPinterestFullStyle, Native, NativeMediaResult, PINTEREST_THEMES, PinterestImageResult, PinterestSearchPayload, PinterestTheme, resolveAppearance, resolvePinterestTheme, ResolvedAppearance, SearchBucketState, SearchKind, SearchTarget, settings } from "./shared";


const logger = new Logger("PinterestTool");

// Fixed page sizes keep the profile picker layout predictable across installs.
const AVATAR_RESULTS_PER_PAGE = 8;
const BANNER_RESULTS_PER_PAGE = 4;
const IMAGE_RESULTS_PER_PAGE = 8;

function createEmptyBucket(): SearchBucketState {
    return {
        data: null,
        activeQuery: "",
        bookmark: null,
        page: 0,
        loadingNextPage: false,
        error: ""
    };
}

type SearchMediaMode = "IMAGES" | "GIFS";
type SearchBuckets = Record<SearchKind, SearchBucketState>;

function createEmptyBuckets(): SearchBuckets {
    return {
        IMAGE: createEmptyBucket(),
        AVATAR: createEmptyBucket(),
        BANNER: createEmptyBucket()
    };
}

function getSearchKinds(target: SearchTarget): SearchKind[] {
    return target === "ALL" ? ["AVATAR", "BANNER"] : [target];
}

function getPrimaryKind(target: SearchTarget): SearchKind {
    if (target === "ALL") return "AVATAR";
    return target;
}

function getResultLabel(result: PinterestImageResult) {
    if (result.title.trim()) return result.title;

    try {
        const { pathname } = new URL(result.url);
        const filename = pathname.split("/").pop()?.trim();
        if (!filename) return t("image");
        return decodeURIComponent(filename);
    } catch {
        return t("image");
    }
}

// Errors thrown on the native side arrive wrapped by Electron's IPC.
function errorText(error: unknown) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return message.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "");
}

// ---------------------------------------------------------------------------
// Light / dark appearance
// ---------------------------------------------------------------------------

function detectDiscordIsDark(): boolean {
    try {
        const roots = [document.documentElement, document.body];
        for (const el of roots) {
            if (el?.classList.contains("theme-light")) return false;
            if (el?.classList.contains("theme-dark") || el?.classList.contains("theme-darker") || el?.classList.contains("theme-midnight")) return true;
        }

        // No theme class: measure the real luminance of Discord's base background.
        const raw = getComputedStyle(document.documentElement).getPropertyValue("--background-base-lower").trim();
        if (raw) {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d");
            if (ctx) {
                ctx.fillStyle = "#000";
                ctx.fillStyle = raw;
                ctx.fillRect(0, 0, 1, 1);
                const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
                return (r * 299 + g * 587 + b * 114) / 1000 < 140;
            }
        }
    } catch {
        // fall through to the OS preference
    }

    return window.matchMedia?.("(prefers-color-scheme: light)").matches === false;
}

/** Follows Discord's own theme live (Auto) or the user's forced Dark/Light choice. */
function useResolvedAppearance(setting: AppearanceSetting): ResolvedAppearance {
    const [discordIsDark, setDiscordIsDark] = useState(detectDiscordIsDark);

    useEffect(() => {
        const update = () => setDiscordIsDark(detectDiscordIsDark());
        const observer = new MutationObserver(update);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        const media = window.matchMedia?.("(prefers-color-scheme: light)");
        media?.addEventListener?.("change", update);
        return () => {
            observer.disconnect();
            media?.removeEventListener?.("change", update);
        };
    }, []);

    return resolveAppearance(setting, discordIsDark);
}

function AppearanceToggle({ setting, resolved }: { setting: AppearanceSetting; resolved: ResolvedAppearance; }) {
    const order: AppearanceSetting[] = ["AUTO", "DARK", "LIGHT"];
    const next = order[(order.indexOf(setting) + 1) % order.length];
    const icon = setting === "AUTO" ? "◐" : setting === "DARK" ? "☾" : "☀";
    const label = t(setting === "AUTO" ? "auto" : setting === "DARK" ? "dark" : "light");

    return (
        <button
            type="button"
            className={cl("appearance-toggle")}
            title={`${t("customize")}: ${label}`}
            aria-label={`${t("customize")}: ${label}`}
            onClick={() => { settings.store.appearance = next; }}
        >
            <span aria-hidden="true">{icon}</span>
            {label}
        </button>
    );
}

// Grid cards use the light preview when there is one. Animated GIFs must keep
// their animation, so those keep the full-size media.
function getCardImage(result: PinterestImageResult) {
    if (result.isGif) return result.url;
    return result.thumbUrl ?? result.url;
}

const RECENT_SEARCHES_KEY = "PinterestTool_recent_searches_v1";

function useRecentSearches() {
    const [recent, setRecent] = useState<string[]>([]);
    useEffect(() => {
        DataStore.get(RECENT_SEARCHES_KEY).then(value => {
            if (Array.isArray(value)) setRecent(value.filter((item): item is string => typeof item === "string").slice(0, 10));
        }).catch(() => { /* first run */ });
    }, []);

    function remember(query: string) {
        const clean = query.trim();
        if (!clean || clean.length > 80) return;
        setRecent(current => {
            const next = [clean, ...current.filter(item => item.toLowerCase() !== clean.toLowerCase())].slice(0, 10);
            void DataStore.set(RECENT_SEARCHES_KEY, next);
            return next;
        });
    }

    function clear() {
        setRecent([]);
        void DataStore.set(RECENT_SEARCHES_KEY, []);
    }

    return { recent, remember, clear };
}

function mergeUniqueResults(
    current: PinterestImageResult[],
    incoming: PinterestImageResult[]
): PinterestImageResult[] {
    // Ids are only unique inside one source, so key them with the source.
    const idKey = (result: PinterestImageResult) => `${result.source ?? "PINTEREST"}:${result.id}`;
    const fileKey = (result: PinterestImageResult) => imageKey(result.url);
    const looks = new Set(current.map(visualKey).filter(Boolean));
    const seenFiles = new Set(current.map(fileKey));
    const seenIds = new Set(current.map(idKey));
    const seenUrls = new Set(current.map(result => result.url));
    const merged = [...current];

    for (const result of incoming) {
        const look = visualKey(result);
        if (seenIds.has(idKey(result)) || seenUrls.has(result.url) || seenFiles.has(fileKey(result)) || (look && looks.has(look))) continue;
        if (look) looks.add(look);
        seenIds.add(idKey(result));
        seenFiles.add(fileKey(result));
        seenUrls.add(result.url);
        merged.push(result);
    }

    return merged;
}

interface PendingImageAsset {
    assetOrigin: "NEW_ASSET";
    imageUri: string;
    description: string;
}

interface PendingProfileActionPayload {
    pendingAvatar?: PendingImageAsset;
    pendingBanner?: PendingImageAsset;
}

function setPendingProfileChanges(payload: PendingProfileActionPayload, guildId?: string) {
    FluxDispatcher.dispatch({
        type: "USER_PROFILE_SETTINGS_SET_PENDING_CHANGES",
        ...(guildId ? { guildId } : {}),
        ...payload
    });
}

function getPendingImageAsset(image: string, description: string): PendingImageAsset {
    return {
        assetOrigin: "NEW_ASSET",
        imageUri: image,
        description
    };
}

function applyImageData(image: string, target: SearchKind, filename: string, guildId?: string) {
    // Discord's own profile settings store expects pendingBanner in the same
    // "new asset" descriptor shape it uses for pendingAvatar (assetOrigin +
    // imageUri + description), not a bare data URL string. Sending a raw
    // string previously meant the store had nothing to read a preview from,
    // so the banner appeared black and never actually applied.
    const asset = getPendingImageAsset(image, `pinterest-${filename || "image"}`);

    const payload: PendingProfileActionPayload = target === "BANNER"
        ? { pendingBanner: asset }
        : { pendingAvatar: asset };

    setPendingProfileChanges(payload, guildId);
}

// Pinterest does not keep a downloadable original for every pin, so try the
// original, then the stored fallback, then the 736 px and 474 px copies
// (favorites saved by older versions have no stored fallback).
async function fetchResultMedia(result: PinterestImageResult): Promise<NativeMediaResult> {
    const candidates = [result.url, result.fallbackUrl];
    if (/\/originals\//.test(result.url)) {
        candidates.push(result.url.replace("/originals/", "/736x/"), result.url.replace("/originals/", "/474x/"));
    }
    let lastError: unknown;
    for (const url of [...new Set(candidates.filter((value): value is string => Boolean(value)))]) {
        try {
            return await Native.fetchMedia(url) as NativeMediaResult;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError ?? new Error("Could not download this image.");
}

async function applyProfileResult(result: PinterestImageResult, target: SearchKind, guildId?: string, override?: { dataUrl: string; filename: string; }): Promise<boolean> {
    try {
        if (override) {
            applyImageData(override.dataUrl, target, override.filename, guildId);
            return true;
        }

        const media = await fetchResultMedia(result);

        // Do not redraw profile banners through canvas here. Some Pinterest media
        // formats/color profiles can turn into a black frame when re-encoded in
        // Discord's renderer. The native Discord editor already handles crop/zoom,
        // and the direct fallback should preserve the original fetched image data.
        applyImageData(media.dataUrl, target, media.filename, guildId);
        return true;
    } catch (error) {
        logger.error("Failed to apply Pinterest result", error);
        copyWithToast(result.url, t("copied"));
        showToast(t("applyFailed"), Toasts.Type.FAILURE);
        return false;
    }
}

async function saveResult(result: PinterestImageResult) {
    try {
        const media = await fetchResultMedia(result);
        saveFile(new File([media.data], media.filename, { type: media.type }));
    } catch (error) {
        logger.error("Failed to save Pinterest result", error);
        showToast(t("saveFailed"), Toasts.Type.FAILURE);
    }
}


const FAVORITES_STORAGE_KEYS: Record<Extract<SearchKind, "AVATAR" | "BANNER">, string> = {
    AVATAR: "PinterestTool_favorites_avatar_v2",
    BANNER: "PinterestTool_favorites_banner_v2"
};

interface PinterestFavorite extends PinterestImageResult {
    target: SearchKind;
    savedAt: number;
}

function sanitizeFavorites(
    rawValue: unknown,
    target: Extract<SearchKind, "AVATAR" | "BANNER">
): PinterestFavorite[] {
    if (!Array.isArray(rawValue)) return [];

    return rawValue
        .filter(item =>
            item
            && typeof item.id === "string"
            && typeof item.url === "string"
        )
        .map(item => ({
            ...(item as PinterestImageResult),
            target,
            savedAt: typeof (item as PinterestFavorite).savedAt === "number"
                ? (item as PinterestFavorite).savedAt
                : Date.now()
        }));
}

async function readFavoritesForTarget(
    target: Extract<SearchKind, "AVATAR" | "BANNER">
): Promise<PinterestFavorite[]> {
    try {
        const stored = await DataStore.get(FAVORITES_STORAGE_KEYS[target]);
        return sanitizeFavorites(stored, target);
    } catch (error) {
        logger.error(`Could not load Pinterest ${target.toLowerCase()} favorites`, error);
        return [];
    }
}

async function readFavorites(): Promise<PinterestFavorite[]> {
    const [avatars, banners] = await Promise.all([
        readFavoritesForTarget("AVATAR"),
        readFavoritesForTarget("BANNER")
    ]);

    return [...avatars, ...banners].sort((a, b) => b.savedAt - a.savedAt);
}

async function writeFavoritesForTarget(
    target: Extract<SearchKind, "AVATAR" | "BANNER">,
    favorites: PinterestFavorite[]
) {
    try {
        await DataStore.set(
            FAVORITES_STORAGE_KEYS[target],
            favorites.map(item => ({ ...item, target }))
        );
    } catch (error) {
        logger.error(`Could not save Pinterest ${target.toLowerCase()} favorites`, error);
        showToast(t("favoritesFailed"), Toasts.Type.FAILURE);
    }
}

// Pinterest pin ids and DeviantArt deviation ids are both numeric, so the
// source is part of the key; older favorites without one were Pinterest pins.
function favoriteKey(result: PinterestImageResult, target: SearchKind) {
    return `${target}:${result.source ?? "PINTEREST"}:${result.id}`;
}

// These were referenced in the pagination buttons below but never defined
// anywhere in this file, causing "ChevronLeftIcon is not defined" as soon as
// the avatar/banner picker rendered pagination controls.
function ChevronLeftIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ChevronRightIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function HeartIcon({ filled = false }: { filled?: boolean; }) {
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden="true">
            <path
                d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function PillButton({
    children,
    compact = false,
    onClick,
    disabled = false,
    type = "button"
}: {
    children: ReactNode;
    compact?: boolean;
    onClick?(): void;
    disabled?: boolean;
    type?: "button" | "submit";
}) {
    return (
        <button
            type={type}
            className={classes(cl("button"), compact && cl("button-compact"))}
            onClick={onClick}
            disabled={disabled}
        >
            {children}
        </button>
    );
}

function clamp(value: number, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
}

function parseHexColor(hex: string) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const normalized = match ? match[1] : "f59e0b";

    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function rgbToHex(r: number, g: number, b: number) {
    const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
    return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsv(r: number, g: number, b: number) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    return {
        h,
        s: max === 0 ? 0 : delta / max,
        v: max
    };
}

function hsvToHex(h: number, s: number, v: number) {
    const chroma = v * s;
    const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - chroma;

    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) [r, g, b] = [chroma, x, 0];
    else if (h < 120) [r, g, b] = [x, chroma, 0];
    else if (h < 180) [r, g, b] = [0, chroma, x];
    else if (h < 240) [r, g, b] = [0, x, chroma];
    else if (h < 300) [r, g, b] = [x, 0, chroma];
    else [r, g, b] = [chroma, 0, x];

    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function ThemePicker({
    theme,
    customAccent
}: {
    theme: PinterestTheme;
    customAccent: string;
}) {
    const pickerRef = useRef<HTMLDivElement>(null);
    const draggingSv = useRef(false);
    const initialHsv = useMemo(() => {
        const { r, g, b } = parseHexColor(customAccent);
        return rgbToHsv(r, g, b);
    }, [customAccent]);

    const [pickerOpen, setPickerOpen] = useState(false);
    const [hue, setHue] = useState(initialHsv.h);
    const [saturation, setSaturation] = useState(initialHsv.s);
    const [value, setValue] = useState(initialHsv.v);
    const [hexDraft, setHexDraft] = useState(customAccent.toUpperCase());

    useEffect(() => {
        const { r, g, b } = parseHexColor(customAccent);
        const hsv = rgbToHsv(r, g, b);
        setHue(hsv.h);
        setSaturation(hsv.s);
        setValue(hsv.v);
        setHexDraft(customAccent.toUpperCase());
    }, [customAccent]);

    useEffect(() => {
        if (!pickerOpen) return;

        function handleOutside(event: PointerEvent) {
            if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setPickerOpen(false);
        }

        document.addEventListener("pointerdown", handleOutside, true);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("pointerdown", handleOutside, true);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [pickerOpen]);

    function applyCustom(nextHue = hue, nextSaturation = saturation, nextValue = value) {
        const hex = hsvToHex(nextHue, nextSaturation, nextValue);
        settings.store.customAccent = hex;
        settings.store.colorTheme = "custom";
        setHexDraft(hex.toUpperCase());
    }

    function updateSv(event: ReactPointerEvent<HTMLDivElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        const nextSaturation = clamp((event.clientX - rect.left) / rect.width);
        const nextValue = clamp(1 - (event.clientY - rect.top) / rect.height);
        setSaturation(nextSaturation);
        setValue(nextValue);
        applyCustom(hue, nextSaturation, nextValue);
    }

    function commitHex() {
        if (/^#[0-9a-f]{6}$/i.test(hexDraft.trim())) {
            settings.store.customAccent = hexDraft.trim().toLowerCase();
            settings.store.colorTheme = "custom";
        } else {
            setHexDraft(customAccent.toUpperCase());
        }
    }

    async function pickColorFromScreen() {
        const EyeDropperCtor = (window as any).EyeDropper;

        if (!EyeDropperCtor) {
            showToast(t("colorFailed"), Toasts.Type.FAILURE);
            return;
        }

        try {
            const result = await new EyeDropperCtor().open();
            const hex = String(result?.sRGBHex || "").toLowerCase();

            if (!/^#[0-9a-f]{6}$/i.test(hex)) return;

            settings.store.customAccent = hex;
            settings.store.colorTheme = "custom";
            setHexDraft(hex.toUpperCase());

            const { r, g, b } = parseHexColor(hex);
            const hsv = rgbToHsv(r, g, b);
            setHue(hsv.h);
            setSaturation(hsv.s);
            setValue(hsv.v);
        } catch {
            // EyeDropper rejects when the user presses Escape/cancels.
        }
    }

    function copyCurrentHex() {
        copyWithToast(customAccent.toUpperCase(), t("colorCopied"));
    }

    const hueColor = hsvToHex(hue, 1, 1);
    const customContrast = (() => {
        const { r, g, b } = parseHexColor(customAccent);
        return (r * 299 + g * 587 + b * 114) / 1000 >= 165 ? "#111214" : "#ffffff";
    })();

    const presets = ["#1e293b", "#b9dceb", "#2f7d46", "#8b6a2f", "#7b3376"];

    return (
        <div ref={pickerRef} className={cl("theme-picker")} aria-label={t("theme")}>
            <span className={cl("theme-label")}>{t("theme")}</span>
            <div className={cl("theme-swatches")}>
                {PINTEREST_THEMES.map(option => (
                    <button
                        key={option.value}
                        type="button"
                        className={classes(cl("theme-swatch"), option.value === theme && cl("theme-swatch-active"))}
                        style={{ "--pt-swatch": option.accent } as any}
                        aria-label={`${option.label} theme`}
                        title={option.label}
                        onClick={() => {
                            settings.store.colorTheme = option.value;
                            setPickerOpen(false);
                        }}
                    />
                ))}

                <button
                    type="button"
                    className={classes(cl("theme-custom"), theme === "custom" && cl("theme-custom-active"))}
                    style={{
                        "--pt-custom-swatch": customAccent,
                        "--pt-custom-contrast": customContrast
                    } as any}
                    title={t("customColor")}
                    aria-label={t("customColor")}
                    aria-expanded={pickerOpen}
                    onClick={() => setPickerOpen(open => !open)}
                >
                    <span className={cl("theme-custom-icon")} aria-hidden="true">+</span>
                </button>
            </div>

            {pickerOpen ? (
                <div className={cl("color-popover")}>
                    <div
                        className={cl("color-sv")}
                        style={{ "--pt-picker-hue": hueColor } as any}
                        onPointerDown={event => {
                            draggingSv.current = true;
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            updateSv(event);
                        }}
                        onPointerMove={event => {
                            if (draggingSv.current) updateSv(event);
                        }}
                        onPointerUp={event => {
                            draggingSv.current = false;
                            event.currentTarget.releasePointerCapture?.(event.pointerId);
                        }}
                        onPointerCancel={() => {
                            draggingSv.current = false;
                        }}
                    >
                        <span
                            className={cl("color-sv-handle")}
                            style={{
                                left: `${saturation * 100}%`,
                                top: `${(1 - value) * 100}%`
                            }}
                        />
                    </div>

                    <input
                        className={cl("color-hue")}
                        type="range"
                        min={0}
                        max={359}
                        value={Math.round(hue)}
                        aria-label={t("hue")}
                        onChange={event => {
                            const nextHue = Number(event.currentTarget.value);
                            setHue(nextHue);
                            applyCustom(nextHue, saturation, value);
                        }}
                    />

                    <div className={cl("color-hex-row")}>
                        <div className={cl("color-hex-wrap")}>
                            <input
                                className={cl("color-hex-input")}
                                value={hexDraft}
                                maxLength={7}
                                spellCheck={false}
                                aria-label="HEX color"
                                onChange={event => setHexDraft(event.currentTarget.value)}
                                onBlur={commitHex}
                                onKeyDown={event => {
                                    if (event.key === "Enter") {
                                        // The picker lives inside the search <form>; Enter must not start a search.
                                        event.preventDefault();
                                        commitHex();
                                        event.currentTarget.blur();
                                    }
                                }}
                            />
                            <div className={cl("color-hex-actions")}>
                                <button
                                    type="button"
                                    className={cl("color-action-button")}
                                    title={t("copyHex")}
                                    aria-label={t("copyHex")}
                                    onClick={copyCurrentHex}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="M8 7V5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-2v3a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3h3Zm3 0h3a3 3 0 0 1 3 3v3h2V5h-8v2Zm3 3H5v9h9v-9Z" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    className={classes(cl("color-action-button"), cl("color-eyedropper"))}
                                    title={t("pickColor")}
                                    aria-label={t("pickColor")}
                                    onClick={() => void pickColorFromScreen()}
                                >
                                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                        <path d="m19.35 2.65 2 2a2.2 2.2 0 0 1 0 3.11l-3.12 3.12.71.71a1 1 0 0 1 0 1.41l-1.41 1.42a1 1 0 0 1-1.42 0l-.7-.71-7.08 7.08a4 4 0 0 1-2.83 1.17H3a1 1 0 0 1-1-1v-2.5a4 4 0 0 1 1.17-2.83l7.08-7.08-.71-.7a1 1 0 0 1 0-1.42l1.42-1.41a1 1 0 0 1 1.41 0l.71.71 3.12-3.12a2.2 2.2 0 0 1 3.11 0ZM11.66 10.1l-7.08 7.08A1.8 1.8 0 0 0 4 18.46V20h1.54c.48 0 .94-.19 1.28-.53l7.08-7.08-2.24-2.29Zm6.13-6.04-3.29 3.29 2.15 2.15 3.29-3.29a.2.2 0 0 0 0-.28l-1.87-1.87a.2.2 0 0 0-.28 0Z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className={cl("color-presets")}>
                        {presets.map(preset => (
                            <button
                                key={preset}
                                type="button"
                                className={cl("color-preset")}
                                style={{ "--pt-preset": preset } as any}
                                aria-label={`Use ${preset}`}
                                title={preset}
                                onClick={() => {
                                    settings.store.customAccent = preset;
                                    settings.store.colorTheme = "custom";
                                }}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

// Only mounted while a menu is open, so the theme observer below does not run
// once per result card.
function FloatingResultMenu({ result, menuRef, position, onClose }: {
    result: PinterestImageResult;
    menuRef: { current: HTMLDivElement | null; };
    position: { top: number; left: number; accent: string; };
    onClose(): void;
}) {
    const { appearance: appearanceSetting } = settings.use(["appearance"]);
    const appearance = useResolvedAppearance(appearanceSetting as AppearanceSetting);

    return ReactDOMPortal.createPortal(
        <div
            ref={menuRef}
            className={classes(cl("menu"), cl("menu-floating"))}
            role="menu"
            style={{
                // The menu is portaled to <body>, outside the themed root, so it
                // carries the full palette itself.
                ...getPinterestFullStyle("custom", position.accent, appearance, appearanceSetting === "AUTO"),
                top: position.top,
                left: position.left,
                "--pt-accent": position.accent
            } as any}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()}
        >
            <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                openImageModal({ url: result.url, original: result.url, width: result.width, height: result.height });
                onClose();
            }}>
                <span className={cl("menu-item-icon")} aria-hidden="true">⌕</span>
                <span>{t("preview")}</span>
            </button>

            <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                copyWithToast(result.url, t("copied"));
                onClose();
            }}>
                <span className={cl("menu-item-icon")} aria-hidden="true">⧉</span>
                <span>{t("copyLink")}</span>
            </button>

            <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                void saveResult(result);
                onClose();
            }}>
                <span className={cl("menu-item-icon")} aria-hidden="true">↓</span>
                <span>{t("saveImage")}</span>
            </button>

            {result.pinterestUrl ? (
                <>
                    <div className={cl("menu-separator")} />
                    <button type="button" role="menuitem" className={cl("menu-item")} onClick={() => {
                        VencordNative.native.openExternal(result.pinterestUrl!);
                        onClose();
                    }}>
                        <span className={cl("menu-item-icon")} aria-hidden="true">↗</span>
                        <span>{t("openSource", { source: "Pinterest" })}</span>
                    </button>
                </>
            ) : null}

            <div className={cl("menu-resolution")}>{result.width} × {result.height}</div>
        </div>,
        document.body
    );
}

function ResultMenu({
    result,
    open,
    onToggle,
    anchor
}: {
    result: PinterestImageResult;
    open: boolean;
    onToggle(): void;
    /** Mouse position when opened with a right-click; null opens under the ••• button. */
    anchor?: { x: number; y: number; } | null;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, accent: "#e60023" });

    function closeMenu() {
        if (open) onToggle();
    }

    function updateMenuPosition() {
        const button = buttonRef.current;
        if (!button) return;

        const rect = anchor
            ? { left: anchor.x, right: anchor.x + 164, top: anchor.y, bottom: anchor.y }
            : button.getBoundingClientRect();
        const menuWidth = 164;
        const estimatedMenuHeight = 190;
        const gap = 6;
        const margin = 8;

        let left = anchor ? anchor.x : rect.right - menuWidth;
        left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

        let top = rect.bottom + (anchor ? 2 : gap);
        if (top + estimatedMenuHeight > window.innerHeight - margin) {
            top = Math.max(margin, rect.top - estimatedMenuHeight - gap);
        }

        const accent = getComputedStyle(button).getPropertyValue("--pt-accent").trim() || "#e60023";
        setMenuPosition({ top, left, accent });
    }

    // Position before the browser paints, so the menu never flashes at its
    // previous spot (or the corner) and then jumps to the cursor.
    const openedAtRef = useRef(0);
    useLayoutEffect(() => {
        if (!open) return;
        openedAtRef.current = Date.now();
        updateMenuPosition();
    }, [open, anchor]);

    useEffect(() => {
        if (!open) return;

        function handlePointerDown(event: PointerEvent) {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
            // The press that opened the menu (a right-click) can still be in flight.
            if (Date.now() - openedAtRef.current < 300) return;
            closeMenu();
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") closeMenu();
        }

        function handleViewportChange() {
            updateMenuPosition();
        }

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    }, [open, anchor]);

    const floatingMenu = open
        ? <FloatingResultMenu result={result} menuRef={menuRef} position={menuPosition} onClose={closeMenu}/>
        : null;

    return (
        <div className={cl("menu-wrap")}>
            <button
                ref={buttonRef}
                type="button"
                className={cl("menu-button")}
                aria-label={t("options")}
                aria-expanded={open}
                onPointerDown={event => {
                    // Do not let the lower-row options button receive browser focus.
                    // Discord's modal can scroll/recenter focused descendants, which was
                    // the small "zoom backwards" seen on the second row.
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!open) updateMenuPosition();
                    onToggle();
                }}
            >
                <span className={cl("menu-button-dots")} aria-hidden="true">•••</span>
            </button>
            {floatingMenu}
        </div>
    );
}

type ResultSort = "relevance" | "quality" | "shape";

function SearchIcon() {
    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8"/><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>;
}

function ResultCard({ result, kind, favorite, menuId, setMenuId, onSelect, onFavorite, round = false }: {
    result: PinterestImageResult; kind: SearchKind; favorite: boolean; menuId: string;
    setMenuId: Dispatch<SetStateAction<string>>;
    onSelect(result: PinterestImageResult, kind: SearchKind): void;
    onFavorite(result: PinterestImageResult, kind: SearchKind): void;
    round?: boolean;
}) {
    const [loaded, setLoaded] = useState(false);
    const [broken, setBroken] = useState(false);
    const key = kind + ":" + (result.source ?? "PINTEREST") + ":" + result.id;
    const src = getCardImage(result);
    useEffect(() => { setLoaded(false); setBroken(false); }, [src]);
    const label = getResultLabel(result);
    const [anchor, setAnchor] = useState<{ x: number; y: number; } | null>(null);
    // Right-click opens the same options as the ••• button, at the cursor. A
    // native listener on the card stops the event here, so Discord's own
    // context-menu handlers further up never see it (they closed the menu).
    const cardRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const card = cardRef.current;
        if (!card) return;
        const onContextMenu = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            setAnchor({ x: event.clientX, y: event.clientY });
            setMenuId(key);
        };
        card.addEventListener("contextmenu", onContextMenu);
        return () => card.removeEventListener("contextmenu", onContextMenu);
    }, [key]);
    return (
        <div role="button" tabIndex={0} className={classes(cl("card"), round && kind === "AVATAR" && cl("card-round"))}
            aria-label={t("select") + ": " + label} onClick={() => onSelect(result, kind)}
            ref={cardRef}
            onKeyDown={event => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(result, kind); }
            }}>
            <div className={cl("card-top")}>
                <button type="button" className={classes(cl("favorite-button"), favorite && cl("favorite-button-active"))}
                    aria-label={t(favorite ? "removeFavorite" : "addFavorite")} title={t(favorite ? "removeFavorite" : "addFavorite")}
                    aria-pressed={favorite} onClick={event => { event.stopPropagation(); onFavorite(result, kind); }}><HeartIcon filled={favorite}/></button>
                <ResultMenu result={result} open={menuId === key} anchor={anchor}
                    onToggle={() => { setAnchor(null); setMenuId(current => current === key ? "" : key); }}/>
            </div>
            <div className={classes(cl("art"), kind === "BANNER" && cl("art-banner"), loaded && cl("art-loaded"))}>
                {!broken ? <img src={src} alt={label} loading="lazy" decoding="async" draggable={false}
                    onLoad={() => setLoaded(true)} onError={event => {
                        if (result.fallbackUrl && event.currentTarget.dataset.fallback !== "1") {
                            event.currentTarget.dataset.fallback = "1"; event.currentTarget.src = result.fallbackUrl;
                        } else { setBroken(true); setLoaded(true); }
                    }}/> : <span className={cl("preview-error")}>{t("previewUnavailable")}</span>}
                <div className={cl("card-info")}>
                    <div className={cl("card-info-title")} title={label}>{label}</div>
                    <div className={cl("card-info-meta")}>
                        <span>{result.width} × {result.height}</span>
                        {result.isGif ? <span>GIF</span> : Math.min(result.width, result.height) < 250 ? <span>{t("lowRes")}</span> : null}
                        {result.author ? <span>{t("by", { author: result.author })}</span> : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Columns, rows and card shape for one page. The stylesheet sizes the cards
// from these so a whole page always fits the space without scrolling.
function gridVars(kind: SearchKind) {
    return (kind === "BANNER"
        ? { "--cols": 2, "--rows": 2, "--ratio": 2.5 }
        : { "--cols": 4, "--rows": 2, "--ratio": 1 }) as any;
}

// Round page arrows centred on each side of the grid. The gutters are always
// reserved so the grid keeps the same width whether or not there are pages.
function SidePager({ enabled, canPrevious, canNext, loadingNext, onPrevious, onNext, children }: {
    enabled: boolean; canPrevious: boolean; canNext: boolean; loadingNext?: boolean;
    onPrevious(): void; onNext(): void; children: ReactNode;
}) {
    return <div className={cl("paged")}>
        {enabled ? <button type="button" className={classes(cl("page-arrow"), cl("page-arrow-prev"))} disabled={!canPrevious} aria-label={t("previous")} title={t("previous")}
            onPointerDown={event => event.preventDefault()} onClick={onPrevious}><ChevronLeftIcon/></button> : null}
        <div className={cl("paged-inner")}>{children}</div>
        {enabled ? <button type="button" className={classes(cl("page-arrow"), cl("page-arrow-next"))} disabled={!canNext} aria-label={t("next")} title={t("next")}
            onPointerDown={event => event.preventDefault()} onClick={onNext}>{loadingNext ? <span className={cl("page-arrow-spinner")}/> : <ChevronRightIcon/>}</button> : null}
    </div>;
}

function ResultsSection({ kind, bucket, menuId, gifsOnly, slotCount, setMenuId, setBuckets,
    onLoadNextPage, onPageChange, onSelectResult, isFavorite, onToggleFavorite, onRetry,
    loading, sort, round }: {
    kind: SearchKind; bucket: SearchBucketState; menuId: string; gifsOnly: boolean; slotCount: number;
    setMenuId: Dispatch<SetStateAction<string>>; setBuckets: Dispatch<SetStateAction<Record<SearchKind, SearchBucketState>>>;
    onLoadNextPage(kind: SearchKind, advance?: boolean): void; onPageChange(kind: SearchKind): void;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void;
    isFavorite(result: PinterestImageResult, kind: SearchKind): boolean;
    onToggleFavorite(result: PinterestImageResult, kind: SearchKind): void;
    onRetry(): void; loading: boolean; sort: ResultSort; round: boolean;
}) {
    const visible = useMemo(() => {
        const items = [...(bucket.data?.results ?? [])];
        if (sort === "quality") items.sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height));
        if (sort === "shape") items.sort((a, b) => shapeDistance(a, kind) - shapeDistance(b, kind));
        return items;
    }, [bucket.data, sort, kind]);
    const totalPages = Math.max(1, Math.ceil(visible.length / slotCount));
    const safePage = Math.min(bucket.page, totalPages - 1);
    const paged = visible.slice(safePage * slotCount, (safePage + 1) * slotCount);
    const prefetchedRef = useRef("");
    useEffect(() => {
        if (!bucket.data || loading || bucket.loadingNextPage || !bucket.bookmark?.length || visible.length > 240) return;
        if (safePage < totalPages - 2 || totalPages === 1) return;
        const key = JSON.stringify([bucket.activeQuery, bucket.bookmark]);
        if (prefetchedRef.current === key) return;
        const timer = window.setTimeout(() => { prefetchedRef.current = key; onLoadNextPage(kind, false); }, 400);
        return () => window.clearTimeout(timer);
    }, [bucket.activeQuery, bucket.bookmark, bucket.loadingNextPage, safePage, totalPages, loading]);
    const showPager = (!loading || paged.length > 0) && (totalPages > 1 || Boolean(bucket.bookmark?.length));
    const pageLabel = bucket.bookmark?.length ? t("page", { page: safePage + 1 }) : t("pageOf", { page: safePage + 1, total: totalPages });
    function previous() {
        onPageChange(kind);
        setBuckets(current => ({ ...current, [kind]: { ...current[kind], page: Math.max(0, safePage - 1) } }));
    }
    function next() {
        onPageChange(kind);
        if (safePage < totalPages - 1) setBuckets(current => ({ ...current, [kind]: { ...current[kind], page: safePage + 1 } }));
        else onLoadNextPage(kind);
    }
    return <section className={cl("section")} aria-busy={loading}>
        <div className={cl("section-header")}><div className={cl("section-heading")}><span className={cl("section-title")}>{t(kind === "BANNER" ? "bannerResults" : kind === "IMAGE" ? "imageResults" : "iconResults")}</span>
            <span className={cl("section-caption")}>{loading ? t("loading") : t("results", { count: visible.length })}</span>
            {showPager ? <span className={cl("page-label")} role="status" aria-live="polite">{bucket.loadingNextPage ? t("moreLoading") : pageLabel}</span> : null}</div>
</div>

        <SidePager enabled={showPager} canPrevious={safePage > 0} loadingNext={bucket.loadingNextPage && safePage >= totalPages - 1}
            canNext={!loading && (safePage < totalPages - 1 || (!bucket.loadingNextPage && Boolean(bucket.bookmark?.length)))}
            onPrevious={previous} onNext={next}>
        {loading && !visible.length ? <div className={classes(cl("grid"), kind === "BANNER" && cl("grid-banner"))} style={gridVars(kind)} aria-hidden="true">
            {Array.from({ length: slotCount }, (_, i) => <div key={i} className={classes(cl("skeleton"), kind === "BANNER" && cl("skeleton-banner"))}/>)}</div> : bucket.error ?
            <div className={cl("empty-state")} role="alert"><SearchIcon/><div className={cl("empty-state-title")}>{t("searchFailed")}</div><div className={cl("empty-state-copy")}>{t("errorHint")}</div>
                {bucket.error ? <div className={cl("empty-state-detail")}>{bucket.error}</div> : null}
                <button type="button" className={cl("empty-state-action")} onClick={onRetry}>{t("retry")}</button></div> : !paged.length ?
            <div className={cl("empty-state")}><SearchIcon/><div className={cl("empty-state-title")}>{t(gifsOnly ? "emptyGifs" : "empty")}</div>
                <div className={cl("empty-state-copy")}>{t(gifsOnly ? "gifCopy" : "emptyCopy")}</div></div> :
            <div className={classes(cl("grid"), kind === "BANNER" && cl("grid-banner"))} style={gridVars(kind)}>
                {paged.map(result => <ResultCard key={kind + ":" + result.source + ":" + result.id} result={result} kind={kind} favorite={isFavorite(result, kind)} menuId={menuId} setMenuId={setMenuId}
                    onSelect={onSelectResult} onFavorite={onToggleFavorite} round={round}/>)}</div>}
        </SidePager>
    </section>;
}

function FavoritesSection({ target, favorites, slotCount, page, setPage, menuId, setMenuId, onSelectResult, onToggleFavorite }: {
    target: SearchKind; favorites: PinterestFavorite[]; slotCount: number; page: number;
    setPage: Dispatch<SetStateAction<number>>; menuId: string; setMenuId: Dispatch<SetStateAction<string>>;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void; onToggleFavorite(result: PinterestImageResult, kind: SearchKind): void;
}) {
    // Saved images and GIFs are listed in separate sections.
    const [kindFilter, setKindFilter] = useState<"images" | "gifs">("images");
    const forTarget = favorites.filter(item => item.target === target);
    const gifCount = forTarget.filter(item => item.isGif).length;
    const visible = forTarget.filter(item => kindFilter === "gifs" ? item.isGif : !item.isGif);
    const total = Math.max(1, Math.ceil(visible.length / slotCount));
    const current = Math.min(page, total - 1);
    return <section className={classes(cl("section"), cl("section-favorites"))}><div className={cl("section-header")}><div className={cl("section-heading")}>
        <div className={cl("fav-tabs")} role="tablist" aria-label={t("favorites")}>
            {([["images", t("images"), forTarget.length - gifCount], ["gifs", "GIF", gifCount]] as const).map(([id, label, count]) =>
                <button key={id} type="button" role="tab" aria-selected={kindFilter === id} className={classes(cl("fav-tab"), kindFilter === id && cl("fav-tab-active"))}
                    onClick={() => { setKindFilter(id); setPage(0); }}>{label}<span className={cl("tab-count")}>{count}</span></button>)}
        </div>
        {total > 1 ? <span className={cl("page-label")}>{t("pageOf", { page: current + 1, total })}</span> : null}</div></div>
        <SidePager enabled={total > 1} canPrevious={current > 0} canNext={current < total - 1} onPrevious={() => setPage(current - 1)} onNext={() => setPage(current + 1)}>
        {!visible.length ? <div className={cl("favorites-empty")}><div className={cl("favorites-empty-heart")}><HeartIcon/></div><div className={cl("empty-state-title")}>{t("favoritesEmpty")}</div><div className={cl("empty-state-copy")}>{t("favoritesCopy")}</div></div> : <>
            <div className={classes(cl("grid"), target === "BANNER" && cl("grid-banner"))} style={gridVars(target)}>{visible.slice(current * slotCount, (current + 1) * slotCount).map(result =>
                <ResultCard key={"favorite:" + result.source + ":" + result.id} result={result} kind={target} favorite menuId={menuId} setMenuId={setMenuId} onSelect={onSelectResult} onFavorite={onToggleFavorite}/>)}</div>
        </>}
        </SidePager>
    </section>;
}

interface PinterestBrowserProps {
    query: string;
    setQuery(query: string): void;
    clearQuery(): void;
    onSelectResult(result: PinterestImageResult, kind: SearchKind): void;
    rootClassName: string;
    initialTarget: SearchTarget;
    initialDiscoveryQuery?: string;
}

function PinterestBrowser({
    query,
    setQuery,
    clearQuery,
    onSelectResult,
    rootClassName,
    initialTarget,
    initialDiscoveryQuery
}: PinterestBrowserProps) {
    const { colorTheme, customAccent, randomizeSearch, appearance } = settings.use(["colorTheme", "customAccent", "randomizeSearch", "appearance"]);
    const resolvedAppearance = useResolvedAppearance(appearance as AppearanceSetting);
    useLocale();
    const [sort, setSort] = useState<ResultSort>("relevance");
    const [roundPreview, setRoundPreview] = useState(false);
    const pagingRequests = useRef(new Set<string>());
    const recentSearches = useRecentSearches();

    const scrollRef = useRef<HTMLDivElement>(null);
    const browserRef = useRef<HTMLDivElement>(null);
    // Images and GIFs own independent request generations. Switching tabs must
    // never invalidate a request that is still finishing in the background.
    const requestGenerationRef = useRef<Record<SearchMediaMode, number>>({ IMAGES: 0, GIFS: 0 });
    // Fixed per window: the profile picker opens for either an avatar or a banner.
    const target = initialTarget;
    const [gifsOnly, setGifsOnly] = useState(false);
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [favorites, setFavorites] = useState<PinterestFavorite[]>([]);
    const [favoritesPage, setFavoritesPage] = useState(0);
    const [loadingByMode, setLoadingByMode] = useState<Record<SearchMediaMode, boolean>>({
        IMAGES: false,
        GIFS: false
    });
    const [manualSearchingByMode, setManualSearchingByMode] = useState<Record<SearchMediaMode, boolean>>({
        IMAGES: false,
        GIFS: false
    });
    // Track the exact query currently being searched in each tab. This lets the
    // user correct/extend the text and immediately submit a replacement search
    // without waiting for the previous request to finish.
    const [manualSearchQueryByMode, setManualSearchQueryByMode] = useState<Record<SearchMediaMode, string>>({
        IMAGES: "",
        GIFS: ""
    });
    const [menuId, setMenuId] = useState("");
    const [tabQueries, setTabQueries] = useState<Record<SearchMediaMode, string>>({
        IMAGES: query,
        GIFS: ""
    });
    const [tabLastSearchQueries, setTabLastSearchQueries] = useState<Record<SearchMediaMode, string>>({
        IMAGES: "",
        GIFS: ""
    });
    const [bucketsByMode, setBucketsByMode] = useState<Record<SearchMediaMode, SearchBuckets>>({
        IMAGES: createEmptyBuckets(),
        GIFS: createEmptyBuckets()
    });
    const scrollPositionsRef = useRef<Record<SearchMediaMode | "FAVORITES", number>>({
        IMAGES: 0,
        GIFS: 0,
        FAVORITES: 0
    });

    const activeMediaMode: SearchMediaMode = gifsOnly ? "GIFS" : "IMAGES";
    const buckets = bucketsByMode[activeMediaMode];
    const lastSearchQuery = tabLastSearchQueries[activeMediaMode];
    const manualSearching = manualSearchingByMode[activeMediaMode];
    const manualSearchQuery = manualSearchQueryByMode[activeMediaMode];
    const trimmedVisibleQuery = query.trim();
    const isSearchingVisibleQuery = manualSearching && trimmedVisibleQuery === manualSearchQuery;
    const isLoadingNextPage = Object.values(buckets).some(bucket => bucket.loadingNextPage);
    const isSameAsLastSearch = Boolean(lastSearchQuery) && trimmedVisibleQuery === lastSearchQuery.trim();
    // While Next is already fetching more of the same query, Enter/Search should not
    // accidentally start a brand-new randomized search. Editing the text still makes
    // Search available immediately, so typo corrections remain instant.
    const isPagingVisibleQuery = isLoadingNextPage && isSameAsLastSearch;

    // <details> stays open until its summary is clicked again; close the
    // appearance panel on an outside click or Escape like the other popovers.
    const personalizeRef = useRef<HTMLDetailsElement>(null);
    useEffect(() => {
        function close(event: Event) {
            const details = personalizeRef.current;
            if (!details?.open) return;
            if (event instanceof KeyboardEvent) {
                if (event.key !== "Escape") return;
                // Close only the panel, not the whole Pinterest Tool window.
                event.stopPropagation();
                details.open = false;
            } else if (!details.contains(event.target as Node)) details.open = false;
        }
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", close, true);
        return () => {
            document.removeEventListener("pointerdown", close, true);
            document.removeEventListener("keydown", close, true);
        };
    }, []);

    const [suggestOpen, setSuggestOpen] = useState(false);
    const typedLower = query.trim().toLowerCase();
    const matchingRecent = recentSearches.recent
        .filter(item => !typedLower || (item.toLowerCase().includes(typedLower) && item.toLowerCase() !== typedLower))
        .slice(0, 5);
    const relatedGuides = (getGuideSource()?.guides ?? []).slice(0, 8);
    const showSuggestions = suggestOpen && !favoritesOnly && (matchingRecent.length > 0 || relatedGuides.length > 0);

    function pickSuggestion(value: string) {
        setSuggestOpen(false);
        updateVisibleQuery(value);
        void runSearch(value, gifsOnly, true);
    }

    function focusSearchInput() {
        const input = browserRef.current?.querySelector<HTMLInputElement>(`.${cl("search-field")} input`);
        input?.focus({ preventScroll: true });
    }

    // Typing should work immediately after opening Pinterest Tool. Also restore
    // keyboard focus to the independent search field when switching Images/GIFs
    // or returning from Favorites, without changing either tab's saved query.
    useEffect(() => {
        if (favoritesOnly) return;

        const frame = window.requestAnimationFrame(focusSearchInput);
        return () => window.cancelAnimationFrame(frame);
    }, [activeMediaMode, favoritesOnly]);

    function setBucketsForMode(
        mode: SearchMediaMode,
        action: SetStateAction<SearchBuckets>
    ) {
        setBucketsByMode(current => {
            const currentBuckets = current[mode];
            const nextBuckets = typeof action === "function"
                ? (action as (value: SearchBuckets) => SearchBuckets)(currentBuckets)
                : action;

            return {
                ...current,
                [mode]: nextBuckets
            };
        });
    }

    const setActiveBuckets: Dispatch<SetStateAction<SearchBuckets>> = action => {
        setBucketsForMode(activeMediaMode, action);
    };

    function updateVisibleQuery(value: string) {
        setQuery(value);
        setTabQueries(current => ({
            ...current,
            [activeMediaMode]: value
        }));
    }

    function rememberCurrentScroll() {
        const view = favoritesOnly ? "FAVORITES" : activeMediaMode;
        scrollPositionsRef.current[view] = scrollRef.current?.scrollTop ?? 0;
    }

    function restoreScroll(view: SearchMediaMode | "FAVORITES") {
        window.requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollPositionsRef.current[view] ?? 0 });
        });
    }

    // Pinterest's own web client reads 25 pins per page. Smaller requests cost
    // the same round-trip and leave banner searches with too few wide images.
    function getResultsPerRequest() {
        return 25;
    }


    function currentFavoriteTarget(): SearchKind {
        return target === "ALL" ? "AVATAR" : target;
    }

    function isFavorite(result: PinterestImageResult, kind: SearchKind) {
        const key = favoriteKey(result, kind);
        return favorites.some(item => favoriteKey(item, item.target) === key);
    }

    function toggleFavorite(result: PinterestImageResult, kind: SearchKind) {
        if (kind !== "AVATAR" && kind !== "BANNER") return;

        const key = favoriteKey(result, kind);

        setFavorites(current => {
            const currentForKind = current.filter(item => item.target === kind);
            const otherKinds = current.filter(item => item.target !== kind);
            const exists = currentForKind.some(item => favoriteKey(item, item.target) === key);

            const nextForKind = exists
                ? currentForKind.filter(item => favoriteKey(item, item.target) !== key)
                : [{ ...result, target: kind, savedAt: Date.now() }, ...currentForKind];

            void writeFavoritesForTarget(kind, nextForKind);

            return [...nextForKind, ...otherKinds].sort((a, b) => b.savedAt - a.savedAt);
        });
    }

    async function runSearch(nextQuery = query, nextGifsOnly = gifsOnly, manual = false) {
        const trimmed = nextQuery.trim();
        if (!trimmed) return;
        const mode: SearchMediaMode = nextGifsOnly ? "GIFS" : "IMAGES";
        const kinds = getSearchKinds(target);
        const generation = ++requestGenerationRef.current[mode];
        const isCurrent = () => generation === requestGenerationRef.current[mode];
        setFavoritesOnly(false);
        setLoadingByMode(current => ({ ...current, [mode]: true }));
        setManualSearchingByMode(current => ({ ...current, [mode]: manual }));
        setManualSearchQueryByMode(current => ({ ...current, [mode]: manual ? trimmed : "" }));
        setMenuId("");
        setBucketsForMode(mode, current => {
            const next = { ...current };
            for (const kind of kinds) next[kind] = createEmptyBucket();
            return next;
        });
        scrollPositionsRef.current[mode] = 0;
        scrollRef.current?.scrollTo({ top: 0 });

        function publish(kind: SearchKind, payload: PinterestSearchPayload) {
            if (!isCurrent()) return;
            // Discovery feed: images already shown in earlier openings go last.
            if (!manual) payload = { ...payload, results: freshFirst(payload.results) };
            setBucketsForMode(mode, current => ({ ...current, [kind]: {
                data: payload, activeQuery: payload.query, bookmark: payload.bookmark,
                page: 0, loadingNextPage: false, error: ""
            } }));
        }
        await Promise.all(kinds.map(async kind => {
            try {
                publish(kind, await Native.search(trimmed, getResultsPerRequest(), nextGifsOnly ? "GIFS" : "STATIC", [], kind,
                    randomizeSearch || !manual) as PinterestSearchPayload);
            } catch (error) {
                if (!isCurrent()) return;
                logger.error("Search failed", error);
                setBucketsForMode(mode, current => ({ ...current, [kind]: { ...createEmptyBucket(), error: errorText(error) || t("searchFailed") } }));
            }
        }));
        if (!isCurrent()) return;
        if (manual) {
            recentSearches.remember(trimmed);
            setTabLastSearchQueries(current => ({ ...current, [mode]: trimmed }));
            setTabQueries(current => ({ ...current, [mode]: trimmed }));
        }
        setLoadingByMode(current => ({ ...current, [mode]: false }));
        setManualSearchingByMode(current => ({ ...current, [mode]: false }));
        setManualSearchQueryByMode(current => ({ ...current, [mode]: "" }));
    }

    function hasCachedResults(mode: SearchMediaMode) {
        return Object.values(bucketsByMode[mode]).some(bucket =>
            bucket.data !== null || Boolean(bucket.error)
        );
    }

    function changeMediaMode(mode: "IMAGES" | "GIFS" | "FAVORITES") {
        setMenuId("");
        rememberCurrentScroll();

        if (mode === "FAVORITES") {
            // Favorites is only a view switch. Do not cancel Images/GIFs requests:
            // they can finish in the background and will be ready when the user returns.
            setFavoritesOnly(true);
            restoreScroll("FAVORITES");
            return;
        }

        const nextMode: SearchMediaMode = mode;
        const nextGifsOnly = nextMode === "GIFS";
        if (!favoritesOnly && nextGifsOnly === gifsOnly) return;

        setFavoritesOnly(false);
        setGifsOnly(nextGifsOnly);

        // Images and GIFs keep completely independent search text/results.
        // Switching tabs must never copy the currently typed query into the other tab:
        // a user may intentionally search "reze" in Images and "sung jinwoo" in GIFs.
        // If the destination tab has never been searched, its field stays empty while
        // the optional discovery feed can load invisibly in the background.
        const nextQuery = tabQueries[nextMode];

        setQuery(nextQuery);
        restoreScroll(nextMode);

        // If this tab already has a request in flight, simply show its state. Never
        // start a duplicate request and never invalidate the background request.
        if (loadingByMode[nextMode]) return;

        // Cached results preserve page + scroll exactly where this tab was left.
        if (hasCachedResults(nextMode)) return;

        if (nextQuery.trim()) {
            void runSearch(nextQuery, nextGifsOnly, true);
            return;
        }

        if (initialDiscoveryQuery) {
            void runSearch(initialDiscoveryQuery, nextGifsOnly, false);
        }
    }

    function handleResultPageChange(kind: SearchKind) {
        // Banner pages are vertically tall. When the user changes page from the
        // sticky arrows near the bottom, start the new page at its first result
        // instead of preserving the previous page's deep scroll position.
        if (kind !== "BANNER") return;

        scrollPositionsRef.current[activeMediaMode] = 0;
        scrollRef.current?.scrollTo({ top: 0 });
    }

    async function loadNextPage(kind: SearchKind, advance = true) {
        const mode = activeMediaMode;
        const bucket = bucketsByMode[mode][kind];
        if (!bucket.data || !bucket.bookmark?.length || bucket.loadingNextPage) return;
        const requestKey = JSON.stringify([mode, kind, requestGenerationRef.current[mode], bucket.bookmark]);
        if (pagingRequests.current.has(requestKey)) return;
        pagingRequests.current.add(requestKey);

        setBucketsForMode(mode, current => ({
            ...current,
            [kind]: {
                ...current[kind],
                loadingNextPage: true
            }
        }));

        const generation = requestGenerationRef.current[mode];

        try {
            const searchQuery = bucket.activeQuery || tabLastSearchQueries[mode] || tabQueries[mode] || query;
            const mediaFilter = mode === "GIFS" ? "GIFS" : "STATIC";
            const sentBookmarkKey = JSON.stringify(bucket.bookmark);

            let response = await Native.search(searchQuery, getResultsPerRequest(), mediaFilter, bucket.bookmark, kind, randomizeSearch) as PinterestSearchPayload;

            // v15.5: if a whole static batch came back as pins that are already shown,
            // try the next cursor once more right away instead of leaving the user on
            // the same page (the old "stuck around page 12" behaviour). Only one extra
            // request, and never for GIFs, which already scan several cursors natively.
            const hasNewResults = (batch: PinterestSearchPayload) =>
                mergeUniqueResults(bucket.data!.results, batch.results).length > bucket.data!.results.length;

            if (
                mediaFilter === "STATIC"
                && generation === requestGenerationRef.current[mode]
                && !hasNewResults(response)
                && response.bookmark?.length
                && JSON.stringify(response.bookmark) !== sentBookmarkKey
            ) {
                response = await Native.search(searchQuery, getResultsPerRequest(), mediaFilter, response.bookmark, kind, randomizeSearch) as PinterestSearchPayload;
            }

            logger.info(`[next] ${kind} ${mode}: ${response.results.length} results, new: ${hasNewResults(response) ? "yes" : "NO"}, cursor for more: ${response.bookmark?.length ? "yes" : "NO"}`);

            // A cursor that points back at itself (or a batch with nothing new after
            // the retry) means Pinterest has no more for this query: turn Next off
            // instead of leaving a button that does nothing.
            if (
                JSON.stringify(response.bookmark) === sentBookmarkKey
                || (mediaFilter === "STATIC" && !hasNewResults(response))
            ) {
                response = { ...response, bookmark: null };
            }

            if (generation !== requestGenerationRef.current[mode]) {
                return;
            }

            setBucketsForMode(mode, current => {
                const currentBucket = current[kind];
                const existingResults = currentBucket.data?.results ?? [];
                const mergedResults = mergeUniqueResults(existingResults, response.results);
                const nextPage = currentBucket.page + 1;
                const nextPageStart = nextPage * getSlotCount(kind);
                const canShowNextPage = mergedResults.length > nextPageStart;

                return {
                    ...current,
                    [kind]: {
                        ...currentBucket,
                        data: currentBucket.data == null ? response : {
                            query: currentBucket.data.query,
                            guides: currentBucket.data.guides,
                            results: mergedResults,
                            bookmark: response.bookmark
                        },
                        bookmark: response.bookmark,
                        // A Pinterest backend page is not the same thing as a visible
                        // plugin page. GIF batches can contain zero direct .gif files.
                        // Only advance the UI after enough real results exist to show it.
                        page: advance && canShowNextPage ? nextPage : currentBucket.page,
                        loadingNextPage: false,
                        error: ""
                    }
                };
            });
        } catch (error) {
            if (generation !== requestGenerationRef.current[mode]) return;
            logger.error("Next page failed", error);
            // Background prefetches fail silently; the user can still press Next.
            if (advance) showToast(t("searchFailed"), Toasts.Type.FAILURE);
            setBucketsForMode(mode, current => ({
                ...current,
                [kind]: {
                    ...current[kind],
                    loadingNextPage: false
                }
            }));
        } finally {
            pagingRequests.current.delete(requestKey);
        }
    }

    useEffect(() => () => {
        ++requestGenerationRef.current.IMAGES;
        ++requestGenerationRef.current.GIFS;
    }, []);

    useEffect(() => {
        let cancelled = false;

        void readFavorites().then(loaded => {
            if (!cancelled) setFavorites(loaded);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!initialDiscoveryQuery) return;
        if (tabQueries.IMAGES.trim() || tabLastSearchQueries.IMAGES || hasCachedResults("IMAGES")) return;
        void runSearch(initialDiscoveryQuery, false, false);
    }, []);

    function getGuideSource() {
        const primary = getPrimaryKind(target);
        return buckets[primary].data ?? buckets.IMAGE.data ?? buckets.AVATAR.data ?? buckets.BANNER.data;
    }

    function getPlaceholder() {
        return t("placeholder");
    }

    function resetToDiscovery() {
        const mode = activeMediaMode;
        const modeIsGifs = mode === "GIFS";

        clearQuery();
        setTabQueries(current => ({
            ...current,
            [mode]: ""
        }));
        setTabLastSearchQueries(current => ({
            ...current,
            [mode]: ""
        }));
        setMenuId("");
        setFavoritesOnly(false);
        setFavoritesPage(0);
        scrollPositionsRef.current[mode] = 0;

        // The X resets only the active Images/GIFs tab. The other tab keeps its
        // own search, page and cached results exactly as the user left them.
        if (initialDiscoveryQuery) {
            void runSearch(initialDiscoveryQuery, modeIsGifs, false);
            return;
        }

        ++requestGenerationRef.current[mode];
        setBucketsForMode(mode, createEmptyBuckets());
        setLoadingByMode(current => ({ ...current, [mode]: false }));
        setManualSearchingByMode(current => ({ ...current, [mode]: false }));
    }

    function getSlotCount(kind: SearchKind) {
        if (kind === "BANNER") return BANNER_RESULTS_PER_PAGE;
        if (kind === "IMAGE") return IMAGE_RESULTS_PER_PAGE;
        return AVATAR_RESULTS_PER_PAGE;
    }


    function selectResult(result: PinterestImageResult, kind: SearchKind) {
        setMenuId("");
        onSelectResult(result, kind);
    }

    function tabKey(event: React.KeyboardEvent<HTMLDivElement>) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"));
        const index = tabs.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const delta = (event.key === "ArrowRight" ? 1 : -1) * (direction() === "rtl" ? -1 : 1);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length;
        tabs[next].focus(); tabs[next].click();
    }
    return (
        <div ref={browserRef} className={rootClassName} dir={direction()} style={getPinterestFullStyle(resolvePinterestTheme(colorTheme), customAccent, resolvedAppearance, appearance === "AUTO") as any} data-pt-mode={resolvedAppearance}
            onKeyDown={event => { if (event.key === "/" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); focusSearchInput(); } }}>
            <div className={cl("container-header")}>
                <form className={cl("search-shell")} onSubmit={event => { event.preventDefault(); setSuggestOpen(false); if (!trimmedVisibleQuery || isSearchingVisibleQuery || isPagingVisibleQuery) return; void runSearch(query, gifsOnly, true); }}>
                    <div className={cl("toolbar")}>
                        <div className={cl("media-tabs")} role="tablist" aria-label={t("mediaType")} onKeyDown={tabKey}>
                            <button type="button" role="tab" aria-selected={!gifsOnly && !favoritesOnly} className={classes(cl("media-tab"), !gifsOnly && !favoritesOnly && cl("media-tab-active"))} onClick={() => changeMediaMode("IMAGES")}>{t("images")}</button>
                            <button type="button" role="tab" aria-selected={gifsOnly && !favoritesOnly} className={classes(cl("media-tab"), gifsOnly && !favoritesOnly && cl("media-tab-active"))} onClick={() => changeMediaMode("GIFS")}>GIF</button>
                            <button type="button" role="tab" aria-selected={favoritesOnly} className={classes(cl("media-tab"), favoritesOnly && cl("media-tab-active"))} onClick={() => changeMediaMode("FAVORITES")}><HeartIcon filled={favoritesOnly}/>{t("favorites")}{favorites.length ? <span className={cl("tab-count")}>{favorites.length}</span> : null}</button>
                        </div>
                        <details ref={personalizeRef} className={cl("personalize")}><summary aria-label={t("customize")} title={t("customize")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16" stroke="currentColor" strokeWidth="1.6"/><circle cx="9" cy="7" r="3" fill="var(--pt-surface)" stroke="currentColor" strokeWidth="1.6"/><circle cx="15" cy="17" r="3" fill="var(--pt-surface)" stroke="currentColor" strokeWidth="1.6"/></svg></summary>
                            <div className={cl("personalize-panel")}><AppearanceToggle setting={appearance as AppearanceSetting} resolved={resolvedAppearance}/><ThemePicker theme={resolvePinterestTheme(colorTheme)} customAccent={customAccent}/></div>
                        </details>
                    </div>
                    {!favoritesOnly ? <>
                        <div className={cl("search-row")}>
                            <div className={cl("search-field")} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setSuggestOpen(false); }}>
                                <SearchIcon/>
                                <input type="search" dir="auto" autoFocus maxLength={240} placeholder={getPlaceholder()} value={query} aria-label={t("search")}
                                    aria-expanded={showSuggestions} aria-haspopup="listbox"
                                    onChange={event => { updateVisibleQuery(event.currentTarget.value); setSuggestOpen(true); }}
                                    onClick={() => setSuggestOpen(true)}
                                    onKeyDown={event => {
                                        if (event.key === "ArrowDown") { setSuggestOpen(true); return; }
                                        if (event.key === "Escape" && showSuggestions) { event.stopPropagation(); setSuggestOpen(false); }
                                    }}/>
                                {query ? <button type="button" className={cl("search-clear")} aria-label={t("clear")} onClick={resetToDiscovery}>×</button> : <kbd title={t("shortcuts")}>/</kbd>}
                                {/* Recent and related searches open under the field instead of taking a row of their own. */}
                                {showSuggestions ? <div className={cl("suggest")} role="listbox" onMouseDown={event => event.preventDefault()}>
                                    {matchingRecent.length ? <div className={cl("suggest-group")}>
                                        <div className={cl("suggest-label")}><span>{t("recentSearches")}</span><button type="button" className={cl("suggest-clear")} onClick={() => recentSearches.clear()}>{t("clearRecent")}</button></div>
                                        {matchingRecent.map(item => <button key={item} type="button" role="option" className={cl("suggest-item")} onClick={() => pickSuggestion(item)}><span className={cl("suggest-icon")} aria-hidden="true">↺</span>{item}</button>)}
                                    </div> : null}
                                    {relatedGuides.length ? <div className={cl("suggest-group")}>
                                        <div className={cl("suggest-label")}><span>{t("related")}</span></div>
                                        <div className={cl("suggest-chips")}>{relatedGuides.map(guide => <button key={guide.query} type="button" role="option" className={cl("chip")} onClick={() => pickSuggestion(guide.query)}>{guide.label}</button>)}</div>
                                    </div> : null}
                                </div> : null}
                            </div>
                            <PillButton compact type="submit" disabled={!trimmedVisibleQuery || isSearchingVisibleQuery || isPagingVisibleQuery}>{isSearchingVisibleQuery ? t("searching") : t("search")}</PillButton>
                            {target === "AVATAR" ? <button type="button" className={classes(cl("round-toggle"), roundPreview && cl("round-toggle-active"))} aria-label={t("round")} title={t("round")} aria-pressed={roundPreview} onClick={() => setRoundPreview(current => !current)}><span aria-hidden="true"/></button> : null}
                            <select className={cl("sort-select")} aria-label={t("sort")} title={t("sort")} value={sort} onChange={event => { setSort(event.currentTarget.value as ResultSort); setActiveBuckets(current => Object.fromEntries(Object.entries(current).map(([kind, value]) => [kind, { ...value, page: 0 }])) as SearchBuckets); }}>{(["relevance", "quality", "shape"] as const).map(option => <option key={option} value={option}>{t(option)}</option>)}</select>
                        </div>
                    </> : null}
                </form>
            </div>
            <div ref={scrollRef} className={cl("container-body")}>
                {favoritesOnly ? <FavoritesSection target={currentFavoriteTarget()} favorites={favorites} slotCount={getSlotCount(currentFavoriteTarget())} page={favoritesPage} setPage={setFavoritesPage} menuId={menuId} setMenuId={setMenuId} onSelectResult={selectResult} onToggleFavorite={toggleFavorite}/> : getSearchKinds(target).map(kind =>
                    <ResultsSection key={kind} kind={kind} bucket={buckets[kind]} menuId={menuId} gifsOnly={gifsOnly} slotCount={getSlotCount(kind)} setMenuId={setMenuId} setBuckets={setActiveBuckets} onLoadNextPage={loadNextPage} onPageChange={handleResultPageChange} onSelectResult={selectResult} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} onRetry={() => void runSearch(query || lastSearchQuery || initialDiscoveryQuery || "", gifsOnly, Boolean(query.trim()))} loading={loadingByMode[activeMediaMode]} sort={sort} round={roundPreview}/>) }
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Editor step: real effects + text / pasted images (runs before Discord's Edit Image)
// ---------------------------------------------------------------------------

type EffectsOutcome =
    | { kind: "cancel"; }
    | { kind: "original"; }
    | { kind: "edited"; file: File; dataUrl: string; };

function loadImageElement(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not load the image."));
        image.src = src;
    });
}

function readFileAsDataUrl(file: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the pasted image."));
        reader.readAsDataURL(file);
    });
}

let layerCounter = 0;
const nextLayerId = () => `layer-${Date.now().toString(36)}-${++layerCounter}`;

function FxSlider({
    label,
    value,
    min,
    max,
    step = 1,
    unit = "",
    offLabel,
    resetTo,
    onChange
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    offLabel?: string;
    resetTo?: number;
    onChange(value: number): void;
}) {
    const changed = resetTo !== undefined && value !== resetTo;
    return (
        <div className={classes(cl("fx-slider"), changed && cl("fx-slider-changed"))}>
            <span className={cl("fx-slider-label")}>
                <span>{label}</span>
                <span className={cl("fx-slider-side")}>
                    {/* Space is always reserved so the row never shifts while dragging. */}
                    <button type="button" className={cl("fx-slider-reset")} style={{ visibility: changed ? "visible" : "hidden" }} tabIndex={changed ? 0 : -1} title={t("reset")} aria-label={`${t("reset")}: ${label}`} onClick={() => onChange(resetTo!)}>↺</button>
                    <span className={cl("fx-slider-value")}>{offLabel && value === 0 ? offLabel : `${value}${unit}`}</span>
                </span>
            </span>
            <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={event => onChange(Number(event.currentTarget.value))} />
        </div>
    );
}

// Collapsible group of sliders in the Adjust tab.
function FxSection({ title, icon, defaultOpen = false, children }: { title: string; icon: string; defaultOpen?: boolean; children: ReactNode; }) {
    return (
        <details className={cl("fx-section")} open={defaultOpen}>
            <summary><span className={cl("fx-section-icon")} aria-hidden="true">{icon}</span>{title}<span className={cl("fx-section-caret")} aria-hidden="true"/></summary>
            <div className={cl("fx-section-body")}>{children}</div>
        </details>
    );
}

const PRESET_NAMES: Record<string, Parameters<typeof t>[0]> = {
    Original: "original", Noir: "pNoir", Vivid: "pVivid", Glitch: "pGlitch", VHS: "pVhs", Pixel: "pPixel", Neon: "pNeon",
    Sketch: "pSketch", Poster: "pPoster", Duotone: "pDuotone", Dream: "pDream", Film: "pFilm", Cyber: "pCyber"
};

// Small live preview of a filter applied to the current image.
function PresetThumb({ image, natural, values, order }: { image: CanvasImageSource | null; natural: { w: number; h: number; }; values: Partial<Fx>; order: number; }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !image) return;
        // Drawn one after another instead of all at once, so opening the
        // editor does not stall while 13 filtered previews render.
        const timer = window.setTimeout(() => {
            const scale = 120 / Math.max(natural.w, natural.h);
            canvas.width = Math.max(1, Math.round(natural.w * scale));
            canvas.height = Math.max(1, Math.round(natural.h * scale));
            try {
                drawScene(canvas, image, { ...FX_DEFAULT, ...values }, [], new Map(), { keepAlpha: true });
            } catch (error) {
                logger.error("Filter preview failed", error);
            }
        }, 40 + order * 30);
        return () => window.clearTimeout(timer);
    }, [image, natural.w, natural.h]);
    return <canvas ref={canvasRef} className={cl("fx-thumb")} aria-hidden="true"/>;
}

function EffectsEditor({
    src,
    filename,
    mediaType,
    target,
    onDone
}: {
    src: string;
    filename: string;
    mediaType: string;
    target: SearchKind;
    onDone(outcome: EffectsOutcome): void;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<CanvasImageSource | null>(null);
    const naturalRef = useRef({ w: 1, h: 1 });
    const gifRef = useRef<DecodedGif | null>(null);
    const animated = /gif/i.test(mediaType);
    const [progress, setProgress] = useState("");
    const [frameCount, setFrameCount] = useState(0);
    const imageCacheRef = useRef<ImageCache>(new Map());
    const dragRef = useRef<{ id: string; dx: number; dy: number; } | null>(null);
    const textAreaRef = useRef<HTMLTextAreaElement>(null);

    const [fx, setFx] = useState<Fx>(FX_DEFAULT);
    const [activePreset, setActivePreset] = useState("Original");
    const [layers, setLayers] = useState<Layer[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [tab, setTab] = useState<"filters" | "adjust" | "text">("filters");
    const [ready, setReady] = useState(false);
    const [tick, setTick] = useState(0);
    const [busy, setBusy] = useState(false);
    const [size, setSize] = useState({ w: 640, h: 400 });

    // Undo / redo for everything in the editor (filters, sliders, text and
    // layer moves). A slider drag or a layer drag is recorded once, not on
    // every intermediate value.
    type Snapshot = { fx: Fx; layers: Layer[]; preset: string; };
    const historyRef = useRef<{ past: Snapshot[]; future: Snapshot[]; lastAt: number; lastKind: string; }>({ past: [], future: [], lastAt: 0, lastKind: "" });
    const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
    const stateRef = useRef<Snapshot>({ fx: FX_DEFAULT, layers: [], preset: "Original" });
    stateRef.current = { fx, layers, preset: activePreset };

    function record(kind: string) {
        const history = historyRef.current;
        const now = Date.now();
        if (kind === history.lastKind && now - history.lastAt < 700) {
            history.lastAt = now;
            return;
        }
        history.past.push(stateRef.current);
        if (history.past.length > 50) history.past.shift();
        history.future = [];
        history.lastAt = now;
        history.lastKind = kind;
        setHistorySize({ past: history.past.length, future: 0 });
    }

    function restore(snapshot: Snapshot) {
        setFx(snapshot.fx);
        setLayers(snapshot.layers);
        setActivePreset(snapshot.preset);
        if (!snapshot.layers.some(layer => layer.id === selectedId)) setSelectedId("");
    }

    function undoEdit() {
        const history = historyRef.current;
        const previous = history.past.pop();
        if (!previous) return;
        history.future.push(stateRef.current);
        history.lastKind = "";
        restore(previous);
        setHistorySize({ past: history.past.length, future: history.future.length });
    }

    function redoEdit() {
        const history = historyRef.current;
        const next = history.future.pop();
        if (!next) return;
        history.past.push(stateRef.current);
        history.lastKind = "";
        restore(next);
        setHistorySize({ past: history.past.length, future: history.future.length });
    }

    const selected = layers.find(layer => layer.id === selectedId) ?? null;
    const changed = !isPristine(fx) || layers.length > 0;

    useEffect(() => {
        let cancelled = false;

        async function load() {
            if (animated) {
                // Frames are decoded once, already scaled to a size Discord accepts.
                const gif = await decodeGif(dataUrlToBytes(src), target === "BANNER" ? 960 : 640, 300);
                if (cancelled) {
                    gif.frames.forEach(frame => frame.image.close());
                    return;
                }
                gifRef.current = gif;
                imageRef.current = gif.frames[0].image;
                naturalRef.current = { w: gif.width, h: gif.height };
                setFrameCount(gif.frames.length);
            } else {
                const image = await loadImageElement(src);
                if (cancelled) return;
                imageRef.current = image;
                naturalRef.current = { w: image.naturalWidth, h: image.naturalHeight };
            }

            const { w, h } = naturalRef.current;
            const scale = Math.min(1.5, 760 / w, 470 / h);
            setSize({ w: Math.max(80, Math.round(w * scale)), h: Math.max(80, Math.round(h * scale)) });
            setReady(true);
        }

        load().catch(error => {
            logger.error("Editor could not open the media", error);
            showToast(t("editorFailed"), Toasts.Type.FAILURE);
            onDone({ kind: "original" });
        });

        return () => {
            cancelled = true;
            gifRef.current?.frames.forEach(frame => frame.image.close());
            gifRef.current = null;
        };
    }, [src]);

    // Glitch and grain change on every GIF frame so the effect moves with the animation.
    const fxForFrame = (index: number): Fx => index === 0 ? fx : { ...fx, glitchSeed: fx.glitchSeed + index * 17 };

    // Live preview: same engine as the export, at screen size. GIFs play.
    useEffect(() => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!ready || !canvas || !image) return;
        const keepAlpha = animated || /png|webp/i.test(mediaType);
        const gif = gifRef.current;
        const render = (frame: CanvasImageSource, frameFx: Fx) =>
            drawScene(canvas, frame, frameFx, layers, imageCacheRef.current, { selectedId, keepAlpha });

        if (!animated || !gif || gif.frames.length < 2) {
            const frame = requestAnimationFrame(() => {
                try {
                    render(image, fx);
                } catch (error) {
                    logger.error("Preview failed", error);
                }
            });
            return () => cancelAnimationFrame(frame);
        }

        const total = gif.frames.reduce((sum, frame) => sum + frame.delay, 0) || 1;
        const started = performance.now();
        let handle = 0;
        let lastIndex = -1;
        const loop = (now: number) => {
            let t = (now - started) % total;
            let index = 0;
            while (index < gif.frames.length - 1 && t >= gif.frames[index].delay) {
                t -= gif.frames[index].delay;
                index++;
            }
            if (index !== lastIndex) {
                lastIndex = index;
                try {
                    render(gif.frames[index].image, fxForFrame(index));
                } catch (error) {
                    logger.error("Preview failed", error);
                }
            }
            handle = requestAnimationFrame(loop);
        };
        handle = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(handle);
    }, [ready, fx, layers, selectedId, size, tick]);

    function addTextLayer(text = t("text")) {
        const layer: TextLayer = {
            kind: "text", id: nextLayerId(), text, x: 0.5, y: 0.5, size: 0.12, color: "#ffffff",
            font: "Impact", bold: false, italic: false, outline: true, outlineColor: "#000000", shadow: true
        };
        record("add");
        setLayers(current => [...current, layer]);
        setSelectedId(layer.id);
        setTab("text");
        window.setTimeout(() => { textAreaRef.current?.focus(); textAreaRef.current?.select(); }, 30);
    }

    async function addImageLayer(dataUrl: string) {
        try {
            const image = await loadImageElement(dataUrl);
            const id = nextLayerId();
            imageCacheRef.current.set(id, image);
            const layer: ImageLayer = { kind: "image", id, src: dataUrl, x: 0.5, y: 0.5, scale: 0.35 };
            record("add");
            setLayers(current => [...current, layer]);
            setSelectedId(id);
            setTab("text");
            setTick(value => value + 1);
        } catch {
            showToast(t("addImageFailed"), Toasts.Type.FAILURE);
        }
    }

    // Ctrl+V: a copied image becomes a movable layer, copied text becomes a text layer.
    useEffect(() => {
        async function onPaste(event: ClipboardEvent) {
            const targetEl = event.target as HTMLElement | null;
            if (targetEl && /^(INPUT|TEXTAREA)$/.test(targetEl.tagName)) return;
            const data = event.clipboardData;
            if (!data) return;

            const imageItem = [...data.items].find(item => item.kind === "file" && item.type.startsWith("image/"));
            if (imageItem) {
                const blob = imageItem.getAsFile();
                if (blob) {
                    event.preventDefault();
                    void addImageLayer(await readFileAsDataUrl(blob));
                    return;
                }
            }

            const text = data.getData("text/plain").trim();
            if (text) {
                event.preventDefault();
                addTextLayer(text.slice(0, 300));
            }
        }

        function onKey(event: KeyboardEvent) {
            const targetEl = event.target as HTMLElement | null;
            // Only real text fields keep their own shortcuts; a slider, checkbox
            // or colour input that still has focus after a change must not.
            const typing = !!targetEl && (targetEl.tagName === "TEXTAREA" || targetEl.isContentEditable
                || (targetEl instanceof HTMLInputElement && /^(text|search|url|email|number|)$/.test(targetEl.type)));
            const key = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && !typing && (key === "z" || key === "y")) {
                // Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo (text boxes keep their own undo).
                event.preventDefault();
                event.stopPropagation();
                if (key === "y" || event.shiftKey) redoEdit(); else undoEdit();
            } else if (event.key === "Escape") {
                event.stopPropagation();
                onDone({ kind: "cancel" });
            } else if ((event.key === "Delete" || event.key === "Backspace") && !typing && selectedId) {
                record("delete");
                setLayers(current => current.filter(layer => layer.id !== selectedId));
                setSelectedId("");
            }
        }

        document.addEventListener("paste", onPaste, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
            document.removeEventListener("paste", onPaste, true);
            document.removeEventListener("keydown", onKey, true);
        };
    }, [selectedId]);

    async function pasteFromClipboardButton() {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const type = item.types.find(t => t.startsWith("image/"));
                if (type) {
                    await addImageLayer(await readFileAsDataUrl(await item.getType(type)));
                    return;
                }
            }
            const text = (await navigator.clipboard.readText()).trim();
            if (text) {
                addTextLayer(text.slice(0, 300));
                return;
            }
            showToast(t("clipboardEmpty"), Toasts.Type.MESSAGE);
        } catch {
            showToast(t("clipboardHint"), Toasts.Type.MESSAGE);
        }
    }

    function updateLayer(id: string, patch: Partial<TextLayer> & Partial<ImageLayer>, kind = `layer:${id}:${Object.keys(patch).join(",")}`) {
        if (kind) record(kind);
        setLayers(current => current.map(layer => layer.id === id ? { ...layer, ...patch } as Layer : layer));
    }

    function setFxValue<K extends keyof Fx>(key: K, value: Fx[K]) {
        record(`fx:${String(key)}`);
        setFx(current => ({ ...current, [key]: value }));
        setActivePreset("Custom");
    }

    function applyPreset(label: string, values: Partial<Fx>) {
        record(`preset:${label}`);
        setFx(current => ({ ...FX_DEFAULT, glitchSeed: current.glitchSeed, ...values }));
        setActivePreset(label);
    }

    function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * canvas.width,
            y: ((event.clientY - rect.top) / rect.height) * canvas.height
        };
    }

    function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
        const canvas = event.currentTarget;
        const { x, y } = canvasPoint(event);
        const id = hitTestLayers(canvas, layers, imageCacheRef.current, x, y);
        setSelectedId(id ?? "");
        if (!id) return;
        const layer = layers.find(item => item.id === id)!;
        record(`move:${id}`);
        dragRef.current = { id, dx: layer.x - x / canvas.width, dy: layer.y - y / canvas.height };
        canvas.setPointerCapture(event.pointerId);
        setTab("text");
    }

    function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
        const drag = dragRef.current;
        if (!drag) return;
        const canvas = event.currentTarget;
        const { x, y } = canvasPoint(event);
        updateLayer(drag.id, {
            x: Math.min(1, Math.max(0, x / canvas.width + drag.dx)),
            y: Math.min(1, Math.max(0, y / canvas.height + drag.dy))
        }, "");
    }

    function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
    }

    async function confirm() {
        const image = imageRef.current;
        if (!changed || !image) {
            onDone({ kind: "original" });
            return;
        }

        setBusy(true);

        if (animated && gifRef.current) {
            try {
                const bytes = await encodeFittedGif(
                    gifRef.current,
                    (canvas, frame, index) => drawScene(canvas, frame.image, fxForFrame(index), layers, imageCacheRef.current, { keepAlpha: true }),
                    setProgress
                );
                const base = filename.replace(/\.[a-z0-9]+$/i, "") || "animation";
                const file = new File([bytes as unknown as BlobPart], `${base}-edit.gif`, { type: "image/gif" });
                onDone({ kind: "edited", file, dataUrl: bytesToDataUrl(bytes, "image/gif") });
            } catch (error) {
                logger.error("Could not render the edited GIF", error);
                showToast(error instanceof Error ? error.message : "Could not apply those edits to the GIF.", Toasts.Type.FAILURE);
                setBusy(false);
                setProgress("");
            }
            return;
        }

        try {
            const { w: naturalW, h: naturalH } = naturalRef.current;
            const scale = Math.min(1, 2048 / Math.max(naturalW, naturalH));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(naturalW * scale));
            canvas.height = Math.max(1, Math.round(naturalH * scale));

            const keepAlpha = /png|webp/i.test(mediaType);
            drawScene(canvas, image, fx, layers, imageCacheRef.current, { keepAlpha });

            const mime = keepAlpha ? "image/png" : "image/jpeg";
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, 0.93));
            if (!blob) throw new Error("Could not export the edited image.");

            const base = filename.replace(/\.[a-z0-9]+$/i, "") || "image";
            const file = new File([blob], `${base}-edit.${keepAlpha ? "png" : "jpg"}`, { type: mime });
            onDone({ kind: "edited", file, dataUrl: canvas.toDataURL(mime, 0.93) });
        } catch (error) {
            logger.error("Could not render the edited image", error);
            showToast(t("editFailed"), Toasts.Type.FAILURE);
            onDone({ kind: "original" });
        }
    }

    const fxSet = setFxValue;
    const slider = (key: "brightness" | "contrast" | "saturate" | "hue" | "sepia" | "grayscale" | "invert" | "tintStrength" | "duotone" | "blur" | "pixelate" | "posterize" | "sharpen" | "sketch" | "rgbSplit" | "glitch" | "bloom" | "vignette" | "grain" | "scanlines",
        label: string, min: number, max: number, unit = "", extra: { step?: number; offLabel?: string; } = {}) =>
        <FxSlider label={label} value={fx[key]} min={min} max={max} unit={unit} step={extra.step} offLabel={extra.offLabel} resetTo={FX_DEFAULT[key]} onChange={v => fxSet(key, v)} />;

    function resetAll() {
        record("reset");
        setFx(current => ({ ...FX_DEFAULT, glitchSeed: current.glitchSeed }));
        setActivePreset("Original");
        setLayers([]);
        setSelectedId("");
    }

    return (
        <div className={cl("fx")} role="dialog" aria-label={t("editor")}>
            <div className={cl("fx-topbar")}>
                <button type="button" className={cl("fx-back")} disabled={busy} onClick={() => onDone({ kind: "cancel" })}><ChevronLeftIcon/>{t("back")}</button>
                <div className={cl("fx-title")}>
                    {t("editTitle")}
                    <span className={cl("fx-title-tag")}>{t(target === "BANNER" ? "banner" : "avatar")}{animated && frameCount ? " · GIF" : ""}</span>
                </div>
                <div className={cl("fx-topbar-actions")}>
                    <button type="button" className={cl("fx-icon-btn")} disabled={busy || !historySize.past} title={`${t("undo")} (Ctrl+Z)`} aria-label={t("undo")} onClick={undoEdit}>↶</button>
                    <button type="button" className={cl("fx-icon-btn")} disabled={busy || !historySize.future} title={`${t("redo")} (Ctrl+Y)`} aria-label={t("redo")} onClick={redoEdit}>↷</button>
                    <button type="button" className={cl("fx-ghost")} disabled={busy || !changed} onClick={resetAll}>↺ {t("reset")}</button>
                </div>
            </div>

            <div className={cl("fx-body")}>
                <div className={cl("fx-preview")}>
                    <div className={cl("fx-stage")}>
                        <div className={cl("fx-canvas-wrap")}>
                            <canvas
                                ref={canvasRef}
                                className={cl("fx-canvas")}
                                width={size.w}
                                height={size.h}
                                onPointerDown={onPointerDown}
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerUp}
                                onPointerCancel={onPointerUp}
                            />
                            {target === "AVATAR" ? <span className={cl("fx-guide")} aria-hidden="true" /> : null}
                        </div>
                    </div>
                    <div className={cl("fx-hint")}>
                        {animated && frameCount ? t("animatedFrames", { count: frameCount }) + " · " : ""}{t("editorHint")}
                    </div>
                </div>

                <div className={cl("fx-panel")}>
                    <div className={cl("fx-tabs")} role="tablist">
                        {([["filters", "✨", t("filters")], ["adjust", "◐", t("adjust")], ["text", "T", t("text") + (layers.length ? ` · ${layers.length}` : "")]] as const).map(([id, icon, label]) => (
                            <button key={id} type="button" role="tab" aria-selected={tab === id} className={classes(cl("fx-tab"), tab === id && cl("fx-tab-active"))} onClick={() => setTab(id)}>
                                <span className={cl("fx-tab-icon")} aria-hidden="true">{icon}</span>{label}
                            </button>
                        ))}
                    </div>

                    <div className={cl("fx-scroll")}>
                        {tab === "filters" ? (
                            <div className={cl("fx-preset-grid")}>
                                {FX_PRESETS.map((preset, order) => (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        className={classes(cl("fx-preset-card"), activePreset === preset.label && cl("fx-preset-card-active"))}
                                        aria-pressed={activePreset === preset.label}
                                        onClick={() => applyPreset(preset.label, preset.values)}
                                    >
                                        <PresetThumb image={ready ? imageRef.current : null} natural={naturalRef.current} values={preset.values} order={order} />
                                        <span>{t(PRESET_NAMES[preset.label] ?? "original")}</span>
                                    </button>
                                ))}
                            </div>
                        ) : tab === "adjust" ? (
                            <>
                                <FxSection title={t("lightColor")} icon="☀" defaultOpen>
                                    {slider("brightness", t("brightness"), 30, 180, "%")}
                                    {slider("contrast", t("contrast"), 30, 220, "%")}
                                    {slider("saturate", t("saturation"), 0, 250, "%")}
                                    {slider("hue", t("hueShift"), -180, 180, "°")}
                                    <div className={cl("fx-color-row")}>
                                        <span>{t("tint")}</span>
                                        <input type="color" className={cl("fx-color")} value={fx.tint} aria-label={t("tint")} onChange={event => fxSet("tint", event.currentTarget.value)} />
                                    </div>
                                    {slider("tintStrength", t("tintStrength"), 0, 100, "%")}
                                </FxSection>
                                <FxSection title={t("details")} icon="◎">
                                    {slider("sharpen", t("sharpen"), 0, 100, "%")}
                                    {slider("blur", t("blur"), 0, 8, "px", { step: 0.2 })}
                                    {slider("vignette", t("vignette"), 0, 100, "%")}
                                    {slider("grain", t("grain"), 0, 100, "%")}
                                    <label className={cl("fx-check")}>
                                        <input type="checkbox" checked={fx.flipH} onChange={event => fxSet("flipH", event.currentTarget.checked)} />
                                        {t("flip")}
                                    </label>
                                </FxSection>
                                <FxSection title={t("creative")} icon="✦">
                                    {slider("pixelate", t("pixelate"), 0, 40, "", { offLabel: t("off") })}
                                    {slider("posterize", t("posterize"), 0, 10, "", { offLabel: t("off") })}
                                    {slider("glitch", t("glitch"), 0, 100, "%")}
                                    {slider("rgbSplit", t("rgbSplit"), 0, 30)}
                                    {slider("bloom", t("bloom"), 0, 100, "%")}
                                    {slider("sketch", t("sketch"), 0, 100, "%")}
                                    {slider("scanlines", t("scanlines"), 0, 100, "%")}
                                    {slider("sepia", t("sepia"), 0, 100, "%")}
                                    {slider("grayscale", t("grayscale"), 0, 100, "%")}
                                    {slider("invert", t("invert"), 0, 100, "%")}
                                    <div className={cl("fx-color-row")}>
                                        <span>{t("duotone")}</span>
                                        <input type="color" className={cl("fx-color")} value={fx.duoA} aria-label={t("duotone")} onChange={event => fxSet("duoA", event.currentTarget.value)} />
                                        <input type="color" className={cl("fx-color")} value={fx.duoB} aria-label={t("duotone")} onChange={event => fxSet("duoB", event.currentTarget.value)} />
                                    </div>
                                    {slider("duotone", t("duoStrength"), 0, 100, "%")}
                                    <button type="button" className={cl("fx-btn")} onClick={() => { record("seed"); setFx(current => ({ ...current, glitchSeed: Math.floor(Math.random() * 100000) })); }}>
                                        {t("reshuffle")}
                                    </button>
                                </FxSection>
                            </>
                        ) : (
                            <>
                                <div className={cl("fx-add-row")}>
                                    <button type="button" className={classes(cl("fx-btn"), cl("fx-btn-primary"))} onClick={() => addTextLayer()}>{t("addText")}</button>
                                    <button type="button" className={cl("fx-btn")} onClick={() => void pasteFromClipboardButton()}>{t("paste")}</button>
                                </div>

                                {layers.length === 0 ? (
                                    <div className={cl("fx-empty")}>
                                        <span className={cl("fx-empty-icon")} aria-hidden="true">T</span>
                                        {t("layersEmpty")}
                                    </div>
                                ) : (
                                    <div className={cl("fx-layers")}>
                                        {layers.map((layer, index) => (
                                            <button
                                                key={layer.id}
                                                type="button"
                                                className={classes(cl("fx-layer"), layer.id === selectedId && cl("fx-layer-active"))}
                                                onClick={() => setSelectedId(layer.id)}
                                            >
                                                <span className={cl("fx-layer-icon")} aria-hidden="true">{layer.kind === "text" ? "T" : "▣"}</span>
                                                {layer.kind === "text" ? (layer.text.split("\n")[0].slice(0, 26) || t("emptyText")) : `${t("image")} ${index + 1}`}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {selected?.kind === "text" ? (
                                    <div className={cl("fx-layer-editor")}>
                                        <textarea
                                            ref={textAreaRef}
                                            className={cl("fx-textarea")}
                                            value={selected.text}
                                            rows={3}
                                            placeholder={t("typeHere")}
                                            onChange={event => updateLayer(selected.id, { text: event.currentTarget.value })}
                                        />
                                        <FxSlider label={t("size")} value={Math.round(selected.size * 100)} min={2} max={45} unit="%" onChange={v => updateLayer(selected.id, { size: v / 100 })} />
                                        <div className={cl("fx-color-row")}>
                                            <span>{t("color")}</span>
                                            <input type="color" className={cl("fx-color")} value={selected.color} onChange={event => updateLayer(selected.id, { color: event.currentTarget.value })} />
                                            <span>{t("outline")}</span>
                                            <input type="color" className={cl("fx-color")} value={selected.outlineColor} onChange={event => updateLayer(selected.id, { outlineColor: event.currentTarget.value })} />
                                        </div>
                                        <select
                                            className={cl("fx-select")}
                                            value={selected.font}
                                            onChange={event => updateLayer(selected.id, { font: event.currentTarget.value as FontKey })}
                                        >
                                            {(Object.keys(FONT_STACKS) as FontKey[]).map(key => <option key={key} value={key}>{key}</option>)}
                                        </select>
                                        <div className={cl("fx-toggles")}>
                                            <label className={cl("fx-check")}><input type="checkbox" checked={selected.bold} onChange={event => updateLayer(selected.id, { bold: event.currentTarget.checked })} />{t("bold")}</label>
                                            <label className={cl("fx-check")}><input type="checkbox" checked={selected.italic} onChange={event => updateLayer(selected.id, { italic: event.currentTarget.checked })} />{t("italic")}</label>
                                            <label className={cl("fx-check")}><input type="checkbox" checked={selected.outline} onChange={event => updateLayer(selected.id, { outline: event.currentTarget.checked })} />{t("outline")}</label>
                                            <label className={cl("fx-check")}><input type="checkbox" checked={selected.shadow} onChange={event => updateLayer(selected.id, { shadow: event.currentTarget.checked })} />{t("shadow")}</label>
                                        </div>
                                        <button type="button" className={classes(cl("fx-btn"), cl("fx-btn-danger"))} onClick={() => { record("delete"); setLayers(current => current.filter(l => l.id !== selected.id)); setSelectedId(""); }}>{t("deleteText")}</button>
                                    </div>
                                ) : null}

                                {selected?.kind === "image" ? (
                                    <div className={cl("fx-layer-editor")}>
                                        <FxSlider label={t("size")} value={Math.round(selected.scale * 100)} min={5} max={100} unit="%" onChange={v => updateLayer(selected.id, { scale: v / 100 })} />
                                        <button type="button" className={classes(cl("fx-btn"), cl("fx-btn-danger"))} onClick={() => { record("delete"); setLayers(current => current.filter(l => l.id !== selected.id)); setSelectedId(""); }}>{t("deleteImage")}</button>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>

                    <div className={cl("fx-actions")}>
                        {/* Cancel goes back to the search exactly as it was left (it stays mounted underneath). */}
                        <button type="button" className={cl("fx-btn")} disabled={busy} onClick={() => onDone({ kind: "cancel" })}>{t("cancel")}</button>
                        <button type="button" className={cl("fx-btn")} disabled={busy} title={t("skipHint")} onClick={() => onDone({ kind: "original" })}>{t("skip")}</button>
                        <button type="button" className={classes(cl("fx-btn"), cl("fx-btn-primary"), cl("fx-continue"))} disabled={busy || !ready} onClick={confirm}>
                            {busy ? (progress || t("working")) : t("continue")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Discovery feed (what loads when the window opens with an empty search)
// ---------------------------------------------------------------------------

const DISCOVERY_QUERIES: Record<"AVATAR" | "BANNER", string[]> = {
    AVATAR: [
        "aesthetic profile icon", "dark aesthetic pfp", "anime profile picture", "minimal profile icon", "art profile picture",
        "soft aesthetic icon", "manga icon", "grunge pfp", "cute anime icon", "y2k icon", "retro anime pfp", "pastel icon",
        "cyberpunk pfp", "gothic aesthetic icon", "vintage art icon", "fantasy character icon", "dreamy aesthetic pfp", "black and white manga icon"
    ],
    BANNER: [
        "aesthetic banner", "dark aesthetic header", "anime scenery banner", "cinematic landscape", "fantasy landscape art",
        "minimal aesthetic header", "desktop wallpaper illustration", "scenery art banner", "night city banner", "sunset anime header",
        "pastel sky banner", "ocean aesthetic header", "space art banner", "retro anime scenery", "rain aesthetic header", "forest illustration banner"
    ]
};

// Remembered for as long as Discord stays open: recent discovery queries are
// not picked again right away, and images already shown are moved back.
const recentDiscovery: string[] = [];
const shownDiscovery = new Set<string>();

function pickDiscoveryQuery(target: SearchKind) {
    const pool = DISCOVERY_QUERIES[target === "BANNER" ? "BANNER" : "AVATAR"];
    const fresh = pool.filter(query => !recentDiscovery.includes(query));
    const choice = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
    recentDiscovery.push(choice);
    if (recentDiscovery.length > Math.floor(pool.length / 2)) recentDiscovery.shift();
    return choice;
}

function freshFirst(results: PinterestImageResult[]) {
    const fresh: PinterestImageResult[] = [];
    const seen: PinterestImageResult[] = [];
    for (const result of results) (shownDiscovery.has(imageKey(result.url)) ? seen : fresh).push(result);
    for (const result of fresh.slice(0, 16)) shownDiscovery.add(imageKey(result.url));
    if (shownDiscovery.size > 800) shownDiscovery.clear();
    return [...fresh, ...seen];
}

interface PinterestProfileModalProps extends ModalProps {
    target: Extract<SearchKind, "AVATAR" | "BANNER">;
    onEditFile?(file: File, onApplyStart?: () => void): Promise<"APPLIED" | "CANCELLED" | false>;
    onApplied?(): void;
}

export function PinterestProfileModal({ target, onEditFile, onApplied, ...props }: PinterestProfileModalProps) {
    useLocale();
    const baseRef = useRef<HTMLDivElement>(null);
    const [selecting, setSelecting] = useState(false);
    const [query, setQuery] = useState("");
    // Guards against a fast double-click (or double-tap) on a result card
    // triggering onSelectResult twice concurrently, which raced two parallel
    // fetch/hand-off attempts against the same Discord dialog/input and
    // caused the flicker + error some people saw when clicking quickly.
    const isSelectingRef = useRef(false);
    const { colorTheme, customAccent, editBeforeApply, effectsStep, appearance: modalAppearance } = settings.use(["colorTheme", "customAccent", "editBeforeApply", "effectsStep", "appearance"]);
    const [effectsRequest, setEffectsRequest] = useState<null | {
        src: string;
        filename: string;
        mediaType: string;
        resolve(outcome: EffectsOutcome): void;
    }>(null);

    useEffect(() => {
        if (baseRef.current) baseRef.current.inert = Boolean(effectsRequest);
        const frame = requestAnimationFrame(() => {
            const element = effectsRequest
                ? baseRef.current?.parentElement?.querySelector<HTMLButtonElement>(`.${cl("fx")} button`)
                : baseRef.current?.querySelector<HTMLInputElement>(`input[type="search"]`);
            element?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(frame);
    }, [effectsRequest]);

    function requestEffects(src: string, filename: string, mediaType: string) {
        return new Promise<EffectsOutcome>(resolve => {
            setEffectsRequest({
                src,
                filename,
                mediaType,
                resolve: outcome => {
                    setEffectsRequest(null);
                    resolve(outcome);
                }
            });
        });
    }
    const modalResolvedAppearance = useResolvedAppearance(modalAppearance as AppearanceSetting);
    const discoveryQuery = useMemo(() => pickDiscoveryQuery(target), [target]);

    return (
        <ModalRoot {...props} size={ModalSize.LARGE} className={classes(cl("profile-modal"), effectsRequest && cl("profile-modal-editing"))} dir={direction()} style={getPinterestFullStyle(resolvePinterestTheme(colorTheme), customAccent, modalResolvedAppearance, modalAppearance === "AUTO") as any}>
            <div ref={baseRef} className={cl("profile-base")}>
            <ModalHeader separator={false} className={cl("profile-modal-header")}>
                <div className={cl("profile-modal-heading")}>
                    <div className={cl("profile-modal-mark")} aria-hidden="true"><img className={cl("profile-modal-icon")} src={PLUGIN_ICON} alt="" draggable={false} /></div>
                    <div>
                        <div className={cl("profile-modal-title")}>Pinterest Tool</div>
                        <div className={cl("profile-modal-subtitle")}>
                            {t(target === "BANNER" ? "subtitleBanner" : "subtitleAvatar")}
                        </div>
                    </div>
                </div>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent className={cl("profile-modal-content")}>
                {selecting && !effectsRequest ? <div className={cl("preparing-overlay")} role="status" aria-live="polite"><span className={cl("preparing-spinner")}/>{t("fitting")}</div> : null}
                <PinterestBrowser
                    query={query}
                    setQuery={setQuery}
                    clearQuery={() => setQuery("")}
                    onSelectResult={async result => {
                        if (isSelectingRef.current) return;
                        isSelectingRef.current = true;
                        setSelecting(true);

                        try {
                            await selectResult(result);
                        } finally {
                            isSelectingRef.current = false;
                            setSelecting(false);
                        }

                        async function selectResult(result: PinterestImageResult) {
                        // 1. Fetch once. 2. Optional editor (images and, when the build can
                        // decode them, animated GIFs). 3. Always fit Discord's 10 MB limit.
                        let file: File | null = null;
                        try {
                            const media = await fetchResultMedia(result);
                            file = new File([media.data], media.filename, { type: media.type });
                            const isAnimated = /gif/i.test(media.type);
                            if (effectsStep && (!isAnimated || canDecodeAnimated())) {
                                const outcome = await requestEffects(media.dataUrl, media.filename, media.type);
                                if (outcome.kind === "cancel") return;
                                if (outcome.kind === "edited") file = outcome.file;
                            }
                        } catch (error) {
                            logger.error("Could not prepare that media", error);
                            setEffectsRequest(null);
                        }

                        if (!file) {
                            showToast(t("downloadFailed"), Toasts.Type.FAILURE);
                            return;
                        }

                        if (file.size > TARGET_BYTES) {
                            showToast(t("resize", { size: (file.size / 1048576).toFixed(1) }), Toasts.Type.MESSAGE);
                            try {
                                file = await fitUnderLimit(file);
                            } catch (error) {
                                showToast(error instanceof Error ? error.message : t("tooLarge"), Toasts.Type.FAILURE);
                                return;
                            }
                        }

                        if (editBeforeApply && onEditFile) {
                            try {

                                // Hand the file to Discord's own upload/editor flow. The
                                // previous flashing/disappearing editor was actually caused
                                // by handing the file to the wrong <input> (the chat
                                // attachment uploader) — now that the correct dialog input
                                // is used, Discord's real editor should open and stay open.
                                const editorResult = await onEditFile(file, () => {
                                    // Close Pinterest as soon as Discord's Apply button is pressed,
                                    // while Edit Image is still covering it. Waiting until the editor
                                    // disappears causes one frame of Pinterest to flash back onscreen.
                                    props.onClose();
                                });

                                // Keep Pinterest mounted underneath Discord's native editor.
                                // If the user presses Cancel (or closes the editor), Discord
                                // reveals this same Pinterest modal again with the search/results
                                // preserved. Only close Pinterest after a successful Apply.
                                if (editorResult === "APPLIED") {
                                    // Pinterest was already closed on the Apply click to avoid a
                                    // visible flash between Discord's editor and the profile page.
                                    return;
                                }

                                if (editorResult === "CANCELLED") {
                                    return;
                                }
                            } catch (error) {
                                logger.error("Could not open Discord image editor", error);
                            }
                        }

                        const applied = await applyProfileResult(
                            result,
                            target,
                            undefined,
                            { dataUrl: await readFileAsDataUrl(file), filename: file.name }
                        );
                        if (!applied) return;

                        props.onClose();
                        window.setTimeout(() => onApplied?.(), 90);
                        }
                    }}
                    rootClassName={classes(
                        cl("container"),
                        cl("profile-browser"),
                        target === "BANNER" && cl("profile-browser-banner")
                    )}
                    initialTarget={target}
                    initialDiscoveryQuery={discoveryQuery}
                />
            </ModalContent>
            </div>
            {effectsRequest ? (
                <EffectsEditor
                    src={effectsRequest.src}
                    filename={effectsRequest.filename}
                    mediaType={effectsRequest.mediaType}
                    target={target}
                    onDone={effectsRequest.resolve}
                />
            ) : null}
        </ModalRoot>
    );
}
