/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { TooltipContainer } from "@components/TooltipContainer";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { isInterludeLine } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/lineTiming";
import { SpotifyLrcStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/store";
import { Provider } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { getBgRefs, getLineWordRefs, LineRegistry, rowRef, useSpicyLinesFrame } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/spicyAnimator/useSpicyLinesFrame";
import { SpotifyStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { ContextMenuApi, openModalLazy, React, useEffect, useState, useStateFromStores } from "@webpack/common";

import { LyricsContextMenu } from "./ctxMenu";
import { DynamicBackground } from "./DynamicBackground";
import { LyricsModal } from "./modal";
import { cl, interludeAlignCl, InterludeDots, leadAlignCl, lineStateClass, LyricsAttributionFooter, NoteSvg, SpicyWordSpans, useLyrics } from "./util";

function LyricsDisplay({ scroll = true, style }: { scroll?: boolean; style?: React.CSSProperties; }) {
    const { showMusicNoteOnNoLyrics, dynamicBackground } = settings.use(["showMusicNoteOnNoLyrics", "dynamicBackground"]);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const {
        track, lyricsInfo, lyricRefs, statesKey, statesRef, lineTimes,
        isPlaying, positionRef, storePosition, isUntimed
    } = useLyrics({ scroll, containerRef });

    const currentLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric] || null;
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

    const showDynamicBackground = isSpicyProvider && dynamicBackground;

    // Spicy Lyrics only: clicking a line jumps to it, clicking empty space opens the modal
    const seekTo = (seconds: number) => (e: React.MouseEvent) => {
        if (!isSpicyProvider || isUntimed) return;
        e.stopPropagation();
        SpotifyStore.seekToLine(seconds * 1000);
    };

    return (
        <div
            className={[
                "vc-spotify-lyrics",
                showDynamicBackground && "vc-spotify-lyrics-dynbg",
                isSpicyProvider && "vc-spotify-lyrics-spicy"
            ].filter(Boolean).join(" ")}
            style={style}
            onClick={() => openModalLazy(async () => props => <LyricsModal props={props} />)}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <LyricsContextMenu />)}
        >
            {showDynamicBackground && <DynamicBackground imageUrl={track?.album?.image?.url} isPlaying={isPlaying} />}
            <div
                ref={containerRef}
                className={isSpicyProvider ? "vc-spotify-lyrics-inner vc-spotify-lyrics-spicy" : "vc-spotify-lyrics-inner"}
            >
                {currentLyrics ? (
                    <>
                        {currentLyrics.map((line, i) => {
                            const stateCl = lineStateClass(statesKey, i, isUntimed);
                            const alignCl = leadAlignCl(line, isSpicyProvider, "center");
                            const refs = getLineWordRefs(registry, i);
                            const hasWordTiming = !isUntimed && !!line.words?.length;

                            if (isInterludeLine(line)) {
                                return (
                                    <div ref={rowRef(lyricRefs[i], refs)} key={i} className={[cl("line-row"), cl("line-row-interlude")].join(" ")}>
                                        <BaseText size="sm" className={[cl("interlude"), interludeAlignCl(currentLyrics, i, isSpicyProvider)].join(" ")}>
                                            <InterludeDots />
                                        </BaseText>
                                    </div>
                                );
                            }

                            return (
                                <div ref={rowRef(lyricRefs[i], refs)} key={i} className={cl("line-row")}>
                                    <BaseText
                                        size="sm"
                                        className={[cl("line"), !hasWordTiming && cl("line-plain"), !hasWordTiming && isSpicyProvider && cl("line-sweep"), stateCl, alignCl, isSpicyProvider && !isUntimed && cl("line-seekable")].filter(Boolean).join(" ")}
                                        onClick={seekTo(line.time)}
                                    >
                                        {hasWordTiming
                                            ? <SpicyWordSpans words={line.words!} refsArray={refs.lead} />
                                            : (line.text || NoteSvg())}
                                    </BaseText>
                                    {line.background?.map((bg, bI) => (
                                        <BaseText
                                            key={bI}
                                            size="xs"
                                            className={[cl("line"), cl("line-bg"), stateCl, alignCl, isSpicyProvider && !isUntimed && cl("line-seekable")].filter(Boolean).join(" ")}
                                            onClick={seekTo(bg.startTime)}
                                        >
                                            {!isUntimed && bg.words.length
                                                ? <SpicyWordSpans words={bg.words} refsArray={getBgRefs(refs, bI)} variant="bg" />
                                                : bg.text}
                                        </BaseText>
                                    ))}
                                </div>
                            );
                        })}
                        <LyricsAttributionFooter lyricsInfo={lyricsInfo} />
                    </>
                ) : showMusicNoteOnNoLyrics ? (
                    <TooltipContainer text="No synced lyrics found">
                        <NoteSvg />
                    </TooltipContainer>
                ) : null}
            </div>
        </div>
    );
}

export function SpotifyLyrics({ scroll = true }: { scroll?: boolean; } = {}) {
    SpotifyLrcStore.init();
    const track = useStateFromStores(
        [SpotifyStore],
        () => SpotifyStore.track,
        null,
        (prev, next) => (prev?.id ? prev.id === next?.id : prev?.name === next?.name)
    );

    const device = useStateFromStores(
        [SpotifyStore],
        () => SpotifyStore.device,
        null,
        (prev, next) => prev?.id === next?.id
    );

    const isPlaying = useStateFromStores([SpotifyStore], () => SpotifyStore.isPlaying);
    const [shouldHide, setShouldHide] = useState(false);

    useEffect(() => {
        setShouldHide(false);
        if (!isPlaying) {
            const timeout = setTimeout(() => setShouldHide(true), 1000 * 60 * 5);
            return () => clearTimeout(timeout);
        }
    }, [isPlaying]);

    if (!track || !device?.is_active || shouldHide) return null;

    const exportTrackImageStyle = {
        "--vc-spotify-track-image": `url(${track?.album?.image?.url || ""})`,
    } as React.CSSProperties;

    return <LyricsDisplay scroll={scroll} style={exportTrackImageStyle} />;
}
