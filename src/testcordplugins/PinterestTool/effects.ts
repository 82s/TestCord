/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * Pinterest Tool modifications Copyright (c) 2026 szcx404
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Pure canvas image-effects engine for the Pinterest Tool editor.
// The same code draws the live preview, the final export and every GIF frame.

export interface Fx {
    // colour
    brightness: number;
    contrast: number;
    saturate: number;
    hue: number;
    sepia: number;
    grayscale: number;
    invert: number;
    tint: string;
    tintStrength: number;
    duotone: number;
    duoA: string;
    duoB: string;
    // real effects
    blur: number;
    pixelate: number;
    posterize: number;
    sharpen: number;
    sketch: number;
    rgbSplit: number;
    glitch: number;
    glitchSeed: number;
    bloom: number;
    // finish
    vignette: number;
    grain: number;
    scanlines: number;
    flipH: boolean;
}

export const FX_DEFAULT: Fx = {
    brightness: 100, contrast: 100, saturate: 100, hue: 0, sepia: 0, grayscale: 0, invert: 0,
    tint: "#e60023", tintStrength: 0, duotone: 0, duoA: "#120a2e", duoB: "#ff4fa3",
    blur: 0, pixelate: 0, posterize: 0, sharpen: 0, sketch: 0, rgbSplit: 0, glitch: 0, glitchSeed: 7, bloom: 0,
    vignette: 0, grain: 0, scanlines: 0, flipH: false
};

export const FX_PRESETS: Array<{ label: string; values: Partial<Fx>; }> = [
    { label: "Original", values: {} },
    { label: "Noir", values: { grayscale: 100, contrast: 145, brightness: 88, vignette: 45, grain: 25 } },
    { label: "Vivid", values: { saturate: 165, contrast: 112, sharpen: 25 } },
    { label: "Glitch", values: { glitch: 60, rgbSplit: 10, scanlines: 20 } },
    { label: "VHS", values: { rgbSplit: 6, scanlines: 45, grain: 35, saturate: 120, blur: 0.6, vignette: 25 } },
    { label: "Pixel", values: { pixelate: 12, posterize: 7, saturate: 130 } },
    { label: "Neon", values: { bloom: 65, saturate: 150, contrast: 115, brightness: 92, rgbSplit: 3 } },
    { label: "Sketch", values: { sketch: 85, grayscale: 60, contrast: 110 } },
    { label: "Poster", values: { posterize: 4, saturate: 150, contrast: 115 } },
    { label: "Duotone", values: { duotone: 100, contrast: 108 } },
    { label: "Dream", values: { bloom: 55, blur: 0.8, brightness: 108, saturate: 120, vignette: 20 } },
    { label: "Film", values: { grain: 45, vignette: 35, contrast: 108, sepia: 20, saturate: 110 } },
    { label: "Cyber", values: { hue: 190, saturate: 170, contrast: 118, brightness: 96, rgbSplit: 5, scanlines: 25, bloom: 30 } }
];

export interface TextLayer {
    kind: "text";
    id: string;
    text: string;
    x: number;          // centre, 0..1 of width
    y: number;          // centre, 0..1 of height
    size: number;       // font size as a fraction of image height
    color: string;
    font: FontKey;
    bold: boolean;
    italic: boolean;
    outline: boolean;
    outlineColor: string;
    shadow: boolean;
}

export interface ImageLayer {
    kind: "image";
    id: string;
    src: string;        // data URL (kept so a layer can be re-created)
    x: number;
    y: number;
    scale: number;      // width as a fraction of image width
}

export type Layer = TextLayer | ImageLayer;
export type FontKey = "Sans" | "Serif" | "Mono" | "Impact" | "Hand";

export const FONT_STACKS: Record<FontKey, string> = {
    Sans: "\"gg sans\", \"Segoe UI\", Arial, sans-serif",
    Serif: "Georgia, \"Times New Roman\", serif",
    Mono: "Consolas, \"Courier New\", monospace",
    Impact: "Impact, \"Arial Black\", sans-serif",
    Hand: "\"Comic Sans MS\", \"Brush Script MT\", cursive"
};

export type ImageCache = Map<string, HTMLImageElement>;

// ---------------------------------------------------------------------------

function seededRandom(seed: number) {
    let a = (seed >>> 0) || 1;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function parseHex(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return [255, 0, 0];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function buildCssFilter(fx: Fx, unit: number) {
    return [
        `brightness(${fx.brightness}%)`,
        `contrast(${fx.contrast}%)`,
        `saturate(${fx.saturate}%)`,
        `hue-rotate(${fx.hue}deg)`,
        `sepia(${fx.sepia}%)`,
        `grayscale(${fx.grayscale}%)`,
        `invert(${fx.invert}%)`,
        `blur(${(fx.blur * unit).toFixed(2)}px)`
    ].join(" ");
}

export function isPristine(fx: Fx) {
    return (Object.keys(FX_DEFAULT) as Array<keyof Fx>).every(key => key === "glitchSeed" || fx[key] === FX_DEFAULT[key]);
}

function convolveSharpen(data: Uint8ClampedArray, w: number, h: number, amount: number) {
    const src = new Uint8ClampedArray(data);
    const a = amount;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) {
                const v = src[i + c] * (1 + 4 * a)
                    - a * (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]);
                data[i + c] = v;
            }
        }
    }
}

function applySketch(data: Uint8ClampedArray, w: number, h: number, amount: number) {
    const gray = new Float32Array(w * h);
    for (let i = 0, p = 0; p < gray.length; i += 4, p++) gray[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            const gx = -gray[p - w - 1] - 2 * gray[p - 1] - gray[p + w - 1] + gray[p - w + 1] + 2 * gray[p + 1] + gray[p + w + 1];
            const gy = -gray[p - w - 1] - 2 * gray[p - w] - gray[p - w + 1] + gray[p + w - 1] + 2 * gray[p + w] + gray[p + w + 1];
            const edge = Math.min(255, Math.sqrt(gx * gx + gy * gy) * 0.9);
            const ink = 255 - edge;
            const i = p * 4;
            for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * (1 - amount) + ink * amount;
        }
    }
}

function applyGlitch(data: Uint8ClampedArray, w: number, h: number, strength: number, seed: number) {
    const rand = seededRandom(seed);
    const source = new Uint8ClampedArray(data);
    const slices = Math.round(4 + strength * 14);

    for (let s = 0; s < slices; s++) {
        const sliceH = Math.max(2, Math.round(h * (0.008 + rand() * 0.05)));
        const y0 = Math.floor(rand() * (h - sliceH));
        const shift = Math.round((rand() - 0.5) * 2 * w * 0.16 * strength);
        const channelShift = Math.round((rand() - 0.5) * 2 * w * 0.03 * strength);
        for (let y = y0; y < y0 + sliceH; y++) {
            for (let x = 0; x < w; x++) {
                const dst = (y * w + x) * 4;
                const sx = (x - shift + w * 4) % w;
                const rx = (x - shift - channelShift + w * 4) % w;
                const bx = (x - shift + channelShift + w * 4) % w;
                data[dst] = source[(y * w + rx) * 4];
                data[dst + 1] = source[(y * w + sx) * 4 + 1];
                data[dst + 2] = source[(y * w + bx) * 4 + 2];
            }
        }
    }
}

function applyRgbSplit(data: Uint8ClampedArray, w: number, h: number, shift: number) {
    const source = new Uint8ClampedArray(data);
    const d = Math.max(1, Math.round(shift));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            data[i] = source[(y * w + Math.min(w - 1, x + d)) * 4];
            data[i + 2] = source[(y * w + Math.max(0, x - d)) * 4 + 2];
        }
    }
}

// Draw everything (image, effects, layers) at the canvas' current size.
export function drawScene(
    canvas: HTMLCanvasElement,
    image: CanvasImageSource,
    fx: Fx,
    layers: Layer[],
    images: ImageCache,
    options: { selectedId?: string; keepAlpha?: boolean; } = {}
) {
    const W = canvas.width;
    const H = canvas.height;
    const unit = Math.max(W, H) / 1000;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is not available.");

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // 1. base image with CSS-style colour filters
    ctx.save();
    if (fx.flipH) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
    }
    ctx.filter = buildCssFilter(fx, unit);
    ctx.drawImage(image, 0, 0, W, H);
    ctx.restore();
    ctx.filter = "none";

    // 2. pixelate
    if (fx.pixelate > 0) {
        const block = Math.max(2, Math.round(fx.pixelate * unit));
        const sw = Math.max(1, Math.ceil(W / block));
        const sh = Math.max(1, Math.ceil(H / block));
        const small = document.createElement("canvas");
        small.width = sw;
        small.height = sh;
        const sctx = small.getContext("2d");
        if (sctx) {
            sctx.imageSmoothingEnabled = true;
            sctx.drawImage(canvas, 0, 0, sw, sh);
            ctx.clearRect(0, 0, W, H);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(small, 0, 0, sw, sh, 0, 0, sw * block, sh * block);
            ctx.imageSmoothingEnabled = true;
        }
    }

    // 3. per-pixel effects
    const needsPixels = fx.posterize > 0 || fx.duotone > 0 || fx.sharpen > 0 || fx.sketch > 0 || fx.rgbSplit > 0 || fx.glitch > 0;
    if (needsPixels) {
        const imageData = ctx.getImageData(0, 0, W, H);
        const d = imageData.data;

        if (fx.sharpen > 0) convolveSharpen(d, W, H, (fx.sharpen / 100) * 1.1);
        if (fx.sketch > 0) applySketch(d, W, H, fx.sketch / 100);

        if (fx.posterize > 0) {
            const levels = Math.max(2, Math.round(fx.posterize));
            const step = 255 / (levels - 1);
            for (let i = 0; i < d.length; i += 4) {
                d[i] = Math.round(d[i] / step) * step;
                d[i + 1] = Math.round(d[i + 1] / step) * step;
                d[i + 2] = Math.round(d[i + 2] / step) * step;
            }
        }

        if (fx.duotone > 0) {
            const [ar, ag, ab] = parseHex(fx.duoA);
            const [br, bg, bb] = parseHex(fx.duoB);
            const mix = fx.duotone / 100;
            for (let i = 0; i < d.length; i += 4) {
                const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
                d[i] = d[i] * (1 - mix) + (ar + (br - ar) * lum) * mix;
                d[i + 1] = d[i + 1] * (1 - mix) + (ag + (bg - ag) * lum) * mix;
                d[i + 2] = d[i + 2] * (1 - mix) + (ab + (bb - ab) * lum) * mix;
            }
        }

        if (fx.rgbSplit > 0) applyRgbSplit(d, W, H, fx.rgbSplit * unit);
        if (fx.glitch > 0) applyGlitch(d, W, H, fx.glitch / 100, fx.glitchSeed);

        ctx.putImageData(imageData, 0, 0);
    }

    // 4. bloom (glow from the bright parts)
    if (fx.bloom > 0) {
        const glow = document.createElement("canvas");
        glow.width = W;
        glow.height = H;
        const gctx = glow.getContext("2d");
        if (gctx) {
            gctx.filter = `brightness(1.25) contrast(1.15) blur(${(10 * unit).toFixed(1)}px)`;
            gctx.drawImage(canvas, 0, 0);
            gctx.filter = "none";
            ctx.globalCompositeOperation = "screen";
            ctx.globalAlpha = Math.min(1, fx.bloom / 100) * 0.85;
            ctx.drawImage(glow, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
        }
    }

    // 5. colour tint (keeps transparent PNG areas transparent)
    if (fx.tintStrength > 0) {
        ctx.globalCompositeOperation = "color";
        ctx.globalAlpha = fx.tintStrength / 100;
        ctx.fillStyle = fx.tint;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        if (options.keepAlpha) {
            const mask = document.createElement("canvas");
            mask.width = W;
            mask.height = H;
            const mctx = mask.getContext("2d");
            if (mctx) {
                if (fx.flipH) {
                    mctx.translate(W, 0);
                    mctx.scale(-1, 1);
                }
                mctx.drawImage(image, 0, 0, W, H);
                ctx.globalCompositeOperation = "destination-in";
                ctx.drawImage(mask, 0, 0);
            }
        }
        ctx.globalCompositeOperation = "source-over";
    }

    // 6. vignette
    if (fx.vignette > 0) {
        const gradient = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.95, fx.vignette / 100)})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, W, H);
    }

    // 7. scanlines
    if (fx.scanlines > 0) {
        const gap = Math.max(2, Math.round(3 * unit));
        ctx.fillStyle = `rgba(0,0,0,${(fx.scanlines / 100) * 0.45})`;
        for (let y = 0; y < H; y += gap * 2) ctx.fillRect(0, y, W, gap);
    }

    // 8. film grain
    if (fx.grain > 0) {
        const grainData = ctx.getImageData(0, 0, W, H);
        const g = grainData.data;
        const rand = seededRandom(fx.glitchSeed * 31 + 5);
        const amount = fx.grain * 1.3;
        for (let i = 0; i < g.length; i += 4) {
            const n = (rand() - 0.5) * amount;
            g[i] += n;
            g[i + 1] += n;
            g[i + 2] += n;
        }
        ctx.putImageData(grainData, 0, 0);
    }

    // 9. text / pasted-image layers
    for (const layer of layers) {
        drawLayer(ctx, layer, W, H, images);
    }

    // 10. selection frame (preview only)
    if (options.selectedId) {
        const layer = layers.find(item => item.id === options.selectedId);
        if (layer) {
            const box = getLayerBox(ctx, layer, W, H, images);
            if (box) {
                ctx.save();
                ctx.setLineDash([6, 4]);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = "#ffffff";
                ctx.shadowColor = "rgba(0,0,0,.8)";
                ctx.shadowBlur = 3;
                ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
                ctx.restore();
            }
        }
    }
}

function fontFor(layer: TextLayer, px: number) {
    return `${layer.italic ? "italic " : ""}${layer.bold ? "700 " : "500 "}${px}px ${FONT_STACKS[layer.font]}`;
}

export function getLayerBox(
    ctx: CanvasRenderingContext2D,
    layer: Layer,
    W: number,
    H: number,
    images: ImageCache
): { x: number; y: number; w: number; h: number; } | null {
    if (layer.kind === "text") {
        const px = Math.max(6, layer.size * H);
        ctx.save();
        ctx.font = fontFor(layer, px);
        const lines = layer.text.split("\n");
        const lineHeight = px * 1.18;
        const width = Math.max(px * 0.6, ...lines.map(line => ctx.measureText(line).width));
        ctx.restore();
        const height = lineHeight * lines.length;
        return { x: layer.x * W - width / 2, y: layer.y * H - height / 2, w: width, h: height };
    }

    const img = images.get(layer.id);
    if (!img || !img.naturalWidth) return null;
    const w = Math.max(8, layer.scale * W);
    const h = w * (img.naturalHeight / img.naturalWidth);
    return { x: layer.x * W - w / 2, y: layer.y * H - h / 2, w, h };
}

function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, W: number, H: number, images: ImageCache) {
    ctx.save();
    if (layer.kind === "text") {
        if (!layer.text.trim()) {
            ctx.restore();
            return;
        }
        const px = Math.max(6, layer.size * H);
        ctx.font = fontFor(layer, px);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        const lines = layer.text.split("\n");
        const lineHeight = px * 1.18;
        const top = layer.y * H - (lineHeight * (lines.length - 1)) / 2;

        lines.forEach((line, index) => {
            const y = top + index * lineHeight;
            if (layer.shadow) {
                ctx.shadowColor = "rgba(0,0,0,.65)";
                ctx.shadowBlur = px * 0.18;
                ctx.shadowOffsetY = px * 0.05;
            }
            if (layer.outline) {
                ctx.lineWidth = Math.max(2, px * 0.14);
                ctx.strokeStyle = layer.outlineColor;
                ctx.strokeText(line, layer.x * W, y);
                ctx.shadowColor = "transparent";
            }
            ctx.fillStyle = layer.color;
            ctx.fillText(line, layer.x * W, y);
            ctx.shadowColor = "transparent";
        });
    } else {
        const img = images.get(layer.id);
        const box = getLayerBox(ctx, layer, W, H, images);
        if (img && box) ctx.drawImage(img, box.x, box.y, box.w, box.h);
    }
    ctx.restore();
}

// Topmost layer under a point (canvas pixel coordinates).
export function hitTestLayers(
    canvas: HTMLCanvasElement,
    layers: Layer[],
    images: ImageCache,
    px: number,
    py: number
): string | null {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (let i = layers.length - 1; i >= 0; i--) {
        const box = getLayerBox(ctx, layers[i], canvas.width, canvas.height, images);
        if (box && px >= box.x - 6 && px <= box.x + box.w + 6 && py >= box.y - 6 && py <= box.y + box.h + 6) return layers[i].id;
    }
    return null;
}
