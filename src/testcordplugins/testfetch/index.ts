/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import { gitHash } from "@shared/vencordUserAgent";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { tryOrElse } from "@utils/misc";
import { makeCodeblock } from "@utils/text";
import definePlugin, { PluginNative } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { GuildMemberStore, LocaleStore, ThemeStore, UserStore } from "@webpack/common";

import { PluginMeta } from "~plugins";

import { getUserSettingLazy } from "../../api/UserSettings";

const Native = VencordNative.pluginHelpers.testfetch as PluginNative<typeof import("./native")>;

const VENCORD_GUILD_ID = "1015060230222131221";
const DONOR_ROLE_ID = "1042507929485586532";
const CONTRIBUTOR_ROLE_ID = "1026534353167208489";
const STALE_AFTER = 12096e5;

const ORANGE = "\x1b[38;5;208m";
const BOLD_ORANGE = "\x1b[1;38;5;208m";
const DARK_RED = "\x1b[38;5;88m";
const DIM_ORANGE = "\x1b[2;38;5;208m";
const RESET = "\x1b[0m";

const LOGO = [
    " _____ ___   _____ ____",
    "|_   _/ _| |_   _|  _ \\",
    "  | || (_|   | | | |_) |",
    "  | ||  _|   | | |  _ <",
    "  | || | |   | | | | \\ \\",
    "  |_||_| |_| |_| |_|  \\_\\"
];
const C_START = [10, 10, 10, 10, 10, 12];

const COLOR_BAR = [40, 41, 42, 43, 44, 45, 46, 47].map(c => `\x1b[2;${c}m███`).join("") + RESET;

const getVersions = findByCodeLazy("logsUploaded:new Date().toISOString(),");
const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame");

function capitalize(text: string) {
    return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

function bytes(value: number) {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let n = value;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function clientVersion() {
    if (IS_DISCORD_DESKTOP) return `Desktop v${DiscordNative.app.getVersion()}`;
    if (IS_VESKTOP) return `Vesktop v${VesktopNative.app.getVersion()}`;
    return IS_USERSCRIPT ? "UserScript" : "Web";
}

function operatingSystem() {
    const os = navigator.userAgent.match(/(?:Windows|Mac OS X|Linux|Android|iPhone OS)[^;)]*/)?.[0];
    const arch = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
    return [os ?? navigator.platform, arch].filter(Boolean).join(" / ");
}

function guildRoles() {
    const me = UserStore.getCurrentUser();
    const member = me && GuildMemberStore.getMember(VENCORD_GUILD_ID, me.id);
    return {
        donor: !!member?.roles.includes(DONOR_ROLE_ID),
        contributor: !!member?.roles.includes(CONTRIBUTOR_ROLE_ID)
    };
}

function pluginCounts() {
    const counts = { official: [0, 0], user: [0, 0] } satisfies Record<string, number[]>;

    for (const plugin of Object.values(Vencord.Plugins.plugins)) {
        if (plugin.name?.endsWith("API") || plugin.required) continue;
        const bucket = PluginMeta[plugin.name]?.userPlugin ? counts.user : counts.official;
        bucket[1]++;
        if (plugin.started) bucket[0]++;
    }

    const official = `${counts.official[0]} / ${counts.official[1]}`;
    return counts.user[1] ? `${official} official, ${counts.user[0]} / ${counts.user[1]} user` : `${official} official`;
}

function knownIssues() {
    return [
        isPluginEnabled("NoRPC") && "NoRPC",
        tryOrElse(() => !ShowCurrentGame?.getSetting(), false) && "activities disabled",
        BUILD_TIMESTAMP < Date.now() - STALE_AFTER && "outdated"
    ].filter(Boolean).join(", ");
}

async function collect() {
    const me = UserStore.getCurrentUser();
    const versions = getVersions();
    const sys = await tryOrElse(() => Native?.getSystemInfo?.(), null);
    const { donor, contributor } = guildRoles();

    return {
        user: me?.username ?? "unknown",
        version: `${VERSION} ~ ${gitHash} - ${Intl.DateTimeFormat(navigator.language, { dateStyle: "medium" }).format(BUILD_TIMESTAMP)}${IS_STANDALONE ? "" : " ~ dev"}`,
        client: `${capitalize(window.GLOBAL_ENV.RELEASE_CHANNEL)} ~ ${clientVersion()}`,
        build: `${versions.buildNumber} ~ ${versions.versionHash?.slice(0, 7) ?? "unknown"}`,
        issues: knownIssues(),
        os: operatingSystem(),
        cpu: sys ? `${sys.cores} cores (${sys.arch})` : "",
        memory: sys ? `${bytes(sys.heapUsed)} / ${bytes(sys.heapTotal)} heap, ${bytes(sys.systemTotal)} ram` : "",
        screen: `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`,
        theme: capitalize(ThemeStore.theme),
        locale: LocaleStore.locale,
        plugins: pluginCounts(),
        uptime: `${Math.max(0, ~~((Date.now() - window.GLOBAL_ENV.HTML_TIMESTAMP) / 1000))}s`,
        donor: donor ? "yes" : "no",
        contributor: contributor ? "yes" : "no"
    };
}

type Report = Awaited<ReturnType<typeof collect>>;

function render(data: Report) {
    const rows = ([
        ["", `${BOLD_ORANGE}${data.user}${RESET}@${DIM_ORANGE}testcord${RESET}`],
        ["version", data.version],
        ["client", data.client],
        ["build", data.build],
        ["issues", data.issues],
        ["os", data.os],
        ["cpu", data.cpu],
        ["memory", data.memory],
        ["screen", data.screen],
        ["theme", data.theme],
        ["locale", data.locale],
        ["plugins", data.plugins],
        ["uptime", data.uptime],
        ["donor", data.donor],
        ["contributor", data.contributor]
    ] as [string, string][]).filter(([, value]) => value.length);

    const indent = Math.max(...LOGO.map(line => line.length)) + 3;
    const height = Math.max(LOGO.length, rows.length);
    const lines: string[] = [];

    for (let i = 0; i < height; i++) {
        const art = i < LOGO.length
            ? `${ORANGE}${LOGO[i].slice(0, C_START[i])}${RESET}${DARK_RED}${LOGO[i].slice(C_START[i])}${RESET}${" ".repeat(indent - LOGO[i].length)}`
            : " ".repeat(indent);

        const row = rows[i];
        const text = !row ? "" : row[0] ? `${DIM_ORANGE}${capitalize(row[0])}: ${RESET}${row[1]}` : row[1];

        lines.push(`${art}${text}`);
    }

    return makeCodeblock(`${lines.join("\n")}${" ".repeat(indent)}${COLOR_BAR}`, "ansi");
}

async function buildReport(asJson: boolean) {
    const data = await collect();
    return asJson ? makeCodeblock(JSON.stringify(data, null, 2), "json") : render(data);
}

export default definePlugin({
    name: "testfetch",
    description: "System info card for Testcord, for bug reports",
    tags: ["Utility", "Developers", "Fun"],
    authors: [TestcordDevs.x2b],
    commands: [
        {
            name: "testfetch",
            description: "Show your Testcord system info",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "send",
                    description: "Post the card in chat instead of only showing it to you",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                },
                {
                    name: "json",
                    description: "Output raw JSON instead of the card",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                }
            ],
            async execute(args, ctx) {
                const content = await buildReport(findOption(args, "json", false));
                if (findOption(args, "send", false)) await sendMessage(ctx.channel.id, { content });
                else await sendBotMessage(ctx.channel.id, { content });
            }
        }
    ]
});
