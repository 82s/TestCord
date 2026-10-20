/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import { isPluginEnabled } from "@api/PluginManager";
import OpenInAppPlugin from "@plugins/openInApp";
import { findByProps, findByPropsLazy, proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";

import { settings } from "../settings";

export interface Track {
    id: string;
    name: string;
    duration: number;
    isLocal: boolean;
    album: {
        id: string;
        name: string;
        image: {
            height: number;
            width: number;
            url: string;
        };
    };
    artists: {
        id: string;
        href: string;
        name: string;
        type: string;
        uri: string;
    }[];
}

interface PlayerState {
    accountId: string;
    track: Track | null;
    volumePercent: number,
    isPlaying: boolean,
    repeat: boolean,
    position: number,
    context?: any;
    device?: Device;

    // added by patch
    actual_repeat: Repeat;
    shuffle: boolean;
}

interface Device {
    id: string;
    is_active: boolean;
}

type Repeat = "off" | "track" | "context";
const RESYNC_INTERVAL_MS = 8000;
const RESYNC_THRESHOLD_MS = 700;
const SEEK_FADE_COMPENSATION_MS = 300;
const SEEK_HOLD_TIMEOUT_MS = 3000;
const SEEK_LAND_BEFORE_MS = SEEK_FADE_COMPENSATION_MS + 300;
const SEEK_LAND_AFTER_MS = 1500;

// Don't wanna run before Flux and Dispatcher are ready!
export const SpotifyStore = proxyLazyWebpack(() => {
    // For some reason ts hates extends Flux.Store
    const { Store } = Flux;

    const SpotifySocket = findByProps("getActiveSocketAndDevice");
    const SpotifyAPI = findByPropsLazy("vcSpotifyMarker");

    const API_BASE = "https://api.spotify.com/v1/me/player";

    class SpotifyStore extends Store {
        public mPosition = 0;
        public _start = 0;

        public track: Track | null = null;
        public device: Device | null = null;
        public isPlaying = false;
        public repeat: Repeat = "off";
        public shuffle = false;
        public volume = 0;

        public isSettingPosition = false;
        public seekEpoch = 0;
        private lineHold: { startMs: number; expires: number; landed: boolean; } | null = null;

        private _resyncTimer: ReturnType<typeof setInterval> | null = null;
        private _resyncing = false;

        public startResync() {
            if (this._resyncTimer) return;
            this._resyncTimer = setInterval(() => void this.resync(), RESYNC_INTERVAL_MS);
        }

        public stopResync() {
            if (!this._resyncTimer) return;
            clearInterval(this._resyncTimer);
            this._resyncTimer = null;
        }

        public async resync() {
            if (this._resyncing || !this.isPlaying || !this.track || !this.device?.is_active || this.isSettingPosition) return;

            this._resyncing = true;
            try {
                const { socket } = SpotifySocket.getActiveSocketAndDevice();
                const sentAt = Date.now();
                const res = await SpotifyAPI.get(socket.accountId, socket.accessToken, { url: API_BASE });
                const receivedAt = Date.now();

                const body = res?.body;
                if (!body || typeof body.progress_ms !== "number" || body.is_playing !== true) return;

                if (body.item?.id && this.track?.id && body.item.id !== this.track.id) return;
                if (!this.isPlaying || this.isSettingPosition) return;

                const actual = body.progress_ms + (receivedAt - sentAt) / 2;
                if (Math.abs(actual - this.position) > RESYNC_THRESHOLD_MS) {
                    this.position = actual;
                    this.emitChange();
                }
            } finally {
                this._resyncing = false;
            }
        }

        public openExternal(path: string) {
            const url = settings.store.useSpotifyUris || isPluginEnabled(OpenInAppPlugin.name)
                ? "spotify:" + path.replaceAll("/", (_, idx) => idx === 0 ? "" : ":")
                : "https://open.spotify.com" + path;

            VencordNative.native.openExternal(url);
        }

        // Need to keep track of this manually
        public get position(): number {
            let pos = this.mPosition;
            if (this.isPlaying) {
                pos += Date.now() - this._start;
            }
            return pos;
        }

        public set position(p: number) {
            this.mPosition = p;
            this._start = Date.now();
        }

        prev() {
            this._req("post", "/previous");
        }

        next() {
            this._req("post", "/next");
        }

        setVolume(percent: number) {
            this._req("put", "/volume", {
                query: {
                    volume_percent: Math.round(percent)
                }

            }).then(() => {
                this.volume = percent;
                this.emitChange();
            });
        }

        setPlaying(playing: boolean) {
            this._req("put", playing ? "/play" : "/pause");
        }

        setRepeat(state: Repeat) {
            this._req("put", "/repeat", {
                query: { state }
            });
        }

        setShuffle(state: boolean) {
            this._req("put", "/shuffle", {
                query: { state }
            }).then(() => {
                this.shuffle = state;
                this.emitChange();
            });
        }

        seek(ms: number) {
            if (this.isSettingPosition) return Promise.resolve();

            this.seekEpoch++;

            this.isSettingPosition = true;

            return this._req("put", "/seek", {
                query: {
                    position_ms: Math.round(ms)
                }
            }).catch((e: any) => {
                console.error("[VencordSpotifyControls] Failed to seek", e);
                this.isSettingPosition = false;
            });
        }

        seekToLine(ms: number) {
            if (!settings.store.seekFadeCompensation) return this.seek(ms);

            if (this.isPlaying && !this.isSettingPosition)
                this.lineHold = { startMs: ms, expires: performance.now() + SEEK_HOLD_TIMEOUT_MS, landed: false };

            return this.seek(Math.max(0, ms - SEEK_FADE_COMPENSATION_MS));
        }

        lyricsPosition(pos: number) {
            const hold = this.lineHold;
            if (!hold) return pos;

            if (performance.now() > hold.expires) {
                this.lineHold = null;
                return pos;
            }

            if (!this.isSettingPosition
                && pos >= hold.startMs - SEEK_LAND_BEFORE_MS
                && pos <= hold.startMs + SEEK_LAND_AFTER_MS)
                hold.landed = true;

            if (hold.landed && pos >= hold.startMs) {
                this.lineHold = null;
                return pos;
            }
            return hold.startMs;
        }

        get isLineHeld() {
            return this.lineHold !== null;
        }

        _req(method: "post" | "get" | "put", route: string, data: any = {}) {
            if (this.device?.is_active)
                (data.query ??= {}).device_id = this.device.id;

            const { socket } = SpotifySocket.getActiveSocketAndDevice();
            return SpotifyAPI[method](socket.accountId, socket.accessToken, {
                url: API_BASE + route,
                ...data
            });
        }
    }

    const store = new SpotifyStore(FluxDispatcher, {
        SPOTIFY_PLAYER_STATE(e: PlayerState) {
            store.track = e.track;
            store.device = e.device ?? null;
            store.isPlaying = e.isPlaying ?? false;
            store.volume = e.volumePercent ?? 0;
            store.repeat = e.actual_repeat || "off";
            store.shuffle = e.shuffle ?? false;
            store.position = e.position ?? 0;
            store.isSettingPosition = false;

            if (store.isPlaying && store.track) store.startResync();
            else store.stopResync();

            store.emitChange();
        },
        SPOTIFY_SET_DEVICES({ devices }: { devices: Device[]; }) {
            store.device = devices.find(d => d.is_active) ?? devices[0] ?? null;
            store.emitChange();
        }
    });

    return store;
});
