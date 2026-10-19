/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { sendMessage } from "@utils/discord";

import { logger, rememberSent } from "./utils";

export interface ScheduledMessage {
    id: string;
    channelId: string;
    content: string;
    dueAt: number;
}

const STORAGE_KEY = "RemoteControl_schedules_v1";
const MAX_TIMER_MS = 2_000_000_000;

let schedules: ScheduledMessage[] = [];
let loaded = false;
let loadPromise: Promise<void> | null = null;
let running = false;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function isScheduledMessage(value: unknown): value is ScheduledMessage {
    if (!value || typeof value !== "object") return false;

    const entry = value as Record<string, unknown>;
    return typeof entry.id === "string"
        && typeof entry.channelId === "string"
        && typeof entry.content === "string"
        && typeof entry.dueAt === "number";
}

async function load() {
    const saved = await DataStore.get<unknown>(STORAGE_KEY);
    schedules = Array.isArray(saved) ? saved.filter(isScheduledMessage) : [];
    loaded = true;

    for (const schedule of schedules) arm(schedule);
}

async function save() {
    await DataStore.set(STORAGE_KEY, schedules);
}

export async function ensureLoaded() {
    if (loaded) return;
    loadPromise ??= load();
    await loadPromise;
}

export function getSchedules() {
    return [...schedules];
}

export function scheduleMessage(channelId: string, content: string, delayMs: number) {
    return ensureLoaded().then(async () => {
        const schedule: ScheduledMessage = {
            id: createId(),
            channelId,
            content,
            dueAt: Date.now() + delayMs
        };

        schedules.push(schedule);
        arm(schedule);
        await save();

        return schedule;
    });
}

export async function cancelSchedule(idPrefix: string) {
    await ensureLoaded();

    const schedule = schedules.find(entry => entry.id.startsWith(idPrefix));
    if (!schedule) return false;

    const timer = timers.get(schedule.id);
    if (timer) clearTimeout(timer);
    timers.delete(schedule.id);

    schedules = schedules.filter(entry => entry.id !== schedule.id);
    await save();

    return true;
}

function arm(schedule: ScheduledMessage) {
    if (!running) return;

    const timer = timers.get(schedule.id);
    if (timer) clearTimeout(timer);

    const delay = schedule.dueAt - Date.now();
    if (delay > MAX_TIMER_MS) {
        timers.set(schedule.id, setTimeout(() => arm(schedule), MAX_TIMER_MS));
        return;
    }

    timers.set(schedule.id, setTimeout(() => void fire(schedule.id), Math.max(0, delay)));
}

async function fire(id: string) {
    const schedule = schedules.find(entry => entry.id === id);
    if (!schedule) return;

    timers.delete(id);

    try {
        rememberSent(schedule.channelId, schedule.content);
        await sendMessage(schedule.channelId, { content: schedule.content });
    } catch (error) {
        logger.error("Failed to send a scheduled message", error);
    } finally {
        schedules = schedules.filter(entry => entry.id !== id);
        await save();
    }
}

function createId() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

export function startScheduler() {
    running = true;
    void ensureLoaded().then(() => {
        for (const schedule of schedules) arm(schedule);
    });
}

export function stopScheduler() {
    running = false;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
}
