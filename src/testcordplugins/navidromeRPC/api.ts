/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";

import { settings } from ".";

const SALT = "testcord";
const CLIENT = "Testcord";
const API_VERSION = "1.16.1";

/** Discord application the activity is registered under. */
export const APPLICATION_ID = "1396969056136986775";

const PASSWORD_KEY = "NavidromeRPC_password";

export interface NowPlaying {
    id: string;
    title: string;
    artists: string[];
    album: string;
    albumArtist: string;
    duration: number;
    minutesAgo: number;
    coverId: string | null;
}

export async function getPassword() {
    return (await DataStore.get(PASSWORD_KEY)) ?? "";
}

export function setPassword(password: string) {
    return DataStore.set(PASSWORD_KEY, password);
}

function hex(bytes: Uint8Array) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function authParam() {
    const password = await getPassword();
    // Subsonic's "enc" scheme, which keeps the raw password off the wire. Token auth would
    // need MD5, and this only talks to a server the user already trusts with their music.
    const bytes = new TextEncoder().encode(password);
    return `enc:${hex(bytes)}`;
}

function endpoint(path: string) {
    return new URL(`/rest${path}`, settings.plain.serverURL);
}

async function call<T>(path: string): Promise<T> {
    const url = endpoint(path);
    url.search = new URLSearchParams({
        u: settings.plain.username,
        p: await authParam(),
        v: API_VERSION,
        c: CLIENT,
        f: "json"
    }).toString();

    const response = await fetch(url.href);
    if (!response.ok) throw new Error(`Navidrome said ${response.status}`);

    const body = await response.json() as { "subsonic-response": { status: string; error?: { message: string } } };
    if (body["subsonic-response"].status === "failed") {
        throw new Error(body["subsonic-response"].error?.message ?? "unknown error");
    }

    return body["subsonic-response"] as T;
}

interface RawEntry {
    id: string;
    username: string;
    title: string;
    duration: number;
    minutesAgo: number;
    album: string;
    albumId: string;
    artists?: { name: string }[];
    albumArtists?: { name: string }[];
}

export async function getNowPlaying(): Promise<NowPlaying | null> {
    const response = await call<{ nowPlaying?: { entry?: RawEntry[] } }>("/getNowPlaying");
    const mine = (response.nowPlaying?.entry ?? []).find(entry => entry.username === settings.plain.username);
    if (!mine) return null;

    return {
        id: mine.id,
        title: mine.title,
        artists: (mine.artists ?? []).map(artist => artist.name),
        album: mine.album,
        albumArtist: (mine.albumArtists ?? [])[0]?.name ?? "",
        duration: mine.duration,
        minutesAgo: mine.minutesAgo,
        coverId: mine.albumId ?? null
    };
}

export async function coverArtUrl(coverId: string) {
    const url = endpoint("/getCoverArt");
    url.search = new URLSearchParams({
        u: settings.plain.username,
        p: await authParam(),
        v: API_VERSION,
        c: CLIENT,
        f: "json",
        id: coverId,
        size: "512"
    }).toString();

    return url.href;
}

export async function ping() {
    await call("/ping");
}
