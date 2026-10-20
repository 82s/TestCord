/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useEffect, useState } from "@webpack/common";

const BLUR_SIZE = 128;
const BLUR_PASSES = 8;
const WARP_INTENSITY = 1;
const SATURATION = 1.5;
const CSS_SATURATION = 2.5;
const CSS_BRIGHTNESS = 0.65;
const DITHERING = 0.008;
const SCALE = 1;
const TRANSITION_MS = 1000;
const PLAYING_SPEED = 1;
const PAUSED_SPEED = 0.1;
const TINT_COLOR = [0.16, 0.16, 0.24];
const TINT_INTENSITY = 0;

const VERTEX = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}`;

const TINT = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec3 u_tintColor;
uniform float u_tintIntensity;
void main() {
    vec4 color = texture2D(u_texture, v_texCoord);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float darkMask = 1.0 - smoothstep(0.0, 0.5, luma);
    color.rgb = mix(color.rgb, u_tintColor, darkMask * u_tintIntensity);
    gl_FragColor = color;
}`;

const BLUR = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_offset;
void main() {
    vec2 px = vec2(u_offset) / u_resolution;
    vec4 sum = texture2D(u_texture, v_texCoord + vec2(-px.x, -px.y));
    sum += texture2D(u_texture, v_texCoord + vec2(px.x, -px.y));
    sum += texture2D(u_texture, v_texCoord + vec2(-px.x, px.y));
    sum += texture2D(u_texture, v_texCoord + vec2(px.x, px.y));
    gl_FragColor = sum * 0.25;
}`;

const WARP_OUTPUT = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform float u_blend;
uniform float u_time;
uniform float u_intensity;
uniform float u_scale;
uniform float u_saturation;
uniform float u_cssSaturation;
uniform float u_brightness;
uniform float u_dithering;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

vec3 saturateColor(vec3 c, float amount) {
    float gray = dot(c, vec3(0.299, 0.587, 0.114));
    return clamp(mix(vec3(gray), c, amount), 0.0, 1.0);
}

void main() {
    vec2 uv = (v_texCoord - 0.5) / u_scale + 0.5;

    float t = u_time * 0.2;
    vec2 centered = uv - 0.5;
    float centerWeight = clamp(1.0 - dot(centered, centered) * 1.6, 0.0, 1.0);
    float n1 = snoise(uv * 1.6 + vec2(t, t * 0.8));
    float n2 = snoise(uv * 1.6 + vec2(-t * 0.9, t * 1.1) + 31.7);
    float n3 = snoise(uv * 3.2 + vec2(t * 1.4, -t * 1.2) + 71.3) * 0.5;
    float n4 = snoise(uv * 3.2 + vec2(-t * 1.1, -t * 1.5) + 113.9) * 0.5;
    vec2 warp = vec2(n1 + n3, n2 + n4) * 0.16 * u_intensity * centerWeight;
    vec2 warped = clamp(uv + warp, 0.0, 1.0);

    vec3 color = mix(texture2D(u_texture1, warped).rgb, texture2D(u_texture2, warped).rgb, u_blend);

    vec2 vc = v_texCoord - 0.5;
    color *= 1.0 - dot(vc, vc) * 0.3;
    color = saturateColor(color, u_saturation);

    color = saturateColor(color, u_cssSaturation) * u_brightness;

    color += (hash(vec3(gl_FragCoord.xy, floor(u_time * 60.0))) - 0.5) * u_dithering;
    gl_FragColor = vec4(color, 1.0);
}`;

interface Fbo {
    framebuffer: WebGLFramebuffer;
    texture: WebGLTexture;
}

class KawarpRenderer {
    private gl: WebGLRenderingContext;
    private programs: Record<"tint" | "blur" | "warp", WebGLProgram>;
    private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
    private quad: WebGLBuffer;
    private source: WebGLTexture;
    private ping: Fbo;
    private pong: Fbo;
    private albums: Fbo[];
    private curI = 0;
    private nextI = 0;
    private blend = 1;
    private fadeStart = 0;
    private hasContent = false;

    constructor(private canvas: HTMLCanvasElement) {
        const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
        if (!gl) throw new Error("WebGL unavailable");
        this.gl = gl;

        this.programs = {
            tint: this.program(TINT),
            blur: this.program(BLUR),
            warp: this.program(WARP_OUTPUT),
        };

        this.quad = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 0, 0,
            1, -1, 1, 0,
            -1, 1, 0, 1,
            1, 1, 1, 1,
        ]), gl.STATIC_DRAW);

        this.source = this.texture();
        this.ping = this.fbo();
        this.pong = this.fbo();
        this.albums = [this.fbo(), this.fbo(), this.fbo()];
    }

    private program(fragment: string): WebGLProgram {
        const { gl } = this;
        const compile = (type: number, src: string) => {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, src);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
            }
            return shader;
        };
        const program = gl.createProgram()!;
        gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("program link failed");
        return program;
    }

    private texture(): WebGLTexture {
        const { gl } = this;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    private fbo(): Fbo {
        const { gl } = this;
        const texture = this.texture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BLUR_SIZE, BLUR_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const framebuffer = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { framebuffer, texture };
    }

    private use(program: WebGLProgram) {
        const { gl } = this;
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
        const pos = gl.getAttribLocation(program, "a_position");
        const uv = gl.getAttribLocation(program, "a_texCoord");
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(uv);
        gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
    }

    private loc(program: WebGLProgram, name: string) {
        let map = this.uniforms.get(program);
        if (!map) this.uniforms.set(program, map = new Map());
        if (!map.has(name)) map.set(name, this.gl.getUniformLocation(program, name));
        return map.get(name)!;
    }

    private bind(unit: number, texture: WebGLTexture) {
        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    }

    setSource(image: HTMLImageElement, now: number) {
        const { gl } = this;

        gl.bindTexture(gl.TEXTURE_2D, this.source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        gl.viewport(0, 0, BLUR_SIZE, BLUR_SIZE);

        this.use(this.programs.tint);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.ping.framebuffer);
        this.bind(0, this.source);
        gl.uniform1i(this.loc(this.programs.tint, "u_texture"), 0);
        gl.uniform3f(this.loc(this.programs.tint, "u_tintColor"), TINT_COLOR[0], TINT_COLOR[1], TINT_COLOR[2]);
        gl.uniform1f(this.loc(this.programs.tint, "u_tintIntensity"), TINT_INTENSITY);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        const spareI = [0, 1, 2].find(i => i !== this.curI && i !== this.nextI)!;
        const target = this.albums[spareI];
        this.use(this.programs.blur);
        gl.uniform1i(this.loc(this.programs.blur, "u_texture"), 0);
        gl.uniform2f(this.loc(this.programs.blur, "u_resolution"), BLUR_SIZE, BLUR_SIZE);
        let read = this.ping;
        let write = this.pong;
        for (let i = 0; i < Math.max(BLUR_PASSES, 1); i++) {
            const last = i === Math.max(BLUR_PASSES, 1) - 1;
            gl.bindFramebuffer(gl.FRAMEBUFFER, last ? target.framebuffer : write.framebuffer);
            this.bind(0, read.texture);
            gl.uniform1f(this.loc(this.programs.blur, "u_offset"), i + 0.5);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            [read, write] = [write, read];
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        if (!this.hasContent) {
            this.curI = this.nextI = spareI;
            this.blend = 1;
            this.hasContent = true;
        } else {
            this.curI = this.nextI;
            this.nextI = spareI;
            this.blend = 0;
            this.fadeStart = now;
        }
    }

    resize(width: number, height: number) {
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }

    render(timeSec: number, now: number) {
        const { gl, canvas } = this;
        if (!this.hasContent) return;

        if (this.blend < 1) this.blend = Math.min((now - this.fadeStart) / TRANSITION_MS, 1);
        const eased = this.blend * this.blend * (3 - 2 * this.blend);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        const p = this.programs.warp;
        this.use(p);
        this.bind(0, this.albums[this.curI].texture);
        this.bind(1, this.albums[this.nextI].texture);
        gl.uniform1i(this.loc(p, "u_texture1"), 0);
        gl.uniform1i(this.loc(p, "u_texture2"), 1);
        gl.uniform1f(this.loc(p, "u_blend"), eased);
        gl.uniform1f(this.loc(p, "u_time"), timeSec);
        gl.uniform1f(this.loc(p, "u_intensity"), WARP_INTENSITY);
        gl.uniform1f(this.loc(p, "u_scale"), SCALE);
        gl.uniform1f(this.loc(p, "u_saturation"), SATURATION);
        gl.uniform1f(this.loc(p, "u_cssSaturation"), CSS_SATURATION);
        gl.uniform1f(this.loc(p, "u_brightness"), CSS_BRIGHTNESS);
        gl.uniform1f(this.loc(p, "u_dithering"), DITHERING);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    dispose() {
        const { gl } = this;
        for (const fbo of [this.ping, this.pong, ...this.albums]) {
            gl.deleteFramebuffer(fbo.framebuffer);
            gl.deleteTexture(fbo.texture);
        }
        gl.deleteTexture(this.source);
        gl.deleteBuffer(this.quad);
        Object.values(this.programs).forEach(p => gl.deleteProgram(p));
        gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
    let promise = imageCache.get(url);
    if (!promise) {
        promise = new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });
        imageCache.set(url, promise);
        promise.catch(() => imageCache.delete(url));
        if (imageCache.size > 8) imageCache.delete(imageCache.keys().next().value!);
    }
    return promise;
}

export function DynamicBackground({ imageUrl, isPlaying, lite = false }: { imageUrl?: string | null; isPlaying: boolean; lite?: boolean; }) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const rendererRef = React.useRef<KawarpRenderer | null>(null);
    const playingRef = React.useRef(isPlaying);
    playingRef.current = isPlaying;
    const [fallback, setFallback] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let renderer: KawarpRenderer;
        try {
            renderer = new KawarpRenderer(canvas);
        } catch {
            setFallback(true);
            return;
        }
        rendererRef.current = renderer;

        const pixelScale = lite ? 0.3 : 0.45;
        let raf = 0;
        let lastDraw = 0;
        let last = 0;
        let time = 0;
        let speed = PLAYING_SPEED;

        const frame = (now: number) => {
            raf = requestAnimationFrame(frame);
            if (document.hidden) { last = 0; return; }

            const playing = playingRef.current;
            if (now - lastDraw < (playing ? 1000 / 30 : 1000 / 15)) return;
            lastDraw = now;

            const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
            last = now;
            speed += ((playing ? PLAYING_SPEED : PAUSED_SPEED) - speed) * Math.min(dt * 2, 1);
            time += dt * speed;

            renderer.resize(
                Math.max(16, Math.round(canvas.clientWidth * pixelScale)),
                Math.max(16, Math.round(canvas.clientHeight * pixelScale))
            );
            renderer.render(time, now);
        };
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            renderer.dispose();
            rendererRef.current = null;
        };
    }, [lite]);

    useEffect(() => {
        if (!imageUrl) return;
        let cancelled = false;
        loadImage(imageUrl).then(img => {
            if (cancelled) return;
            try {
                rendererRef.current?.setSource(img, performance.now());
            } catch {
                setFallback(true);
            }
        }).catch(() => { if (!cancelled) setFallback(true); });
        return () => { cancelled = true; };
    }, [imageUrl, lite]);

    if (fallback) {
        return (
            <div className="vc-spotify-dynbg" aria-hidden>
                <div
                    className="vc-spotify-dynbg-fallback"
                    style={{ backgroundImage: imageUrl ? `url("${imageUrl}")` : undefined }}
                />
            </div>
        );
    }

    return (
        <div className="vc-spotify-dynbg" aria-hidden>
            <canvas ref={canvasRef} />
        </div>
    );
}
