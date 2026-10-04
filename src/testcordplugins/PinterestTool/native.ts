/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";

import { hasBannerIntent, hasProfileIntent, normalizeQuery, rankResults, shapeFits } from "./searchRanking";

const BASE_URL = "https://www.pinterest.com";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const USER_AGENT = "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";
const MEDIA_HOSTS = new Set(["i.pinimg.com", "s.pinimg.com"]);

// Pinterest's CDN, plus DeviantArt's for favorites saved by older versions.
function isAllowedMediaHost(hostname: string) {
    const host = hostname.toLowerCase();
    return MEDIA_HOSTS.has(host)
        || host === "wixmp.com" || host.endsWith(".wixmp.com")
        || host === "deviantart.net" || host.endsWith(".deviantart.net");
}

interface PinterestGuide {
    label: string;
    query: string;
}

// "DEVIANTART" only appears on favorites saved by older versions.
type ResultSource = "PINTEREST" | "DEVIANTART";

interface SearchExtras {
    /** The user's OWN Pinterest session cookie (optional). Never logged. */
    pinterestCookie?: string;
}

interface PinterestImageResult {
    id: string;
    title: string;
    description: string;
    url: string;
    width: number;
    height: number;
    dominantColor: string | null;
    pinterestUrl: string | null;
    isGif: boolean;
    // Lightweight preview for the grid (the full-size `url` is only needed on apply).
    thumbUrl?: string;
    fallbackUrl?: string;
    source?: ResultSource;
    author?: string;
    authorUrl?: string | null;
}

interface PinterestSearchPayload {
    query: string;
    guides: PinterestGuide[];
    results: PinterestImageResult[];
    bookmark: string[] | null;
    notice?: string;
    failedSources?: ResultSource[];
}

type MediaFilter = "ALL" | "GIFS" | "STATIC";
type SearchTarget = "IMAGE" | "AVATAR" | "BANNER";

interface PinterestSearchImage {
    width?: number;
    height?: number;
    url?: string;
}

interface PinterestSearchPin {
    id?: string;
    type?: string;
    title?: string;
    grid_title?: string;
    description?: string;
    dominant_color?: string;
    link?: string | null;
    images?: Record<string, PinterestSearchImage>;
    videos?: unknown;
    video_list?: unknown;
}

interface PinterestGuideEntry {
    type?: string;
    action?: {
        search_query?: string;
    };
    display?: {
        display_text?: string;
    };
}

interface PinterestSearchJson {
    resource?: {
        options?: {
            bookmarks?: string[] | string;
        };
    };
    resource_response?: {
        // Pinterest usually sends this cursor as a single string, not an array.
        bookmark?: string[] | string;
        data?: {
            results?: PinterestSearchPin[];
            guides?: PinterestGuideEntry[];
        };
    };
}

function getSetCookie(response: Response) {
    const headers = response.headers as Headers & {
        getSetCookie?: () => string[];
    };

    const values = headers.getSetCookie?.() ?? [];
    if (values.length) return values;

    const merged = response.headers.get("set-cookie");
    if (!merged) return [];

    return merged.split(/,(?=[^;,]+=)/g);
}

// v15.5: Pinterest's own web client asks for 25 pins per request. The stable
// build asked for up to 96-100 at once, which is not a size Pinterest's site uses.
const PINTEREST_PAGE_SIZE = 25;

// v15.5: read the pagination cursor from every place Pinterest puts it, and
// accept both a single string and an array. "-end-" is Pinterest's own marker
// for "no more results". The stable build only accepted an array under
// resource_response.bookmark, so a string cursor could be lost or re-sent in a
// form Pinterest does not understand.
function toBookmarkList(value: unknown): string[] {
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return list.filter((item): item is string => typeof item === "string" && item.length > 0 && item !== "-end-");
}

function extractBookmarks(json: PinterestSearchJson): string[] | null {
    // An explicit end marker takes precedence over echoed request options.
    const marker = json.resource_response?.bookmark;
    if (marker === "-end-" || (Array.isArray(marker) && marker.includes("-end-"))) return null;
    const fromResponse = toBookmarkList(json.resource_response?.bookmark);
    if (fromResponse.length) return fromResponse;

    const fromOptions = toBookmarkList(json.resource?.options?.bookmarks);
    return fromOptions.length ? fromOptions : null;
}

function buildSearchUrl(query: string, pageSize: number, bookmarks: string[] = []) {
    const endpoint = new URL("/resource/BaseSearchResource/get/", BASE_URL);
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`;
    const data = {
        options: {
            appliedProductFilters: "---",
            auto_correction_disabled: false,
            bookmarks,
            page_size: pageSize,
            query,
            redux_normalize_feed: true,
            rs: "typed",
            scope: "pins",
            source_url: sourceUrl
        },
        context: {}
    };

    endpoint.searchParams.set("source_url", sourceUrl);
    endpoint.searchParams.set("data", JSON.stringify(data));
    endpoint.searchParams.set("_", `${Date.now()}`);

    return endpoint.toString();
}

function normalizeGuide(entry: PinterestGuideEntry): PinterestGuide | null {
    const label = entry.display?.display_text?.trim();
    const query = entry.action?.search_query?.trim();

    if (!label || !query) return null;
    return { label, query };
}

function isGifUrl(rawUrl: string) {
    try {
        return new URL(rawUrl).pathname.toLowerCase().endsWith(".gif");
    } catch {
        return /\.gif(?:$|\?)/i.test(rawUrl);
    }
}

function normalizePin(entry: PinterestSearchPin): PinterestImageResult | null {
    if (entry.type !== "pin") return null;

    const image = entry.images?.orig ?? entry.images?.["736x"] ?? entry.images?.["474x"] ?? entry.images?.["236x"];
    if (!image?.url || !image.width || !image.height || !entry.id) return null;

    const isGif = isGifUrl(image.url);
    if (!isGif && (entry.videos || entry.video_list)) return null;

    return {
        id: entry.id,
        title: entry.title?.trim() || entry.grid_title?.trim() || "",
        description: entry.description?.trim() || "",
        url: image.url,
        width: image.width,
        height: image.height,
        dominantColor: entry.dominant_color ?? null,
        pinterestUrl: `${BASE_URL}/pin/${entry.id}/`,
        isGif,
        thumbUrl: entry.images?.["474x"]?.url ?? entry.images?.["736x"]?.url ?? image.url,
        // Some pins have no downloadable original; the 736 px copy is the fallback.
        fallbackUrl: entry.images?.["736x"]?.url && entry.images["736x"].url !== image.url ? entry.images["736x"].url : undefined,
        source: "PINTEREST"
    };
}

function isSearchPayload(value: unknown): value is PinterestSearchJson {
    return typeof value === "object" && value !== null;
}

function getSearchQuery(query: string, mediaFilter: MediaFilter, target: SearchTarget) {
    let finalQuery = query.trim();

    if (target === "AVATAR" && !hasProfileIntent(finalQuery)) {
        finalQuery = `${finalQuery} pfp icon`;
    } else if (target === "BANNER" && !hasBannerIntent(finalQuery)) {
        // "wallpaper" on Pinterest mostly returns tall phone wallpapers, which
        // crop badly into a 5:2 profile banner. "banner" surfaces wide
        // header-style pins for the same subject.
        finalQuery = `${finalQuery} banner`;
    }

    if (mediaFilter === "GIFS" && !/\b(gif|animated)\b/i.test(finalQuery)) {
        finalQuery = `${finalQuery} animated gif`;
    }

    return finalQuery;
}

function addSearchVariation(query: string, target: SearchTarget, mediaFilter: MediaFilter) {
    const imageVariants = mediaFilter === "GIFS"
        ? ["loop", "animation", "animated art", "motion", "edit", "reaction"]
        : ["aesthetic", "fanart", "art", "edit", "illustration", "photography"];

    const avatarVariants = mediaFilter === "GIFS"
        ? ["loop", "animated icon", "anime edit", "motion", "reaction", "scene", "edit"]
        : ["aesthetic", "fanart", "icon edit", "dark aesthetic", "portrait art", "minimal", "anime icon"];

    const bannerVariants = mediaFilter === "GIFS"
        ? ["loop", "animated wallpaper", "cinematic loop", "anime scene", "motion background", "scenery loop", "animated art"]
        : ["header", "aesthetic", "desktop wallpaper", "dark aesthetic", "cinematic", "scenery", "landscape", "widescreen"];

    const variants = target === "BANNER"
        ? bannerVariants
        : target === "AVATAR"
            ? avatarVariants
            : imageVariants;

    // Skip variations whose words are already in the query ("icon edit" on "... pfp icon").
    const words = new Set(query.toLowerCase().split(/\s+/));
    const useful = variants.filter(variant => variant.split(" ").some(word => !words.has(word)) && !variant.split(" ").some(word => words.has(word)));
    const pool = useful.length ? useful : variants;
    return `${query} ${pool[Math.floor(Math.random() * pool.length)]}`;
}

// v15.5: Pinterest session reuse. The stable build fetched the Pinterest
// homepage for new cookies on every request, so each Next click continued a
// cursor (bookmark) from a different session than the one that created it.
// Keeping one session also removes one network round-trip per request.
const SESSION_TTL_MS = 15 * 60 * 1000;
let cachedSession: { cookie: string; createdAt: number; } | null = null;
let sessionRequest: Promise<string> | null = null;

async function fetchWithin(url: string | URL, init: RequestInit = {}, deadline = Date.now() + 12_000) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Search timed out.");
    return fetch(url, { ...init, signal: AbortSignal.timeout(Math.min(remaining, 12_000)) });
}

// The optional user-supplied cookie is only ever sent to pinterest.com as the
// Cookie header. It is stripped of anything that could break out of a header.
function sanitizeCookie(raw: string | undefined) {
    if (!raw) return "";
    // Only the first line is used; anything after a line break is dropped, never merged.
    const cleaned = raw
        .trim()
        .split(/[\r\n]/, 1)[0]
        .replace(/^\s*cookie\s*:\s*/i, "")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim();
    return cleaned.length > 0 && cleaned.length <= 8192 && /^[\x20-\x7e]+$/.test(cleaned) ? cleaned : "";
}

function getCsrfToken(cookie: string) {
    return /(?:^|;\s*)csrftoken=([^;]+)/i.exec(cookie)?.[1] ?? "";
}

async function getSessionCookie() {
    if (cachedSession && Date.now() - cachedSession.createdAt < SESSION_TTL_MS) {
        return cachedSession.cookie;
    }

    if (sessionRequest) return sessionRequest;
    sessionRequest = initializeSession();
    try { return await sessionRequest; } finally { sessionRequest = null; }
}

async function initializeSession() {
    const homeResponse = await fetchWithin(BASE_URL, {
        headers: {
            "User-Agent": USER_AGENT
        }
    });

    if (!homeResponse.ok) throw new Error("Could not initialize Pinterest search.");

    const cookie = getSetCookie(homeResponse)
        .map(value => value.split(";", 1)[0])
        .join("; ");

    if (!cookie) throw new Error("Could not initialize Pinterest cookies.");

    cachedSession = { cookie, createdAt: Date.now() };
    return cookie;
}

async function searchPinterest(
    rawQuery: string,
    rawLimit = 30,
    mediaFilter: MediaFilter = "ALL",
    bookmarks: string[] = [],
    target: SearchTarget = "IMAGE",
    randomize = true,
    extras: SearchExtras = {}
): Promise<PinterestSearchPayload> {
    const deadline = Date.now() + 14_000;
    const baseQuery = getSearchQuery(normalizeQuery(rawQuery), mediaFilter, target);
    // Fresh searches keep the original Pinterest Tool behaviour: add one small
    // random relevance/style variation so repeating the same subject can surface
    // a different useful set. Pagination never re-randomizes; it keeps the exact
    // query returned by the first request so Next/Previous stay on the same feed.
    // Normalise cursors coming back from the UI (older state may hold a string).
    bookmarks = toBookmarkList(bookmarks);
    // randomize=false keeps the query exactly as typed (better relevance for precise searches).
    const query = bookmarks.length || !randomize ? baseQuery : addSearchVariation(baseQuery, target, mediaFilter);
    const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30));

    if (!query) throw new Error("Search query is required.");

    // v15.5: reuse one Pinterest session instead of opening a new one on every
    // search and every Next click (see getSessionCookie).
    const customCookie = sanitizeCookie(extras.pinterestCookie);
    const cookieHeader = customCookie || await getSessionCookie();
    const csrfToken = customCookie ? getCsrfToken(customCookie) : "";

    // Pinterest frequently represents animated pins as video previews instead of
    // direct .gif media. For GIF mode, walk a few Pinterest result pages inside a
    // single UI request so one sparse backend page does not look like the search
    // randomly failed. Static image searches stay single-request and fast.
    const desiredResultCount = mediaFilter === "GIFS"
        // Return as soon as one visible plugin page is filled. v15.3 tried to
        // pre-fill several future pages (24 avatars / 16 banners), which made GIF
        // searches look frozen while Pinterest was still being scanned. Next loads
        // the following page on demand, so one page is the right latency/coverage balance.
        ? Math.min(limit, target === "BANNER" ? 4 : 8)
        : limit;
    // Two feeds run in parallel (see searchFeeds), so each feed reads one page,
    // or two for sparse direct-GIF results.
    const maxRequests = mediaFilter === "GIFS" ? 2 : 1;
    const desiredWide = Math.min(desiredResultCount, 8);

    const collected: PinterestImageResult[] = [];
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    let guides: PinterestGuide[] = [];
    let nextBookmarks = bookmarks;
    let returnedBookmark: string[] | null = bookmarks.length ? bookmarks : null;
    let previousBookmarkKey = "";

    for (let requestIndex = 0; requestIndex < maxRequests; requestIndex++) {
        const response = await fetchWithin(buildSearchUrl(query, Math.min(limit, PINTEREST_PAGE_SIZE), nextBookmarks), {
            headers: {
                "User-Agent": USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "x-pinterest-pws-handler": "www/pin/[id].js",
                Cookie: cookieHeader,
                ...(csrfToken ? { "X-CSRFToken": csrfToken } : {})
            }
        }, deadline);

        if (!response.ok) {
            // Drop the cached anonymous session so the next search starts with a fresh one.
            if (!customCookie) cachedSession = null;
            throw new Error(customCookie && (response.status === 401 || response.status === 403)
                ? `Pinterest rejected your session cookie (HTTP ${response.status}). It may have expired.`
                : `Pinterest search failed with HTTP ${response.status}.`);
        }

        const json = await response.json() as unknown;
        if (!isSearchPayload(json)) throw new Error("Pinterest returned an invalid response.");

        if (!guides.length) {
            guides = (json.resource_response?.data?.guides ?? [])
                .map(normalizeGuide)
                .filter((guide): guide is PinterestGuide => guide !== null)
                .slice(0, 8);
        }

        const normalized = (json.resource_response?.data?.results ?? [])
            .map(normalizePin)
            .filter((pin): pin is PinterestImageResult => pin !== null)
            .filter(pin => mediaFilter !== "STATIC" || !pin.isGif)
            .filter(pin => mediaFilter !== "GIFS" || pin.isGif);

        for (const pin of normalized) {
            if (seenIds.has(pin.id) || seenUrls.has(pin.url)) continue;
            seenIds.add(pin.id);
            seenUrls.add(pin.url);
            collected.push(pin);
        }

        returnedBookmark = extractBookmarks(json);
        // A cursor identical to the one just sent cannot advance the feed.
        if (returnedBookmark && JSON.stringify(returnedBookmark) === JSON.stringify(nextBookmarks)) {
            returnedBookmark = null;
        }

        const enough = mediaFilter !== "GIFS" && target === "BANNER"
            ? collected.filter(pin => shapeFits(pin, target)).length >= desiredWide
            : collected.length >= desiredResultCount;
        if (enough || !returnedBookmark?.length || Date.now() >= deadline - 800) break;

        const bookmarkKey = JSON.stringify(returnedBookmark);
        if (bookmarkKey === previousBookmarkKey) {
            // Defensive stop for a Pinterest cursor that does not advance.
            returnedBookmark = null;
            break;
        }

        previousBookmarkKey = bookmarkKey;
        nextBookmarks = returnedBookmark;
    }

    return {
        query,
        guides,
        results: rankResults([collected], rawQuery, target),
        bookmark: returnedBookmark
    };
}

// ---------------------------------------------------------------------------
// Two Pinterest feeds per search, for variety
// ---------------------------------------------------------------------------
// Every search reads two feeds at the same time: the query as typed (plus the
// avatar / banner / GIF hint) and a style variation of it ("aesthetic",
// "header", ...). Their results are ranked together and de-duplicated, which
// gives a wider mix than one feed without taking longer. The UI's opaque
// cursor carries one entry per feed that still has more pages:
//   "F|" + encodeURIComponent(JSON.stringify({ q: feed query, b: bookmarks }))

interface Feed { q: string; b: string[]; }

function encodeFeeds(feeds: Feed[]) {
    const list = feeds.filter(feed => feed.b.length).map(feed => `F|${encodeURIComponent(JSON.stringify(feed))}`);
    return list.length ? list : null;
}

function decodeFeeds(bookmarks: string[]): Feed[] | null {
    const feeds: Feed[] = [];
    for (const item of bookmarks) {
        if (!item.startsWith("F|")) return null;
        try {
            const feed = JSON.parse(decodeURIComponent(item.slice(2))) as Feed;
            if (typeof feed?.q === "string" && Array.isArray(feed.b)) feeds.push({ q: feed.q, b: toBookmarkList(feed.b) });
        } catch {
            return null;
        }
    }
    return feeds;
}

async function searchFeeds(
    rawQuery: string,
    mediaFilter: MediaFilter,
    bookmarks: string[],
    target: SearchTarget,
    randomize: boolean,
    extras: SearchExtras
): Promise<PinterestSearchPayload> {
    const plain = normalizeQuery(rawQuery);
    if (!plain) throw new Error("Search query is required.");
    const incoming = toBookmarkList(bookmarks);
    let feeds = incoming.length ? decodeFeeds(incoming) : null;

    if (!feeds) {
        const base = getSearchQuery(plain, mediaFilter, target);
        if (incoming.length) {
            // A cursor from an older version: continue it as a single feed.
            feeds = [{ q: base, b: incoming }];
        } else {
            const first = randomize ? addSearchVariation(base, target, mediaFilter) : base;
            let second = addSearchVariation(base, target, mediaFilter);
            for (let tries = 0; second === first && tries < 6; tries++) second = addSearchVariation(base, target, mediaFilter);
            feeds = [{ q: first, b: [] }, { q: second, b: [] }];
        }
    }
    if (!feeds.length) return { query: plain, guides: [], results: [], bookmark: null };

    const outcomes = await Promise.allSettled(feeds.map(feed =>
        // The feed query already carries its hints and variation.
        searchPinterest(feed.q, PINTEREST_PAGE_SIZE, mediaFilter, feed.b, target, false, extras)));

    const ok = outcomes.filter((o): o is PromiseFulfilledResult<PinterestSearchPayload> => o.status === "fulfilled").map(o => o.value);
    if (!ok.length) {
        const failure = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
        throw failure?.reason instanceof Error ? failure.reason : new Error("Pinterest search failed.");
    }

    const next: Feed[] = feeds.map((feed, index) => {
        const outcome = outcomes[index];
        // A feed that failed keeps its cursor so the next page retries it.
        if (outcome.status === "rejected") return feed;
        return { q: feed.q, b: outcome.value.bookmark ?? [] };
    });

    const guideSeen = new Set<string>();
    return {
        query: plain,
        guides: ok.flatMap(payload => payload.guides).filter(guide => {
            const key = guide.label.toLowerCase();
            if (guideSeen.has(key)) return false;
            guideSeen.add(key);
            return true;
        }).slice(0, 8),
        results: rankResults(ok.map(payload => payload.results), plain, target),
        bookmark: encodeFeeds(next)
    };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// Repeating a search (switching tabs, going back) is answered from memory.
const SEARCH_CACHE_TTL = 3 * 60 * 1000;
const pendingSearches = new Map<string, Promise<PinterestSearchPayload>>();
const searchCache = new Map<string, { at: number; payload: PinterestSearchPayload; }>();

function cacheGet(key: string) {
    const hit = searchCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > SEARCH_CACHE_TTL) {
        searchCache.delete(key);
        return null;
    }
    searchCache.delete(key);
    searchCache.set(key, hit);
    return hit.payload;
}

function cacheSet(key: string, payload: PinterestSearchPayload) {
    searchCache.set(key, { at: Date.now(), payload });
    if (searchCache.size > 64) searchCache.delete(searchCache.keys().next().value!);
}

export async function search(
    _: unknown,
    rawQuery: string,
    _limit = 25,
    mediaFilter: MediaFilter = "ALL",
    bookmarks: string[] = [],
    target: SearchTarget = "IMAGE",
    randomize = false,
    extras: SearchExtras = {}
): Promise<PinterestSearchPayload> {
    const safeExtras: SearchExtras = { pinterestCookie: typeof extras?.pinterestCookie === "string" ? extras.pinterestCookie : "" };
    const cleanQuery = normalizeQuery(rawQuery);
    if (!cleanQuery) throw new Error("Search query is required.");

    // First pages always include a fresh variation feed, so only follow-up
    // pages (fixed cursors) are cached; identical requests in flight are shared.
    const cursor = toBookmarkList(bookmarks);
    const cacheKey = cursor.length ? JSON.stringify([mediaFilter, target, cursor,
        createHash("sha256").update(safeExtras.pinterestCookie ?? "").digest("hex")]) : "";
    const cached = cacheKey ? cacheGet(cacheKey) : null;
    if (cached) return cached;
    if (cacheKey && pendingSearches.has(cacheKey)) return pendingSearches.get(cacheKey)!;

    const request = searchFeeds(cleanQuery, mediaFilter, cursor, target, randomize, safeExtras);
    if (cacheKey) pendingSearches.set(cacheKey, request);
    try {
        const payload = await request;
        if (cacheKey) cacheSet(cacheKey, payload);
        return payload;
    } finally {
        if (cacheKey) pendingSearches.delete(cacheKey);
    }
}

/** Opens the anonymous Pinterest session ahead of time so the first search is quicker. */
export async function warmUp() {
    try {
        await getSessionCookie();
    } catch {
        // The real search reports any problem.
    }
}

export async function fetchMedia(_: unknown, rawUrl: string) {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error("Invalid media URL.");
    }
    if (url.protocol !== "https:" || !isAllowedMediaHost(url.hostname)) throw new Error("Invalid media URL.");

    let response: Response | null = null;
    for (let redirects = 0; redirects < 4; redirects++) {
        response = await fetchWithin(url, {
            headers: { Accept: "image/avif,image/webp,image/gif,image/png,image/jpeg", "User-Agent": BROWSER_USER_AGENT },
            redirect: "manual"
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        if (!location) throw new Error("Image redirect is missing its destination.");
        url = new URL(location, url);
        if (url.protocol !== "https:" || !isAllowedMediaHost(url.hostname)) throw new Error("Invalid image redirect.");
        response = null;
    }

    if (!response?.ok) throw new Error(`Failed to fetch media with HTTP ${response?.status ?? "redirect"}.`);

    const contentType = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    if (!/^image\/(?:png|jpeg|gif|webp|avif)$/.test(contentType)) throw new Error("That link is not a supported image.");
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 60 * 1024 * 1024) throw new Error("That image is too large to download.");
    const pathname = url.pathname.split("/").pop() || "pinterest-image";
    const filename = pathname.includes(".") ? pathname : `${pathname}.${contentType.includes("gif") ? "gif" : "jpg"}`;
    const data = await response.arrayBuffer();
    if (data.byteLength > 60 * 1024 * 1024) throw new Error("That image is too large to download.");
    const dataUrl = `data:${contentType};base64,${Buffer.from(data).toString("base64")}`;

    return {
        data,
        dataUrl,
        type: contentType,
        filename
    };
}
