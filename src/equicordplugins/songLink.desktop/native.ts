/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RendererSettings } from "@main/settings";

type SongLinkResult = {
    info?: {
        title: string;
        artist: string;
    };
    links: {
        [platform: string]: {
            url: string;
            nativeUri?: string;
        };
    };
};

export async function getTrackData(_, trackURL: string): Promise<SongLinkResult> {
    const url = new URL(`https://song.link/${trackURL}`);
    url.searchParams.set("userCountry", RendererSettings.store.plugins?.SongLink?.userCountry || "US");
    const res = await fetch(url.toString(), { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Song.link returned ${res.status}`);

    const json = (await res.text()).match(/__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)?.[1];
    if (!json) throw new Error("Song.link page had no data");

    const pageData = JSON.parse(json).props?.pageProps?.pageData;
    const sections: any[] = pageData?.sections ?? [];
    const links: SongLinkResult["links"] = {};
    for (const section of sections) {
        for (const link of section.links ?? []) {
            if (link.url) links[link.platform] = { url: link.url, nativeUri: link.nativeAppUriDesktop };
        }
    }
    if (!Object.keys(links).length) throw new Error("Song.link found no links for this track");

    const { title, artistName } = pageData.entityData ?? {};
    return { info: title ? { title, artist: artistName } : undefined, links };
}
