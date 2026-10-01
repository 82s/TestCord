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

import { React, useEffect, useMemo, useReducer, useState } from "@webpack/common";
import type { ActionDispatch, ReactNode } from "react";

import { checkIntersecting } from "./misc";

export * from "./lazyReact";

export const NoopComponent = () => null;

/**
 * Check if a React node is a primitive (string, number, bigint, boolean, undefined)
 */
export function isPrimitiveReactNode(node: ReactNode): boolean {
    const t = typeof node;
    return t === "string" || t === "number" || t === "bigint" || t === "boolean" || t === "undefined";
}

/**
 * Shared IntersectionObserver.
 *
 * A browser IntersectionObserver is a native object with its own subscription
 * list; one per element meant N observers for N observed nodes, each firing its
 * own callback on every scroll frame past the viewport. One observer with a
 * callback map does the same work with a single native subscription.
 *
 * `checkIntersecting` is still consulted per element so an element already in
 * view on mount can skip the observer entirely (see useIntersection below).
 */
const sharedObserverCallbacks = new WeakMap<Element, Set<(entry: IntersectionObserverEntry) => void>>();
let sharedObserver: IntersectionObserver | null = null;

function getSharedObserver(): IntersectionObserver {
    return sharedObserver ??= new IntersectionObserver(entries => {
        for (const entry of entries) {
            const callbacks = sharedObserverCallbacks.get(entry.target);
            if (!callbacks) continue;
            for (const cb of callbacks) cb(entry);
        }
    });
}

function observeShared(element: Element, cb: (entry: IntersectionObserverEntry) => void) {
    let callbacks = sharedObserverCallbacks.get(element);
    if (!callbacks) {
        callbacks = new Set();
        sharedObserverCallbacks.set(element, callbacks);
        getSharedObserver().observe(element);
    }
    callbacks.add(cb);

    return () => {
        const set = sharedObserverCallbacks.get(element);
        if (!set) return;
        set.delete(cb);
        if (set.size === 0) sharedObserver?.unobserve(element);
    };
}

/**
 * Check if an element is on screen
 * @param intersectOnly If `true`, will only update the state when the element comes into view
 * @returns [refCallback, isIntersecting]
 */
export const useIntersection = (intersectOnly = false): [
    refCallback: React.RefCallback<Element>,
    isIntersecting: boolean,
] => {
    const unobserveRef = React.useRef<(() => void) | null>(null);
    const [isIntersecting, setIntersecting] = useState(false);

    const refCallback = React.useCallback((element: Element | null) => {
        unobserveRef.current?.();
        unobserveRef.current = null;

        if (!element) return;

        if (checkIntersecting(element)) {
            setIntersecting(true);
            if (intersectOnly) return;
        }

        let done = false;
        const onEntry = (entry: IntersectionObserverEntry) => {
            if (done) return;
            if (entry.isIntersecting && intersectOnly) {
                done = true;
                unobserveRef.current?.();
                unobserveRef.current = null;
                setIntersecting(true);
            } else {
                setIntersecting(entry.isIntersecting);
            }
        };

        unobserveRef.current = observeShared(element, onEntry);
    }, [intersectOnly]);

    React.useEffect(() => () => {
        unobserveRef.current?.();
        unobserveRef.current = null;
    }, []);

    return [refCallback, isIntersecting];
};

type AwaiterRes<T> = [T, any, boolean];
interface AwaiterOpts<T> {
    fallbackValue: T;
    deps?: unknown[];
    onError?(e: any): void;
    onSuccess?(value: T): void;
}
/**
 * Await a promise
 * @param factory Factory
 * @param fallbackValue The fallback value that will be used until the promise resolved
 * @returns [value, error, isPending]
 */
export function useAwaiter<T>(factory: () => Promise<T>): AwaiterRes<T | null>;
export function useAwaiter<T>(factory: () => Promise<T>, providedOpts: AwaiterOpts<T>): AwaiterRes<T>;
export function useAwaiter<T>(factory: () => Promise<T>, providedOpts?: AwaiterOpts<T | null>): AwaiterRes<T | null> {
    // Object.assign built a fresh opts object on every render, so the three
    // fields read below never compared equal and every consumer of this hook
    // re-allocated its effect closure for nothing. Read the fields directly.
    const fallbackValue = providedOpts?.fallbackValue ?? null;
    const deps = providedOpts?.deps;
    const onError = providedOpts?.onError;
    const onSuccess = providedOpts?.onSuccess;

    const [state, setState] = useState({
        value: fallbackValue as T | null,
        error: null,
        pending: true
    });

    useEffect(() => {
        let isAlive = true;
        setState(s => s.pending ? s : { ...s, pending: true });

        factory()
            .then(value => {
                if (!isAlive) return;
                setState({ value, error: null, pending: false });
                onSuccess?.(value);
            })
            .catch(error => {
                if (!isAlive) return;
                setState({ value: fallbackValue, error, pending: false });
                onError?.(error);
            });

        return () => void (isAlive = false);
    }, deps);

    return [state.value, state.error, state.pending];
}

/**
 * Returns a function that can be used to force rerender react components
 */
export function useForceUpdater(): ActionDispatch<[]>;
export function useForceUpdater(withDep: true): [any, ActionDispatch<[]>];
export function useForceUpdater(withDep?: true) {
    const r = useReducer(x => x + 1, 0);
    return withDep ? r : r[1];
}

interface TimerOpts {
    interval?: number;
    deps?: unknown[];
}

// Timers that only drive on-screen text (relative timestamps, call duration,
// clock widgets) are pure waste while the window is hidden — Chromium throttles
// their callbacks to ~1/min anyway, but it still wakes the renderer once a minute
// for nothing. Suspend on `visibilitychange` and resume on the way back, so a
// backgrounded window is genuinely idle instead of merely throttled.
function useVisibleTimer(callback: () => void, interval: number, deps: React.DependencyList) {
    const callbackRef = React.useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        let id: ReturnType<typeof setInterval> | null = null;

        const start = () => {
            if (id === null) id = setInterval(() => callbackRef.current(), interval);
        };
        const stop = () => {
            if (id !== null) {
                clearInterval(id);
                id = null;
            }
        };
        const sync = () => document.visibilityState === "hidden" ? stop() : start();

        sync();
        document.addEventListener("visibilitychange", sync);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            stop();
        };
    }, [interval, ...deps]);
}

export function useTimer({ interval = 1000, deps = [] }: TimerOpts) {
    const [time, setTime] = useState(0);
    const start = useMemo(() => Date.now(), deps);

    useVisibleTimer(() => setTime(Date.now() - start), interval, deps);

    return time;
}
interface FixedTimerOpts {
    interval?: number;
    initialTime?: number;
}

export function useFixedTimer({ interval = 1000, initialTime }: FixedTimerOpts) {
    // A Date.now() default would be re-evaluated on every render, so the effect below
    // tore down and rebuilt its interval each time and the reported elapsed time never
    // advanced past the first tick. Captured once instead; an explicit initialTime still
    // resets the timer when it changes, which is how callTimer restarts on a new call.
    const [defaultStart] = useState(() => Date.now());
    const start = initialTime ?? defaultStart;
    const [time, setTime] = useState(Date.now() - start);

    useVisibleTimer(() => setTime(Date.now() - start), interval, [start]);

    return time;
}

export function useCleanupEffect(
    effect: () => void,
    deps?: React.DependencyList
): void {
    useEffect(() => effect, deps);
}
