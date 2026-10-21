/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

const logger = new Logger("TestcordHelper");

let observer: MutationObserver | null = null;
let enabled = false;

type RemovedRule = {
    parent: CSSStyleSheet | CSSGroupingRule;
    index: number;
    cssText: string;
};

const removedRules: RemovedRule[] = [];

function isExperimentalRule(rule: CSSStyleRule) {
    const selector = rule.selectorText;
    if (!selector?.includes(":has(*)")) return false;

    const css = rule.cssText;
    return css.includes("--green-360") || css.includes("--red-400");
}

function cleanRules(rules: CSSRuleList, parent: CSSStyleSheet | CSSGroupingRule) {
    for (let i = rules.length - 1; i >= 0; i--) {
        const rule = rules[i];
        const styleRule = rule as CSSStyleRule;

        if (styleRule.type === CSSRule.STYLE_RULE) {
            if (styleRule.selectorText && isExperimentalRule(styleRule)) {
                logger.info("Removed experimental Discord CSS rule", styleRule.cssText);
                removedRules.push({ parent, index: i, cssText: styleRule.cssText });
                parent.deleteRule(i);
            }
            continue;
        }

        if ("cssRules" in rule && rule.type !== CSSRule.KEYFRAMES_RULE) {
            const group = rule as CSSGroupingRule;
            cleanRules(group.cssRules, group);
        }
    }
}

function cleanSheet(sheet: CSSStyleSheet) {
    try {
        cleanRules(sheet.cssRules, sheet);
    } catch (e) {
        logger.debug("Could not inspect stylesheet rules", e);
    }
}

function handleNode(node: Node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;

    if (element.matches('link[rel="stylesheet"]')) {
        const link = element as HTMLLinkElement;
        if (link.sheet) {
            cleanSheet(link.sheet);
        } else {
            link.addEventListener("load", () => {
                if (enabled && link.sheet) cleanSheet(link.sheet);
            }, { once: true });
        }
    } else if (element.matches("style")) {
        const style = element as HTMLStyleElement;
        if (style.sheet) cleanSheet(style.sheet);
    }
}

export function installFixDiscordCssExperimental() {
    if (observer) return;

    enabled = true;

    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
        handleNode(node);
    }

    observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            m.addedNodes.forEach(handleNode);
        }
    });
    observer.observe(document.head, { childList: true });
}

export function uninstallFixDiscordCssExperimental() {
    enabled = false;
    observer?.disconnect();
    observer = null;

    const rules = removedRules.splice(0).sort((a, b) => a.index - b.index);
    for (const rule of rules) {
        try {
            rule.parent.insertRule(rule.cssText, rule.index);
        } catch (e) {
            logger.warn("Failed to restore experimental Discord CSS rule", e);
        }
    }
}
