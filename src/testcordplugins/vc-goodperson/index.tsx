/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { escapeRegExp } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { UserStore } from "@webpack/common";

const CATEGORIES = {
    slurs: {
        label: "Slurs",
        nouns: ["retard", "retarded", "faggot", "fag", "tranny", "spic", "wetback", "chink", "kike", "coon", "gook", "paki"],
        verbs: [],
        patterns: ["\\bn[i1!]{1,2}g[a@3e]{2,}\\w*"]
    },
    sexual: {
        label: "Sexual terms",
        nouns: ["cum", "cunt", "dick", "pussy", "slut", "whore", "boobs", "boobies", "tits", "blowjob", "porn", "boner"],
        verbs: ["fuck", "fucks", "fucking", "cumming"]
    },
    insults: {
        label: "General insults",
        nouns: ["idiot", "moron", "imbecile", "dumbass", "loser", "pathetic", "worthless", "garbage", "trash"],
        verbs: ["kill", "murder", "destroy", "ruin", "obliterate"]
    },
    brainrot: {
        label: "Brainrot",
        nouns: ["skibidi", "gyatt", "rizzler", "rizz", "mewing", "mew", "ohio", "boykisser", "nettspend", "hawk tuah"],
        verbs: []
    },
    annoyances: {
        label: "Personal annoyances",
        nouns: ["kotlin", "avast", "iphone", "apple music"],
        verbs: []
    }
} as const;

type CategoryKey = keyof typeof CATEGORIES;
// only the slur category carries patterns, so this has to be optional
type Category = { label: string; nouns: readonly string[]; verbs: readonly string[]; patterns?: readonly string[] };

const NOUNS = [
    "pasta", "kebab", "cake", "potato", "waffle", "computer", "keyboard", "woman", "monster truck",
    "umbrella", "mosque", "queen", "storm", "physics", "bathroom", "airport", "owner", "mom",
    "good", "java", "hamburger", "plant", "dragon", "wizard", "noodle", "penguin", "robot"
] as const;

const VERBS = [
    "love", "hug", "teach", "marry", "dance", "explode", "melt", "brush", "date", "freeze", "tickle",
    "free", "feed", "water", "high five", "respect", "admire", "thank", "comfort", "welcome"
] as const;

const settings = definePluginSettings({
    filterOutgoing: {
        description: "Clean up the messages I send",
        type: OptionType.BOOLEAN,
        default: true
    },
    markIncoming: {
        description: "Point out messages from other people that needed cleaning",
        type: OptionType.BOOLEAN,
        default: true
    },
    slurs: {
        description: CATEGORIES.slurs.label,
        type: OptionType.BOOLEAN,
        default: true
    },
    sexual: {
        description: CATEGORIES.sexual.label,
        type: OptionType.BOOLEAN,
        default: true
    },
    insults: {
        description: CATEGORIES.insults.label,
        type: OptionType.BOOLEAN,
        default: true
    },
    brainrot: {
        description: CATEGORIES.brainrot.label,
        type: OptionType.BOOLEAN,
        default: false
    },
    annoyances: {
        description: CATEGORIES.annoyances.label,
        type: OptionType.BOOLEAN,
        default: false
    }
});

const category = (key: CategoryKey) => CATEGORIES[key] as Category;
const enabled = () => (Object.keys(CATEGORIES) as CategoryKey[]).filter(key => settings.plain[key]);

/** longest first, so "fucking" cannot match as "fuck" and leave "ing" dangling off the end */
const alternation = (words: readonly string[]) => [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");

const words = (list: readonly string[]) => new RegExp(`\\b(${alternation(list)})\\b`, "gi");

interface Rule {
    regex: RegExp;
    pool: readonly string[];
}

interface Compiled {
    key: string;
    /** one stateless probe per category, for deciding whether a message needs cleaning at all */
    probes: { key: CategoryKey; regex: RegExp }[];
    rules: Rule[];
}

/**
 * Module scope on purpose. The settings store is persisted as JSON, and a RegExp does not
 * survive that: it comes back as a truthy `{}` that matches nothing, which silently disables
 * the whole plugin until a setting is toggled.
 */
let compiled: Compiled = { key: "", probes: [], rules: [] };

function compile() {
    const active = enabled();
    const key = active.join(",");
    if (compiled.key === key) return;

    const probes: Compiled["probes"] = [];
    const rules: Rule[] = [];

    for (const name of active) {
        const { nouns, verbs, patterns = [] } = category(name);

        // the probe needs the same word boundaries as the replacement rules, otherwise it
        // reports "cum" inside "circumference" as a hit and the note shows on untouched text
        const parts = [
            nouns.length ? `\\b(?:${alternation(nouns)})\\b` : "",
            verbs.length ? `\\b(?:${alternation(verbs)})\\b` : "",
            ...patterns
        ].filter(Boolean);

        probes.push({ key: name, regex: new RegExp(parts.join("|"), "i") });

        if (nouns.length) rules.push({ regex: words(nouns), pool: NOUNS });
        if (verbs.length) rules.push({ regex: words(verbs), pool: VERBS });
        if (patterns.length) rules.push({ regex: new RegExp(`(${patterns.join("|")})`, "gi"), pool: NOUNS });
    }

    compiled = { key, probes, rules };
}

const pick = (pool: readonly string[]) => pool[Math.floor(Math.random() * pool.length)];

/** fenced blocks and `inline code` are left alone, so pasting code does not get mangled */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

function split(content: string) {
    const parts: { code: boolean; text: string }[] = [];
    let cursor = 0;

    for (const match of content.matchAll(CODE)) {
        if (match.index > cursor) parts.push({ code: false, text: content.slice(cursor, match.index) });
        parts.push({ code: true, text: match[0] });
        cursor = match.index + match[0].length;
    }

    if (cursor < content.length) parts.push({ code: false, text: content.slice(cursor) });
    return parts;
}

function cleanSegment(text: string) {
    let out = text;
    for (const { regex, pool } of compiled.rules) {
        regex.lastIndex = 0;
        out = out.replace(regex, () => pick(pool));
    }
    return out;
}

function clean(content: string) {
    compile();
    if (compiled.rules.length === 0) return content;

    return split(content).map(part => (part.code ? part.text : cleanSegment(part.text))).join("");
}

function needsCleaning(content: string) {
    compile();
    return split(content).some(part => !part.code && compiled.probes.some(({ regex }) => regex.test(part.text)));
}

function matchedCategories(content: string) {
    compile();
    return compiled.probes.filter(({ regex }) => regex.test(content)).map(({ key }) => category(key).label.toLowerCase());
}

const Note = ErrorBoundary.wrap(function GoodPersonNote({ content }: { content: string }) {
    const hits = matchedCategories(content);
    if (hits.length === 0) return null;

    return (
        <span className="vc-goodperson-note">
            {`GoodPerson softened this: ${hits.join(", ")}`}
        </span>
    );
}, { noop: true });

export default definePlugin({
    name: "GoodPerson",
    description: "Softens the language in what you send, and points it out when others do the same",
    tags: ["Utility", "Fun"],
    authors: [TestcordDevs.x2b],
    settings,

    onBeforeMessageSend(_channelId, message) {
        if (settings.plain.filterOutgoing) message.content = clean(message.content);
    },

    renderMessageDecoration: ({ message }) => {
        if (!settings.plain.markIncoming) return null;
        if (message.author.id === UserStore.getCurrentUser()?.id) return null;
        if (!needsCleaning(message.content)) return null;

        return <Note content={message.content} />;
    }
});
