/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { isInterludeLine } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/lineTiming";
import { Provider } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { getBgRefs, getLineWordRefs, LineRegistry, rowRef, useSpicyLinesFrame } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/spicyAnimator/useSpicyLinesFrame";
import { SpotifyStore, Track } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { openImageModal } from "@utils/discord";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, React } from "@webpack/common";

import { DynamicBackground } from "./DynamicBackground";
import { cl, interludeAlignCl, InterludeDots, leadAlignCl, lineStateClass, LyricsAttributionFooter, NoteSvg, scrollClasses, SpicyWordSpans, useLyrics } from "./util";

const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

function getTitleNode(track: Track | null) {
    if (!track) {
        return <BaseText size="sm" weight="semibold">No track playing</BaseText>;
    }
    return (
        <div className={cl("header-content")}>
            {track?.album?.image?.url && (
                <img
                    src={track.album.image.url}
                    alt={track.album.name}
                    className={cl("album-image")}
                    onClick={() => openImageModal({
                        url: track.album.image.url,
                        width: track.album.image.width,
                        height: track.album.image.height,
                    })}
                />
            )}
            <div>
                <BaseText size="sm" weight="semibold">{track.name}</BaseText>
                <BaseText size="sm">by {track.artists.map(a => a.name).join(", ")}</BaseText>
                <BaseText size="sm">on {track.album.name}</BaseText>
            </div>
        </div>
    );
}

const modalLine = cl("modal-line");

export function LyricsModal({ props }: { props: RenderModalProps; }) {
    const { dynamicBackground } = settings.use(["dynamicBackground"]);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const {
        track, lyricsInfo, lyricRefs, statesKey, statesRef, lineTimes,
        isPlaying, positionRef, storePosition, isUntimed
    } = useLyrics({ scroll: true, containerRef });
    const currentLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric];
    const registry = React.useMemo<LineRegistry>(() => new Map(), [currentLyrics]);
    const isSpicyProvider = lyricsInfo?.useLyric === Provider.SpicyLyrics || lyricsInfo?.useLyric === Provider.SpicyRomanized;

    useSpicyLinesFrame({
        lines: currentLyrics,
        lineTimes,
        registry,
        statesRef,
        positionRef,
        isPlaying,
        pausedPosition: storePosition,
        isSpicy: isSpicyProvider
    });

    const seekTo = (seconds: number) => () => {
        if (isSpicyProvider && !isUntimed) SpotifyStore.seekToLine(seconds * 1000);
    };

    return (
        <Modal {...props} size="md" title={getTitleNode(track)}>
            <div className={isSpicyProvider ? cl("modal-spicy") : undefined}>
                {isSpicyProvider && dynamicBackground && (
                    <DynamicBackground imageUrl={track?.album?.image?.url} isPlaying={isPlaying} lite />
                )}
            <div ref={containerRef} className={`${cl("lyrics-modal-container")} ${scrollClasses.auto}`}>
                {currentLyrics ? (
                    <>
                        {currentLyrics.map((line, i) => {
                            const stateCl = lineStateClass(statesKey, i, isUntimed);
                            const alignCl = leadAlignCl(line, isSpicyProvider);
                            const refs = getLineWordRefs(registry, i);
                            const hasWordTiming = !isUntimed && !!line.words?.length;

                            if (isInterludeLine(line)) {
                                return (
                                    <div ref={rowRef(lyricRefs[i], refs)} key={i} className={[cl("line-row"), cl("line-row-interlude")].join(" ")}>
                                        <BaseText size="md" className={[cl("interlude"), interludeAlignCl(currentLyrics, i, isSpicyProvider)].join(" ")}>
                                            <InterludeDots />
                                        </BaseText>
                                    </div>
                                );
                            }

                            return (
                                <div ref={rowRef(lyricRefs[i], refs)} key={i} className={cl("line-row")}>
                                    <BaseText
                                        size="md"
                                        weight="semibold"
                                        className={[modalLine, cl("line"), !hasWordTiming && cl("line-plain"), !hasWordTiming && isSpicyProvider && cl("line-sweep"), stateCl, alignCl, isSpicyProvider && !isUntimed && cl("line-seekable")].filter(Boolean).join(" ")}
                                        onClick={seekTo(line.time)}
                                    >
                                        {!isUntimed && (
                                            <span className={cl("modal-timestamp")} onClick={() => SpotifyStore.seekToLine(line.time * 1000)}>
                                                {formatTime(line.time)}
                                            </span>
                                        )}
                                        {hasWordTiming
                                            ? <SpicyWordSpans words={line.words!} refsArray={refs.lead} />
                                            : (line.text || NoteSvg())}
                                    </BaseText>
                                    {line.background?.map((bg, bI) => (
                                        <BaseText
                                            key={bI}
                                            size="sm"
                                            weight="semibold"
                                            className={[modalLine, cl("line"), cl("line-bg"), stateCl, alignCl, isSpicyProvider && !isUntimed && cl("line-seekable")].filter(Boolean).join(" ")}
                                            onClick={seekTo(bg.startTime)}
                                        >
                                            {!isUntimed && (
                                                <span className={cl("modal-timestamp")} onClick={() => SpotifyStore.seekToLine(bg.startTime * 1000)}>
                                                    {formatTime(bg.startTime)}
                                                </span>
                                            )}
                                            {!isUntimed && bg.words.length
                                                ? <SpicyWordSpans words={bg.words} refsArray={getBgRefs(refs, bI)} variant="bg" />
                                                : bg.text}
                                        </BaseText>
                                    ))}
                                </div>
                            );
                        })}
                        <LyricsAttributionFooter
                            lyricsInfo={lyricsInfo}
                            className={cl("modal-attribution")}
                        />
                    </>
                ) : (
                    <BaseText size="sm" className={cl("modal-no-lyrics")}>
                        No lyrics available :(
                    </BaseText>
                )}
            </div>
            </div>
        </Modal>
    );
}
