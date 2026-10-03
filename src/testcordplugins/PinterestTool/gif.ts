/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * Pinterest Tool modifications Copyright (c) 2026 szcx404
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Small, dependency-free animated GIF toolkit for Pinterest Tool:
// - decodeGif(): frames via the browser's ImageDecoder (Chromium / Electron)
// - encodeGif(): median-cut palette + LZW, fully in TypeScript
// - fitUnderLimit(): shrinks images/GIFs so Discord's 10 MB upload check passes

export const DISCORD_UPLOAD_LIMIT = 10 * 1024 * 1024;
// Leave headroom: Discord's editor may add a little on its own.
export const TARGET_BYTES = Math.floor(9.3 * 1024 * 1024);

export interface GifFrame {
    image: ImageBitmap;
    delay: number; // ms
}

export interface DecodedGif {
    frames: GifFrame[];
    width: number;
    height: number;
}

export function canDecodeAnimated() {
    return typeof (globalThis as any).ImageDecoder === "function";
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(0, comma);
    const body = dataUrl.slice(comma + 1);
    if (!/;base64/i.test(meta)) return new TextEncoder().encode(decodeURIComponent(body));
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return `data:${mime};base64,${btoa(binary)}`;
}

/** Decodes every frame (already composited by the browser), scaled so the long side <= maxSide. */
export async function decodeGif(bytes: Uint8Array, maxSide = 640, maxFrames = 300): Promise<DecodedGif> {
    const Decoder = (globalThis as any).ImageDecoder;
    if (!Decoder) throw new Error("This Discord build cannot decode animated GIFs.");

    const decoder = new Decoder({ data: bytes, type: "image/gif" });
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    const total = Math.min(maxFrames, track?.frameCount ?? 1);

    const frames: GifFrame[] = [];
    let width = 0;
    let height = 0;

    for (let index = 0; index < total; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        const w = image.displayWidth ?? image.codedWidth;
        const h = image.displayHeight ?? image.codedHeight;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        width = Math.max(1, Math.round(w * scale));
        height = Math.max(1, Math.round(h * scale));
        const bitmap = await createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
        // duration is in microseconds; browsers treat very small delays as 100 ms.
        const delay = image.duration ? Math.round(image.duration / 1000) : 100;
        frames.push({ image: bitmap, delay: delay < 20 ? 100 : delay });
        image.close();
    }

    decoder.close?.();
    return { frames, width, height };
}

// ---------------------------------------------------------------------------
// Palette (median cut over samples from all frames)
// ---------------------------------------------------------------------------

function medianCut(samples: Uint8Array, count: number, maxColors: number): Uint8Array {
    interface Box { start: number; end: number; }
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;

    const boxes: Box[] = [{ start: 0, end: count }];
    const rangeOf = (box: Box) => {
        let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
        for (let i = box.start; i < box.end; i++) {
            const p = idx[i] * 3;
            const r = samples[p], g = samples[p + 1], b = samples[p + 2];
            if (r < rMin) rMin = r; if (r > rMax) rMax = r;
            if (g < gMin) gMin = g; if (g > gMax) gMax = g;
            if (b < bMin) bMin = b; if (b > bMax) bMax = b;
        }
        const rr = rMax - rMin, gr = gMax - gMin, br = bMax - bMin;
        const channel = rr >= gr && rr >= br ? 0 : gr >= br ? 1 : 2;
        return { channel, range: Math.max(rr, gr, br) };
    };

    while (boxes.length < maxColors) {
        let best = -1;
        let bestScore = 0;
        let bestChannel = 0;
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (box.end - box.start < 2) continue;
            const { channel, range } = rangeOf(box);
            const score = range * Math.sqrt(box.end - box.start);
            if (score > bestScore) {
                bestScore = score;
                best = i;
                bestChannel = channel;
            }
        }
        if (best < 0 || bestScore === 0) break;

        const box = boxes[best];
        const slice = Array.from(idx.subarray(box.start, box.end));
        slice.sort((a, b) => samples[a * 3 + bestChannel] - samples[b * 3 + bestChannel]);
        idx.set(slice, box.start);
        const mid = box.start + ((box.end - box.start) >> 1);
        boxes.splice(best, 1, { start: box.start, end: mid }, { start: mid, end: box.end });
    }

    const palette = new Uint8Array(boxes.length * 3);
    boxes.forEach((box, n) => {
        let r = 0, g = 0, b = 0;
        const size = box.end - box.start || 1;
        for (let i = box.start; i < box.end; i++) {
            const p = idx[i] * 3;
            r += samples[p];
            g += samples[p + 1];
            b += samples[p + 2];
        }
        palette[n * 3] = Math.round(r / size);
        palette[n * 3 + 1] = Math.round(g / size);
        palette[n * 3 + 2] = Math.round(b / size);
    });
    return palette;
}

function buildPalette(frames: Uint8ClampedArray[], maxColors: number) {
    const totalPixels = frames.reduce((sum, f) => sum + f.length / 4, 0);
    const wanted = 48000;
    const step = Math.max(1, Math.floor(totalPixels / wanted));
    const samples = new Uint8Array(Math.ceil(totalPixels / step) * 3 + 3);
    let count = 0;
    let counter = 0;
    for (const data of frames) {
        for (let i = 0; i < data.length; i += 4) {
            if (counter++ % step !== 0 || data[i + 3] < 128) continue;
            samples[count * 3] = data[i];
            samples[count * 3 + 1] = data[i + 1];
            samples[count * 3 + 2] = data[i + 2];
            count++;
        }
    }
    if (count === 0) {
        samples[0] = samples[1] = samples[2] = 0;
        count = 1;
    }
    return medianCut(samples, count, maxColors);
}

function makeMapper(palette: Uint8Array) {
    const colors = palette.length / 3;
    const cache = new Int16Array(32768).fill(-1);
    return (r: number, g: number, b: number) => {
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let hit = cache[key];
        if (hit >= 0) return hit;
        let best = 0;
        let bestDist = Infinity;
        for (let c = 0; c < colors; c++) {
            const dr = palette[c * 3] - r, dg = palette[c * 3 + 1] - g, db = palette[c * 3 + 2] - b;
            const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3;
            if (dist < bestDist) {
                bestDist = dist;
                best = c;
            }
        }
        cache[key] = best;
        hit = best;
        return hit;
    };
}

// ---------------------------------------------------------------------------
// Byte writer + LZW (same scheme as the well-known omggif encoder)
// ---------------------------------------------------------------------------

class ByteWriter {
    private buf = new Uint8Array(1 << 16);
    length = 0;

    private ensure(extra: number) {
        if (this.length + extra <= this.buf.length) return;
        let size = this.buf.length * 2;
        while (size < this.length + extra) size *= 2;
        const next = new Uint8Array(size);
        next.set(this.buf.subarray(0, this.length));
        this.buf = next;
    }

    byte(value: number) {
        this.ensure(1);
        this.buf[this.length++] = value & 255;
    }

    short(value: number) {
        this.byte(value & 255);
        this.byte((value >> 8) & 255);
    }

    bytes(values: ArrayLike<number>) {
        this.ensure(values.length);
        this.buf.set(values as any, this.length);
        this.length += values.length;
    }

    result() {
        return this.buf.slice(0, this.length);
    }
}

function writeLzw(out: ByteWriter, minCodeSize: number, indices: Uint8Array) {
    out.byte(minCodeSize);

    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let nextCode = eoiCode + 1;
    let codeSize = minCodeSize + 1;
    let table = new Map<number, number>();

    let bitBuffer = 0;
    let bitCount = 0;
    const block: number[] = [];

    const flushBlock = () => {
        if (!block.length) return;
        out.byte(block.length);
        out.bytes(block);
        block.length = 0;
    };
    const emit = (code: number) => {
        bitBuffer |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
            block.push(bitBuffer & 255);
            if (block.length === 255) flushBlock();
            bitBuffer >>>= 8;
            bitCount -= 8;
        }
    };

    emit(clearCode);
    let prefix = indices[0];

    for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = (prefix << 8) | k;
        const code = table.get(key);
        if (code !== undefined) {
            prefix = code;
            continue;
        }

        emit(prefix);
        if (nextCode === 4096) {
            emit(clearCode);
            nextCode = eoiCode + 1;
            codeSize = minCodeSize + 1;
            table = new Map();
        } else {
            if (nextCode >= (1 << codeSize)) codeSize++;
            table.set(key, nextCode++);
        }
        prefix = k;
    }

    emit(prefix);
    emit(eoiCode);
    if (bitCount > 0) {
        block.push(bitBuffer & 255);
        if (block.length === 255) flushBlock();
    }
    flushBlock();
    out.byte(0);
}

export interface EncodeFrame {
    data: Uint8ClampedArray; // RGBA, width*height*4
    delay: number;           // ms
}

/** Encodes RGBA frames into an animated GIF (global palette, looping forever). */
export function encodeGif(frames: EncodeFrame[], width: number, height: number): Uint8Array {
    if (!frames.length) throw new Error("No frames to encode.");

    let transparent = false;
    for (const frame of frames) {
        for (let i = 3; i < frame.data.length; i += 4) {
            if (frame.data[i] < 128) { transparent = true; break; }
        }
        if (transparent) break;
    }

    const palette = buildPalette(frames.map(f => f.data), transparent ? 255 : 256);
    const colors = palette.length / 3;
    const transparentIndex = transparent ? colors : -1;
    const tableColors = colors + (transparent ? 1 : 0);
    let tableBits = 1;
    while ((1 << tableBits) < tableColors) tableBits++;
    const tableSize = 1 << tableBits;
    const map = makeMapper(palette);

    const out = new ByteWriter();
    out.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    out.short(width);
    out.short(height);
    out.byte(0x80 | ((tableBits - 1) << 4) | (tableBits - 1));
    out.byte(0);
    out.byte(0);
    for (let c = 0; c < tableSize; c++) {
        if (c < colors) out.bytes([palette[c * 3], palette[c * 3 + 1], palette[c * 3 + 2]]);
        else out.bytes([0, 0, 0]);
    }

    // NETSCAPE2.0 loop forever
    out.bytes([0x21, 0xff, 0x0b]);
    out.bytes([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]);
    out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

    const indices = new Uint8Array(width * height);
    const minCodeSize = Math.max(2, tableBits);

    for (const frame of frames) {
        const d = frame.data;
        for (let p = 0, i = 0; p < indices.length; p++, i += 4) {
            indices[p] = transparent && d[i + 3] < 128 ? transparentIndex : map(d[i], d[i + 1], d[i + 2]);
        }

        // Graphic Control Extension
        const delay = Math.max(2, Math.round(frame.delay / 10));
        out.bytes([0x21, 0xf9, 0x04]);
        out.byte(((transparent ? 2 : 1) << 2) | (transparent ? 1 : 0));
        out.short(delay);
        out.byte(transparent ? transparentIndex : 0);
        out.byte(0);

        // Image descriptor (full frame, no local table)
        out.byte(0x2c);
        out.short(0);
        out.short(0);
        out.short(width);
        out.short(height);
        out.byte(0);

        writeLzw(out, minCodeSize, indices);
    }

    out.byte(0x3b);
    return out.result();
}

// ---------------------------------------------------------------------------
// Size fitting for Discord (10 MB)
// ---------------------------------------------------------------------------

export type RenderFrame = (target: HTMLCanvasElement, frame: GifFrame, index: number) => void;

/**
 * Re-encodes a decoded GIF (optionally drawing effects per frame through `render`)
 * and keeps shrinking it until it is under the upload limit.
 */
export async function encodeFittedGif(
    gif: DecodedGif,
    render: RenderFrame | null,
    onProgress?: (text: string) => void,
    maxBytes = TARGET_BYTES
): Promise<Uint8Array> {
    let scale = 1;
    let frameStep = 1;

    for (let attempt = 0; attempt < 7; attempt++) {
        const width = Math.max(16, Math.round(gif.width * scale));
        const height = Math.max(16, Math.round(gif.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

        const frames: EncodeFrame[] = [];
        for (let i = 0; i < gif.frames.length; i += frameStep) {
            let delay = 0;
            for (let j = i; j < Math.min(gif.frames.length, i + frameStep); j++) delay += gif.frames[j].delay;
            if (render) {
                render(canvas, gif.frames[i], i);
            } else {
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(gif.frames[i].image, 0, 0, width, height);
            }
            frames.push({ data: ctx.getImageData(0, 0, width, height).data, delay });
            if (i % 6 === 0) {
                onProgress?.(`Rendering frame ${i + 1}/${gif.frames.length}`);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        onProgress?.("Encoding GIF…");
        await new Promise(resolve => setTimeout(resolve, 0));
        const bytes = encodeGif(frames, width, height);
        if (bytes.length <= maxBytes) return bytes;

        // Too big: shrink both ways, faster once far above the limit.
        const ratio = maxBytes / bytes.length;
        scale *= Math.max(0.55, Math.min(0.9, Math.sqrt(ratio) * 0.95));
        if (attempt >= 1 && gif.frames.length / frameStep > 40) frameStep++;
        onProgress?.(`Too large (${(bytes.length / 1048576).toFixed(1)} MB), shrinking…`);
    }

    throw new Error("Could not bring this GIF under Discord's 10 MB limit.");
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not read the image."));
        image.src = src;
    });
}

function readAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

/**
 * Returns the file unchanged when it already fits; otherwise a smaller copy.
 * Static images are re-encoded (JPEG, or PNG when they have transparency),
 * GIFs are re-encoded as smaller GIFs so they stay animated.
 */
export async function fitUnderLimit(file: File, onProgress?: (text: string) => void): Promise<File> {
    if (file.size <= TARGET_BYTES) return file;

    const base = file.name.replace(/\.[a-z0-9]+$/i, "") || "image";
    const isGif = /gif/i.test(file.type) || /\.gif$/i.test(file.name);

    if (isGif && !canDecodeAnimated()) {
        // Never flatten a GIF to a still image just to save space.
        throw new Error("This GIF is over 10 MB and this Discord build cannot shrink GIFs. Pick a smaller one.");
    }

    if (isGif) {
        onProgress?.("Shrinking GIF under 10 MB…");
        const gif = await decodeGif(new Uint8Array(await file.arrayBuffer()), 640, 300);
        const bytes = await encodeFittedGif(gif, null, onProgress);
        gif.frames.forEach(f => f.image.close());
        return new File([bytes as unknown as BlobPart], `${base}.gif`, { type: "image/gif" });
    }

    onProgress?.("Shrinking image under 10 MB…");
    const image = await loadImage(await readAsDataUrl(file));
    const alpha = /png|webp/i.test(file.type);
    let scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    let quality = 0.9;

    for (let attempt = 0; attempt < 8; attempt++) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
        const mime = alpha ? "image/png" : "image/jpeg";
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
        if (blob && blob.size <= TARGET_BYTES) return new File([blob], `${base}.${alpha ? "png" : "jpg"}`, { type: mime });
        scale *= 0.8;
        quality = Math.max(0.6, quality - 0.08);
    }

    throw new Error("Could not bring this image under Discord's 10 MB limit.");
}
