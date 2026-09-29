/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { useSpicyWordFrame } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/spicyAnimator/useSpicyWordFrame";
import { SpotifyStore, Track } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { openImageModal } from "@utils/discord";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, React } from "@webpack/common";

import { cl, NoteSvg, scrollClasses, useLyrics } from "./util";

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

const modalCurrentLine = cl("modal-line-current");
const modalLine = cl("modal-line");

export function LyricsModal({ props }: { props: RenderModalProps; }) {
    const { track, lyricsInfo, lyricRefs, currLrcIndex, isPlaying, positionRef } = useLyrics({ scroll: true });
    const currentLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric];
    const wordRefsRef = React.useRef<(HTMLSpanElement | null)[]>([]);
    const activeLineWords = currLrcIndex != null ? currentLyrics?.[currLrcIndex]?.words : undefined;

    useSpicyWordFrame(activeLineWords, wordRefsRef, () => positionRef.current, isPlaying);

    return (
        <Modal {...props} size="md" title={getTitleNode(track)}>
            <div className={`${cl("lyrics-modal-container")} ${scrollClasses.auto}`}>
                {currentLyrics ? (
                    currentLyrics.map((line, i) => {
                        const isCurrentLine = currLrcIndex === i;
                        const hasWordTiming = isCurrentLine && !!line.words?.length;

                        return (
                            <div ref={lyricRefs[i]} key={i}>
                                <BaseText
                                    size={isCurrentLine ? "md" : "sm"}
                                    weight={isCurrentLine ? "semibold" : "normal"}
                                    className={isCurrentLine ? modalCurrentLine : modalLine}
                                >
                                    <span className={cl("modal-timestamp")} onClick={() => SpotifyStore.seek(line.time * 1000)}>
                                        {formatTime(line.time)}
                                    </span>
                                    {hasWordTiming
                                        ? line.words!.map((word, w) => (
                                            <React.Fragment key={w}>
                                                <span
                                                    ref={(el: HTMLSpanElement | null) => { wordRefsRef.current[w] = el; }}
                                                    className={word.IsPartOfWord ? "vc-spicy-word vc-spicy-part-of-word" : "vc-spicy-word"}
                                                >
                                                    {word.text}
                                                </span>
                                                {word.IsPartOfWord ? "" : " "}
                                            </React.Fragment>
                                        ))
                                        : (line.text || NoteSvg())}
                                </BaseText>
                            </div>
                        );
                    })
                ) : (
                    <BaseText size="sm" className={cl("modal-no-lyrics")}>
                        No lyrics available :(
                    </BaseText>
                )}
            </div>
        </Modal>
    );
}
