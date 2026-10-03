/* SPDX-License-Identifier: GPL-3.0-or-later */
import { LocaleStore, useStateFromStores } from "@webpack/common";

// The interface is always in English, whatever Discord's language is. Partial
// translations mixed languages on one screen; one language never breaks.
// (index.tsx still reads Discord's own translated labels to find its buttons.)
const en = {
    search: "Search", searching: "Searching…", images: "Images", favorites: "Favorites", avatar: "Profile icons", banner: "Banners", image: "Image", clear: "Clear",
    previous: "Previous", next: "Next", select: "Select", preview: "Preview", retry: "Try again",
    customize: "Appearance", theme: "Accent", auto: "Like Discord", dark: "Dark", light: "Light",
    sort: "Sort", relevance: "Recommended", quality: "Resolution", shape: "Best fit", round: "Round preview",
    page: "Page {page}", pageOf: "Page {page} of {total}", results: "{count} results", iconResults: "Find your next profile icon", bannerResults: "Find your next banner", imageResults: "Discover images",
    subtitleAvatar: "Find an icon that feels like you.", subtitleBanner: "Give your profile a new view.",
    placeholder: "Search a character, artist or style…", mediaType: "Media type", empty: "No images found", emptyGifs: "No direct GIFs found", emptyCopy: "Try fewer words or a different style.",
    gifCopy: "Only real GIF files appear here. Video previews are excluded.", favoritesEmpty: "Your collection starts here", favoritesCopy: "Save images with the heart. They stay here for your next visit.",
    addFavorite: "Save to favorites", removeFavorite: "Remove from favorites", searchFailed: "Pinterest could not complete the search.",
    errorHint: "Check your connection and try again in a moment.", loading: "Finding images…", moreLoading: "Loading more…",
    previewUnavailable: "Preview unavailable", lowRes: "Small image", by: "By {author}",
    options: "Image options", copyLink: "Copy image link", copied: "Image link copied.", saveImage: "Download image", openSource: "Open {source}",
    customColor: "Custom color", hue: "Hue", copyHex: "Copy HEX color", pickColor: "Pick a color from your screen",
    editor: "Image editor", color: "Color",
    editorHint: "Tip: drag text to move it · Ctrl+V pastes · You can crop in Discord next",
    animatedFrames: "Animated GIF · {count} frames", off: "off", original: "Original", pixelate: "Pixelate", posterize: "Posterize", glitch: "Glitch",
    rgbSplit: "RGB split", bloom: "Glow", sketch: "Sketch outline", sharpen: "Sharpen", blur: "Blur", vignette: "Vignette",
    grain: "Film grain", scanlines: "Scanlines", flip: "Flip horizontally", hueShift: "Hue shift", saturation: "Saturation",
    brightness: "Brightness", contrast: "Contrast", sepia: "Sepia", grayscale: "Black & white", invert: "Invert",
    tint: "Tint", tintStrength: "Tint strength", duotone: "Duotone", duoStrength: "Duotone strength", reshuffle: "New glitch & grain pattern",
    addText: "+ Add text", paste: "Paste (Ctrl+V)", layersEmpty: "Add text or paste an image with Ctrl+V. Drag a layer on the preview to move it.",
    emptyText: "(empty)", typeHere: "Type here…", size: "Size", outline: "Outline", bold: "Bold", italic: "Italic", shadow: "Shadow",
    deleteText: "Delete text", deleteImage: "Delete image", back: "Back", reset: "Reset", skip: "Skip", continue: "Continue", working: "Working…",
    downloadFailed: "Could not download this image. Try another one.", saveFailed: "Could not save this image.",
    favoritesFailed: "Could not save favorites.", applyFailed: "Could not apply this image. Its link was copied.",
    editorFailed: "Could not open this image in the editor.", addImageFailed: "Could not add this image.",
    clipboardEmpty: "The clipboard is empty.", clipboardHint: "Press Ctrl+V in this editor to paste an image or text.",
    editFailed: "Could not apply these edits. Using the original image.", colorFailed: "The screen color picker is unavailable in this Discord build.",
    resize: "Preparing {size} MB for Discord…", tooLarge: "This file is too large for Discord.",
    shortcuts: "Enter to search · / to focus search", colorCopied: "Color copied.",
    editTitle: "Edit your image", filters: "Filters", adjust: "Adjust", text: "Text", lightColor: "Light & color", details: "Details", creative: "Creative effects",
    pNoir: "Noir", pVivid: "Vivid", pGlitch: "Glitch", pVhs: "VHS", pPixel: "Pixel", pNeon: "Neon", pSketch: "Sketch", pPoster: "Poster",
    pDuotone: "Duotone", pDream: "Dream", pFilm: "Film", pCyber: "Cyber",
            cancel: "Cancel", skipHint: "Use the image without edits", undo: "Undo", redo: "Redo", recentSearches: "Recent searches", related: "Related searches", clearRecent: "Clear recent searches", fitting: "Preparing image…"
};

type Key = keyof typeof en;

/** Re-renders when Discord's language changes (kept so labels never go stale). */
export function useLocale() {
    return useStateFromStores(LocaleStore ? [LocaleStore] : [], () => LocaleStore?.locale ?? "en-US");
}

export function t(key: Key, values: Record<string, string | number> = {}) {
    return en[key].replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}

export function direction() {
    return "ltr" as "ltr" | "rtl";
}
