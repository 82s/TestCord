/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { isPluginEnabled, pluginRequiresRestart, plugins, startDependenciesRecursive, startPlugin, stopPlugin } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { sendMessage } from "@utils/discord";
import { findPlugin, getPluginId } from "@utils/pluginIds";
import { formatDuration, makeCodeblock } from "@utils/text";
import { OptionType, type Plugin, type PluginSettingDef } from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelActions, ChannelRouter, ChannelStore, Constants, DraftStore, DraftType, GuildChannelStore, GuildMemberCountStore, GuildStore, MediaEngineStore, MessageActions, moment, RestAPI, SnowflakeUtils, UserStore, VoiceActions, VoiceStateStore } from "@webpack/common";

import { executeLocalCommand, findLocalCommand, getLocalCommands } from "./local";
import { cancelSchedule, ensureLoaded, getSchedules, scheduleMessage } from "./scheduler";
import { settings } from "./settings";
import { executeSlashCommand, queryApplicationCommands } from "./slash";
import {
    bindChannel,
    logger,
    parseBoolean,
    type ParsedCommand,
    parseDuration,
    rememberSent,
    type RemoteContext,
    reply,
    replyDone,
    replyError,
    replyInfo,
    resolveChannel,
    resolveGuild,
    resolveUser,
    splitWords,
    stripOptions,
    unbindChannel
} from "./utils";

const PresenceSetting = getUserSettingLazy<string>("status", "status");
const DraftManager = findByPropsLazy("clearDraft", "saveDraft");
const STATE_TTL = 10 * 60_000;
const MAX_SCHEDULE_MS = 20 * 86_400_000;
const CMDS_PAGE_SIZE = 20;

let startedAt = Date.now();

interface CommandDef {
    category: string;
    usage: string;
    description: string;
    handler(ctx: RemoteContext, parsed: ParsedCommand): Promise<void> | void;
}

interface ChannelState {
    candidates?: { plugins: Plugin[]; expires: number; };
    selected?: { plugin: Plugin; expires: number; };
    settings?: { plugin: Plugin; keys: string[]; expires: number; };
}

const states = new Map<string, ChannelState>();

export const commandDefs: Record<string, CommandDef> = {};
const commandAliases: Record<string, string> = {
    plugins: "plugin",
    restart: "reload",
    echo: "say",
    raw: "say",
    msg: "say",
    cmd: "slash",
    deaf: "deafen",
    undeaf: "undeafen"
};

export function markStarted() {
    startedAt = Date.now();
}

function cmd(name: string) {
    return `${settings.store.prefix || "."}${name}`;
}

export function clearCommandState() {
    states.clear();
}

function getState(channelId: string) {
    let state = states.get(channelId);
    if (!state) {
        state = {};
        states.set(channelId, state);
    }
    return state;
}

function isValid<T extends { expires: number; }>(entry: T | undefined): entry is T {
    return entry !== undefined && entry.expires > Date.now();
}

function getSelectedPlugin(state: ChannelState) {
    if (isValid(state.selected)) return state.selected.plugin;
    if (isValid(state.settings)) return state.settings.plugin;
    return undefined;
}

function formatValue(value: unknown) {
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "bigint") return `${value}n`;
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "object") {
        try {
            const json = JSON.stringify(value);
            if (!json) return String(value);
            return json.length > 80 ? `${json.slice(0, 77)}...` : json;
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function settingTypeName(definition: PluginSettingDef) {
    switch (definition.type) {
        case OptionType.STRING: return "string";
        case OptionType.NUMBER: return "number";
        case OptionType.BIGINT: return "bigint";
        case OptionType.BOOLEAN: return "boolean";
        case OptionType.SELECT: return "select";
        case OptionType.SLIDER: return "slider";
        case OptionType.COMPONENT: return "component";
        case OptionType.CUSTOM: return "custom";
    }
}

function getSettingEntries(plugin: Plugin) {
    const pluginSettings = plugin.settings;
    if (!pluginSettings) return [];

    return Object.entries(pluginSettings.def).map(([key, definition]) => ({
        key,
        definition,
        value: Reflect.get(pluginSettings.store, key)
    }));
}

function findSetting(plugin: Plugin, key: string) {
    return getSettingEntries(plugin).find(
        entry => entry.key.toLowerCase() === key.toLowerCase()
            || ("displayName" in entry.definition && entry.definition.displayName?.toLowerCase() === key.toLowerCase())
    );
}

function searchPlugins(query: string, limit = 25) {
    const lowerQuery = query.trim().toLowerCase();
    const all = Object.values(plugins).filter(plugin => plugin?.name);
    const unique = [...new Map(all.map(plugin => [getPluginId(plugin), plugin])).values()];

    const scored = unique.map(plugin => {
        const names = [plugin.name, plugin.id, ...(plugin.aliases ?? [])]
            .filter((name): name is string => Boolean(name))
            .map(name => name.toLowerCase());
        let score = lowerQuery ? 0 : 1;

        if (lowerQuery) {
            if (names.includes(lowerQuery)) score = 1000;
            else if (names.some(name => name.startsWith(lowerQuery))) score = 500;
            else if (names.some(name => name.includes(lowerQuery))) score = 250;
            else if (plugin.searchTerms?.some(term => term.toLowerCase().includes(lowerQuery))) score = 75;
            else if (plugin.description.toLowerCase().includes(lowerQuery)) score = 50;
        }

        return { plugin, score };
    }).filter(entry => entry.score > 0);

    return scored
        .sort((a, b) => b.score - a.score || a.plugin.name.localeCompare(b.plugin.name))
        .slice(0, limit)
        .map(entry => entry.plugin);
}

function findPluginByQuery(query: string) {
    if (!query) return undefined;

    const exact = findPlugin(query, plugins);
    if (exact) return exact;

    const matches = searchPlugins(query, 2);
    return matches.length === 1 ? matches[0] : undefined;
}

async function requirePlugin(ctx: RemoteContext, query: string) {
    const plugin = findPluginByQuery(query);
    if (plugin) return plugin;

    const matches = searchPlugins(query, 8);
    if (!matches.length) {
        await replyError(ctx, `No plugin matches "${query}".`);
        return undefined;
    }

    await replyError(ctx, `Multiple plugins match "${query}": ${matches.map(match => match.name).join(", ")}. Use the full name.`);
    return undefined;
}

function setEnabledSetting(plugin: Plugin, enabled: boolean) {
    const id = getPluginId(plugin);
    Settings.plugins[id] ??= { enabled };
    Settings.plugins[id].enabled = enabled;

    if (id !== plugin.name) {
        Settings.plugins[plugin.name] ??= { enabled };
        Settings.plugins[plugin.name].enabled = enabled;
    }
}

function setPluginEnabled(plugin: Plugin, enabled: boolean) {
    const wasEnabled = isPluginEnabled(plugin.name);
    if (wasEnabled === enabled) return `${plugin.name} is already ${enabled ? "enabled" : "disabled"}.`;
    if (plugin.required) throw new Error(`${plugin.name} is required and cannot be disabled.`);

    if (enabled) {
        const { restartNeeded, failures } = startDependenciesRecursive(plugin);
        if (failures.length) throw new Error(`Failed to start dependencies: ${failures.join(", ")}`);

        if (restartNeeded) {
            setEnabledSetting(plugin, true);
            return `${plugin.name} enabled. Restart required to apply.`;
        }
    }

    if (pluginRequiresRestart(plugin)) {
        setEnabledSetting(plugin, enabled);
        return `${plugin.name} ${enabled ? "enabled" : "disabled"}. Restart required to apply.`;
    }

    if (enabled && plugin.started) {
        setEnabledSetting(plugin, true);
        return `${plugin.name} enabled.`;
    }

    if (!enabled && !plugin.started) {
        setEnabledSetting(plugin, false);
        return `${plugin.name} disabled.`;
    }

    setEnabledSetting(plugin, enabled);
    const result = enabled ? startPlugin(plugin) : stopPlugin(plugin);

    if (!result) {
        setEnabledSetting(plugin, wasEnabled);
        throw new Error(`Failed to ${enabled ? "start" : "stop"} ${plugin.name}.`);
    }

    return `${plugin.name} ${enabled ? "enabled" : "disabled"}.`;
}

async function showPluginDetail(ctx: RemoteContext, plugin: Plugin) {
    const enabled = isPluginEnabled(plugin.name);
    const authors = plugin.authors.map(author => author.name).join(", ");
    const settingsCount = plugin.settings ? Object.keys(plugin.settings.def).length : 0;
    const lines = [
        `**${plugin.name}** (${enabled ? "enabled" : "disabled"})`,
        plugin.description,
        `Authors: ${authors}`,
        `Tags: ${plugin.tags?.join(", ") || "none"}`,
        `Settings: ${settingsCount}`
    ];

    if (plugin.dependencies?.length) lines.push(`Dependencies: ${plugin.dependencies.join(", ")}`);
    if (plugin.required) lines.push("This plugin is required.");
    if (settingsCount) lines.push(`Use ${cmd(`settings ${plugin.name}`)} to view or change settings.`);

    await replyInfo(ctx, lines.join("\n"));
}

function parseSettingValue(definition: PluginSettingDef, raw: string) {
    switch (definition.type) {
        case OptionType.STRING:
            return raw;
        case OptionType.NUMBER: {
            const value = Number(raw);
            if (!Number.isFinite(value)) throw new Error("Value must be a number.");
            return value;
        }
        case OptionType.BIGINT:
            if (!/^-?\d+$/.test(raw)) throw new Error("Value must be a whole number.");
            return BigInt(raw);
        case OptionType.BOOLEAN: {
            const value = parseBoolean(raw);
            if (value === null) throw new Error("Value must be true or false.");
            return value;
        }
        case OptionType.SELECT: {
            const option = definition.options.find(
                choice => choice.label.toLowerCase() === raw.toLowerCase() || String(choice.value).toLowerCase() === raw.toLowerCase()
            );
            if (!option) throw new Error(`Value must be one of: ${definition.options.map(choice => choice.label).join(", ")}`);
            return option.value;
        }
        case OptionType.SLIDER: {
            const value = Number(raw);
            if (!Number.isFinite(value)) throw new Error("Value must be a number.");
            if (definition.stickToMarkers && !definition.markers.includes(value)) {
                throw new Error(`Value must be one of: ${definition.markers.join(", ")}`);
            }
            if (value < definition.markers[0] || value > definition.markers[definition.markers.length - 1]) {
                throw new Error(`Value must be between ${definition.markers[0]} and ${definition.markers[definition.markers.length - 1]}.`);
            }
            return value;
        }
        default:
            throw new Error("This setting cannot be changed remotely.");
    }
}

async function applySetting(ctx: RemoteContext, plugin: Plugin, key: string, raw: string) {
    const entry = findSetting(plugin, key);
    if (!entry) throw new Error(`Unknown setting "${key}" for ${plugin.name}.`);

    const pluginSettings = plugin.settings;
    if (!pluginSettings) throw new Error(`${plugin.name} has no settings.`);

    const value = parseSettingValue(entry.definition, raw);
    const check = entry.definition.isValid?.call(pluginSettings, value);
    if (check === false) throw new Error(`"${raw}" is not a valid value for ${entry.key}.`);
    if (typeof check === "string") throw new Error(check);

    Reflect.set(pluginSettings.store, entry.key, value);

    const suffix = entry.definition.restartNeeded ? " Restart required to apply." : "";
    await replyDone(ctx, `${plugin.name}.${entry.key} = ${formatValue(value)}.${suffix}`);
}

function resolveTarget(parsed: ParsedCommand, state: ChannelState) {
    const words = parsed.positional;
    const firstPlugin = words[0] ? findPluginByQuery(words[0]) : undefined;

    if (firstPlugin && words.length >= 2) {
        return { plugin: firstPlugin, key: words[1], valueStart: 2 };
    }

    return { plugin: getSelectedPlugin(state), key: words[0], valueStart: 1 };
}

function resolveSettingKey(state: ChannelState, plugin: Plugin, key: string) {
    if (!/^\d+$/.test(key) || !isValid(state.settings) || state.settings.plugin !== plugin) return key;
    return state.settings.keys[Number(key) - 1];
}

async function pluginCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const action = (parsed.positional[0] ?? "list").toLowerCase();
    const query = parsed.positional.slice(1).join(" ");

    if (action === "list" || action === "search") {
        const matches = searchPlugins(query, 25);
        if (!matches.length) return replyError(ctx, `No plugin matches "${query}".`);

        const lines = matches.map(plugin => `${isPluginEnabled(plugin.name) ? "✅" : "⛔"} ${plugin.name}`);
        await replyInfo(ctx, `**Plugins** (${matches.length})\n${lines.join("\n")}`);
        return;
    }

    if (!query) return replyError(ctx, `Usage: ${cmd(`plugin ${action} <name>`)}`);

    const plugin = await requirePlugin(ctx, query);
    if (!plugin) return;

    switch (action) {
        case "enable":
        case "disable":
        case "toggle": {
            const enabled = action === "toggle" ? !isPluginEnabled(plugin.name) : action === "enable";
            await replyDone(ctx, setPluginEnabled(plugin, enabled));
            return;
        }
        case "info":
            await showPluginDetail(ctx, plugin);
            return;
        default:
            await replyError(ctx, `Usage: ${cmd("plugin list|enable|disable|toggle|info [name]")}`);
    }
}

async function viewCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const first = parsed.positional[0]?.toLowerCase();
    const query = first === "plugin" || first === "plugins"
        ? parsed.positional.slice(1).join(" ")
        : parsed.positional.join(" ");
    const matches = searchPlugins(query, 20);

    if (!matches.length) return replyError(ctx, `No plugin matches "${query}".`);

    if (matches.length === 1) {
        const state = getState(ctx.channelId);
        state.selected = { plugin: matches[0], expires: Date.now() + STATE_TTL };
        await showPluginDetail(ctx, matches[0]);
        return;
    }

    const state = getState(ctx.channelId);
    state.candidates = { plugins: matches, expires: Date.now() + STATE_TTL };

    const lines = matches.map((plugin, index) => `${index + 1}. ${plugin.name} ${isPluginEnabled(plugin.name) ? "(enabled)" : "(disabled)"}`);
    await replyInfo(ctx, `**Plugin matches**\n${lines.join("\n")}\nUse ${cmd("select <number>")} to pick one.`);
}

async function selectCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const index = Number(parsed.positional[0]);
    const state = getState(ctx.channelId);

    if (!Number.isInteger(index) || index < 1) return replyError(ctx, `Usage: ${cmd("select <number>")}`);
    if (!isValid(state.candidates)) return replyError(ctx, `No plugin list is active. Use ${cmd("view plugin <search>")} first.`);

    const plugin = state.candidates.plugins[index - 1];
    if (!plugin) return replyError(ctx, `Pick a number between 1 and ${state.candidates.plugins.length}.`);

    state.selected = { plugin, expires: Date.now() + STATE_TTL };
    await showPluginDetail(ctx, plugin);
}

async function showPluginSettings(ctx: RemoteContext, plugin: Plugin, page = 1) {
    const entries = getSettingEntries(plugin);
    if (!entries.length) return replyInfo(ctx, `**${plugin.name}** has no configurable settings.`);

    const pageSize = 15;
    const totalPages = Math.ceil(entries.length / pageSize);
    const currentPage = Math.min(Math.max(page, 1), totalPages);
    const start = (currentPage - 1) * pageSize;
    const visible = entries.slice(start, start + pageSize);

    const state = getState(ctx.channelId);
    state.settings = { plugin, keys: entries.map(entry => entry.key), expires: Date.now() + STATE_TTL };

    const lines = visible.map((entry, offset) => {
        let line = `${start + offset + 1}. ${entry.key} = ${formatValue(entry.value)} (${settingTypeName(entry.definition)})`;
        if (entry.definition.type === OptionType.SELECT) {
            line += ` [${entry.definition.options.map(option => option.label).join("|")}]`;
        }
        return line;
    });

    const header = `**${plugin.name} settings** (${isPluginEnabled(plugin.name) ? "enabled" : "disabled"}) · page ${currentPage}/${totalPages}`;
    const footer = `Use ${cmd("set <number|name> <value>")} or ${cmd("toggle <name>")}.`;
    await replyInfo(ctx, `${header}\n${lines.join("\n")}\n${footer}`);
}

async function settingsCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const state = getState(ctx.channelId);
    const firstPlugin = parsed.positional[0] ? findPluginByQuery(parsed.positional[0]) : undefined;
    const plugin = firstPlugin ?? getSelectedPlugin(state);
    if (!plugin) return replyError(ctx, `Use ${cmd("settings <plugin>")} or pick one with ${cmd("view plugin <search>")}.`);

    const pageArg = firstPlugin ? parsed.positional[1] : parsed.positional[0];
    const page = Number(parsed.named.get("page") ?? pageArg ?? 1);
    await showPluginSettings(ctx, plugin, Number.isFinite(page) ? page : 1);
}

async function setCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const state = getState(ctx.channelId);
    const target = resolveTarget(parsed, state);
    if (!target.plugin) return replyError(ctx, `Use ${cmd("set <plugin> <setting> <value>")} or pick a plugin first.`);
    if (!target.key) return replyError(ctx, `Usage: ${cmd("set <setting> <value>")}`);

    let { key } = target;
    key = resolveSettingKey(state, target.plugin, key);
    if (!key) return replyError(ctx, "That setting number does not exist.");

    const value = parsed.named.get("value") ?? contentFrom(parsed, target.valueStart, target.valueStart);
    if (!value) return replyError(ctx, `Usage: ${cmd("set <setting> <value>")}`);

    if (key.toLowerCase() === "enabled") {
        const enabled = parseBoolean(value);
        if (enabled === null) return replyError(ctx, "Value must be true or false.");
        return replyDone(ctx, setPluginEnabled(target.plugin, enabled));
    }

    await applySetting(ctx, target.plugin, key, value);
}

async function getCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const state = getState(ctx.channelId);
    const target = resolveTarget(parsed, state);
    if (!target.plugin) return replyError(ctx, `Use ${cmd("get <plugin> <setting>")} or pick a plugin first.`);
    if (!target.key) return replyError(ctx, `Usage: ${cmd("get <setting>")}`);

    let { key } = target;
    key = resolveSettingKey(state, target.plugin, key);
    if (!key) return replyError(ctx, "That setting number does not exist.");

    const entry = findSetting(target.plugin, key);
    if (!entry) return replyError(ctx, `Unknown setting "${key}" for ${target.plugin.name}.`);

    const lines = [
        `**${target.plugin.name}.${entry.key}**`,
        "description" in entry.definition ? entry.definition.description : "No description.",
        `Type: ${settingTypeName(entry.definition)}`,
        `Current: ${formatValue(entry.value)}`,
        `Default: ${"default" in entry.definition ? formatValue(entry.definition.default) : "not set"}`
    ];

    if (entry.definition.type === OptionType.SELECT) {
        lines.push(`Options: ${entry.definition.options.map(option => `${option.label} (${String(option.value)})`).join(", ")}`);
    }

    await replyInfo(ctx, lines.join("\n"));
}

async function toggleCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const state = getState(ctx.channelId);
    const target = resolveTarget(parsed, state);
    if (!target.plugin) return replyError(ctx, `Use ${cmd("toggle <plugin> <setting>")} or pick a plugin first.`);
    if (!target.key) return replyError(ctx, `Usage: ${cmd("toggle <setting>")}`);

    const entry = findSetting(target.plugin, resolveSettingKey(state, target.plugin, target.key));
    if (!entry) return replyError(ctx, `Unknown setting "${target.key}" for ${target.plugin.name}.`);
    if (entry.definition.type !== OptionType.BOOLEAN) return replyError(ctx, `${entry.key} is not a boolean setting.`);

    await applySetting(ctx, target.plugin, entry.key, entry.value ? "false" : "true");
}

async function helpCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const prefix = settings.store.prefix || ".";
    const query = parsed.positional.join(" ").toLowerCase();
    const categories = [...new Set(Object.values(commandDefs).map(definition => definition.category))];

    if (!query) {
        const lines = categories.map(category => {
            const names = Object.entries(commandDefs)
                .filter(([, definition]) => definition.category === category)
                .map(([name]) => name);
            return `**${category}**: ${names.join(", ")}`;
        });

        await replyInfo(ctx, `**RemoteControl**\nUse ${prefix}help <category|command> for details. Any other name runs your plugin commands and Discord slash commands, like ${prefix}yuri or ${prefix}raid message:"hello".\n${lines.join("\n")}`);
        return;
    }

    const key = commandAliases[query] ?? query;
    const exact = commandDefs[key];
    if (exact) {
        const aliases = Object.entries(commandAliases).filter(([, target]) => target === key).map(([alias]) => alias);
        const lines = [
            `**${prefix}${exact.usage}**`,
            exact.description,
            `Category: ${exact.category}`
        ];
        if (aliases.length) lines.push(`Aliases: ${aliases.map(alias => `${prefix}${alias}`).join(", ")}`);
        await replyInfo(ctx, lines.join("\n"));
        return;
    }

    if (query === "all") {
        const lines = Object.entries(commandDefs)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, definition]) => `${prefix}${definition.usage} — ${definition.description}`);
        await replyInfo(ctx, lines.join("\n"));
        return;
    }

    const local = findLocalCommand(query);
    if (local) {
        const lines = [`**/${local.name}**`, local.description];

        for (const option of local.options ?? []) {
            const choices = option.choices?.length ? ` (${option.choices.map(choice => String(choice.value)).join(", ")})` : "";
            lines.push(`${prefix}${local.name}${option.required ? ` <${option.name}>` : ` [${option.name}]`}${choices} — ${option.description}`);
        }

        await replyInfo(ctx, lines.join("\n"));
        return;
    }

    const entries = Object.entries(commandDefs).filter(([, definition]) => definition.category === query);
    if (!entries.length) return replyError(ctx, `No help category or command named "${query}".`);

    const lines = entries.map(([, definition]) => `${prefix}${definition.usage} — ${definition.description}`);
    await replyInfo(ctx, `**${query}**\n${lines.join("\n")}`);
}

async function pingCommand(ctx: RemoteContext) {
    const start = performance.now();
    await RestAPI.get({ url: Constants.Endpoints.ME });
    await reply(ctx, `🏓 Pong! REST ${Math.round(performance.now() - start)}ms · up ${formatDuration(Date.now() - startedAt, true)}.`);
}

async function uptimeCommand(ctx: RemoteContext) {
    const user = UserStore.getCurrentUser();
    await replyInfo(ctx, [
        `⏱ Client up for ${formatDuration(performance.now(), true)}.`,
        `Plugin up for ${formatDuration(Date.now() - startedAt, true)}.`,
        `Signed in as ${user.username} · Testcord ${VERSION}.`
    ].join("\n"));
}

async function statusCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const requested = parsed.positional[0]?.toLowerCase();
    const statuses = ["online", "idle", "dnd", "invisible"];

    if (requested) {
        if (!statuses.includes(requested)) return replyError(ctx, `Status must be one of: ${statuses.join(", ")}.`);
        if (!PresenceSetting) return replyError(ctx, "Status control is unavailable.");
        if (PresenceSetting.getSetting() === requested) return replyDone(ctx, `Status is already ${requested}.`);

        await PresenceSetting.updateSetting(requested);
        return replyDone(ctx, `Status set to ${requested}.`);
    }

    const user = UserStore.getCurrentUser();
    const voiceChannelId = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
    const voiceChannel = voiceChannelId ? ChannelStore.getChannel(voiceChannelId) : undefined;
    const enabledPlugins = Object.values(plugins).filter(plugin => isPluginEnabled(plugin.name)).length;

    await replyInfo(ctx, [
        "**Status**",
        `Presence: ${PresenceSetting?.getSetting() ?? "unknown"}`,
        `Channel: #${ctx.channel.name ?? ctx.channel.id}`,
        `Voice: ${voiceChannel ? `#${voiceChannel.name}` : "not connected"}`,
        `Mute: ${MediaEngineStore.isSelfMute() ? "on" : "off"} · Deafen: ${MediaEngineStore.isSelfDeaf() ? "on" : "off"}`,
        `Plugins: ${enabledPlugins} enabled`,
        `Scheduled messages: ${getSchedules().length}`
    ].join("\n"));
}

async function idCommand(ctx: RemoteContext) {
    const user = UserStore.getCurrentUser();
    const guild = ctx.channel.guild_id ? GuildStore.getGuild(ctx.channel.guild_id) : undefined;
    const voiceChannelId = VoiceStateStore.getVoiceStateForUser(user.id)?.channelId;
    const voiceChannel = voiceChannelId ? ChannelStore.getChannel(voiceChannelId) : undefined;

    await replyInfo(ctx, [
        `User: ${user.username} (${user.id})`,
        `Channel: #${ctx.channel.name ?? "DM"} (${ctx.channel.id})`,
        `Guild: ${guild ? `${guild.name} (${guild.id})` : "none"}`,
        `Voice: ${voiceChannel ? `${voiceChannel.name} (${voiceChannel.id})` : "none"}`
    ].join("\n"));
}

async function bindCommand(ctx: RemoteContext) {
    if (ctx.channel.isDM() || ctx.channel.isGroupDM()) {
        return replyInfo(ctx, "This is a DM. Commands already work here.");
    }

    bindChannel(ctx.channelId);
    await replyDone(ctx, `Bound #${ctx.channel.name ?? ctx.channelId} for remote commands.`);
}

async function unbindCommand(ctx: RemoteContext) {
    const removed = unbindChannel(ctx.channelId);
    await replyDone(ctx, removed ? `Unbound #${ctx.channel.name ?? ctx.channelId}.` : "This channel was not bound.");
}

async function allowAllCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const raw = parsed.positional[0];
    if (!raw) return replyInfo(ctx, `Allow all channels: ${settings.store.allowAllChannels ? "on" : "off"}.`);

    const value = parseBoolean(raw);
    if (value === null) return replyError(ctx, "Value must be true or false.");

    settings.store.allowAllChannels = value;
    await replyDone(ctx, `Allow all channels: ${value ? "on" : "off"}.`);
}

async function notifyCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const body = contentFrom(parsed, 0, 0);
    if (!body) return replyError(ctx, `Usage: ${cmd("notify <text>")}`);

    void showNotification({ title: "RemoteControl", body }).catch(error => logger.warn("Failed to show a notification", error));
    await replyDone(ctx, "Notification sent.");
}

async function reloadCommand(ctx: RemoteContext) {
    await replyDone(ctx, "Reloading the client in one second.");
    setTimeout(() => window.location.reload(), 1000);
}

const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor as new (body: string) => () => Promise<unknown>;

async function evalCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    if (!settings.store.enableEval) return replyError(ctx, "Eval is disabled. Enable it in RemoteControl settings first.");
    if (!parsed.rawArgs) return replyError(ctx, `Usage: ${cmd("eval <code>")}`);

    let result: unknown;
    try {
        result = await new AsyncFunction(`return (${parsed.rawArgs})`)();
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        result = await new AsyncFunction(parsed.rawArgs)();
    }

    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? String(result);
    await replyInfo(ctx, makeCodeblock(text || "undefined", "js"));
}

function contentFrom(parsed: ParsedCommand, startIndex: number, rawStartWords: number) {
    const named = parsed.named.get("text");
    if (named !== undefined) return named;

    const positional = parsed.positional.slice(startIndex).join(" ");
    if (positional) return positional;

    return splitWords(parsed.rawArgs, rawStartWords).rest;
}

async function sayCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const channelId = parsed.named.get("in") ?? parsed.named.get("channel") ?? ctx.channelId;
    const channel = resolveChannel(channelId, ctx.channel.guild_id);
    if (!channel) return replyError(ctx, "Could not find that channel.");

    const content = stripOptions(parsed.named.get("text") ?? parsed.rawArgs, ["in", "channel"]);
    if (!content) return replyError(ctx, `Usage: ${cmd("say <text>")}`);
    if (content.length > 2000) return replyError(ctx, "Messages cannot be longer than 2000 characters.");

    rememberSent(channel.id, content);
    await sendMessage(channel.id, { content });
    await replyDone(ctx, `Message sent to #${channel.name ?? channel.id}.`);
}

async function sendCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const target = parsed.named.get("in") ?? parsed.named.get("channel") ?? ctx.channelId;
    const channel = resolveChannel(target, ctx.channel.guild_id);
    if (!channel) return replyError(ctx, "Could not find that channel.");

    const draft = DraftStore.getDraft(channel.id, DraftType.ChannelMessage);
    if (!draft || !draft.trim()) return replyError(ctx, `Your chat box in #${channel.name ?? channel.id} is empty.`);
    if (draft.length > 2000) return replyError(ctx, "That draft is longer than 2000 characters.");

    rememberSent(channel.id, draft);
    await sendMessage(channel.id, { content: draft });
    DraftManager.clearDraft(channel.id, DraftType.ChannelMessage);

    await replyDone(ctx, `Sent your chat box text to #${channel.name ?? channel.id}.`);
}

async function dmCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const namedUser = parsed.named.get("user");
    const userQuery = namedUser ?? parsed.positional[0];
    const content = contentFrom(parsed, namedUser ? 0 : 1, namedUser ? 0 : 1);
    if (!userQuery || !content) return replyError(ctx, `Usage: ${cmd("dm <user> <text>")}`);
    if (content.length > 2000) return replyError(ctx, "Messages cannot be longer than 2000 characters.");

    const user = resolveUser(userQuery);
    if (!user) return replyError(ctx, `Could not find user "${userQuery}".`);

    const response = await RestAPI.post({
        url: Constants.Endpoints.USER_CHANNELS,
        body: { recipient_id: user.id }
    });

    const channelId = response?.body?.id;
    if (!channelId) return replyError(ctx, "Could not open a DM with that user.");

    rememberSent(channelId, content);
    await RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body: { content, tts: false }
    });

    await replyDone(ctx, `DM sent to ${user.globalName ?? user.username}.`);
}

async function scheduleCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const namedDelay = parsed.named.get("delay");
    const delayRaw = namedDelay ?? parsed.positional[0];
    const content = stripOptions(contentFrom(parsed, namedDelay ? 0 : 1, namedDelay ? 0 : 1), ["in", "channel"]);
    if (!delayRaw || !content) return replyError(ctx, `Usage: ${cmd("schedulemsg <delay> <text>")}`);
    if (content.length > 2000) return replyError(ctx, "Messages cannot be longer than 2000 characters.");

    const delay = parseDuration(delayRaw);
    if (!delay) return replyError(ctx, "Use a delay like 30s, 10m, 2h, or 1d.");

    const channelId = parsed.named.get("in") ?? parsed.named.get("channel") ?? ctx.channelId;
    const channel = resolveChannel(channelId, ctx.channel.guild_id);
    if (!channel) return replyError(ctx, "Could not find that channel.");

    const schedule = await scheduleMessage(channel.id, content, Math.min(delay, MAX_SCHEDULE_MS));
    await replyInfo(ctx, `Scheduled ${schedule.id} in ${formatDuration(Math.min(delay, MAX_SCHEDULE_MS), true)} in #${channel.name ?? channel.id}:\n${content.slice(0, 200)}`);
}

async function remindCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const namedDelay = parsed.named.get("delay");
    const delayRaw = namedDelay ?? parsed.positional[0];
    const text = stripOptions(contentFrom(parsed, namedDelay ? 0 : 1, namedDelay ? 0 : 1), ["in", "channel"]);
    if (!delayRaw || !text) return replyError(ctx, `Usage: ${cmd("remind <delay> <text>")}`);

    const delay = parseDuration(delayRaw);
    if (!delay) return replyError(ctx, "Use a delay like 30s, 10m, 2h, or 1d.");

    const channelId = parsed.named.get("in") ?? parsed.named.get("channel") ?? ctx.channelId;
    const channel = resolveChannel(channelId, ctx.channel.guild_id);
    if (!channel) return replyError(ctx, "Could not find that channel.");

    const user = UserStore.getCurrentUser();
    const content = `<@${user.id}> Reminder: ${text}`;
    const schedule = await scheduleMessage(channel.id, content, Math.min(delay, MAX_SCHEDULE_MS));

    await replyInfo(ctx, `Reminder ${schedule.id} set for ${formatDuration(Math.min(delay, MAX_SCHEDULE_MS), true)}.`);
}

async function schedulesCommand(ctx: RemoteContext) {
    await ensureLoaded();
    const schedules = getSchedules().sort((a, b) => a.dueAt - b.dueAt);
    if (!schedules.length) return replyInfo(ctx, "No scheduled messages.");

    const lines = schedules.slice(0, 20).map(schedule =>
        `${schedule.id} — ${moment(schedule.dueAt).fromNow()} — #${ChannelStore.getChannel(schedule.channelId)?.name ?? schedule.channelId}: ${schedule.content.slice(0, 80)}`
    );

    await replyInfo(ctx, `**Scheduled messages** (${schedules.length})\n${lines.join("\n")}`);
}

async function unscheduleCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const id = parsed.positional[0];
    if (!id) return replyError(ctx, `Usage: ${cmd("unschedule <id>")}`);

    await ensureLoaded();
    const removed = await cancelSchedule(id);
    if (removed) return replyDone(ctx, `Cancelled ${id}.`);
    await replyError(ctx, `No scheduled message starts with ${id}.`);
}

async function slashCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const name = parsed.positional[0];
    if (!name) return replyError(ctx, `Usage: ${cmd("slash <command> [options]")}`);

    const slashParsed: ParsedCommand = {
        ...parsed,
        positional: parsed.positional.slice(1)
    };

    await executeSlashCommand(ctx, name, slashParsed);
    await replyDone(ctx, `Sent /${name}.`);
}

async function runCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const name = parsed.positional[0];
    if (!name) return replyError(ctx, `Usage: ${cmd("run <command> [options]")}`);

    const runParsed: ParsedCommand = {
        ...parsed,
        positional: parsed.positional.slice(1)
    };

    const local = await executeLocalCommand(ctx, name, runParsed);
    if (local) {
        await (local.content ? reply(ctx, local.content) : replyDone(ctx, `Ran /${name}.`));
        return;
    }

    await executeSlashCommand(ctx, name, runParsed);
    await replyDone(ctx, `Sent /${name}.`);
}

async function cmdsCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const prefix = settings.store.prefix || ".";
    const words = [...parsed.positional];
    const last = words[words.length - 1];
    const wantsAll = last?.toLowerCase() === "all";
    const pageArg = !wantsAll && last !== undefined && /^\d+$/.test(last) ? Number(last) : undefined;

    if (wantsAll || pageArg !== undefined) words.pop();

    const query = words.join(" ").toLowerCase();
    const local = getLocalCommands(query).map(
        command => `${prefix}${command.name} — ${(command.description ?? "").slice(0, 90)}`
    );

    let remote: string[];

    try {
        const commands = queryApplicationCommands(ctx.channel, query);
        remote = [...new Map(commands.map(command => [`${command.applicationId}:${command.untranslatedName}`, command])).values()]
            .map(command => {
                const description = (command.untranslatedDescription || command.displayDescription || "").slice(0, 90);
                const app = command.section?.name ? ` (${command.section.name})` : "";
                return `/${command.untranslatedName}${app} — ${description}`;
            });
    } catch (error) {
        logger.warn("Could not read the slash command list", error);
        remote = [];
    }

    const lines = [...local, ...remote];
    if (!lines.length) return replyError(ctx, `No commands found${query ? ` for "${query}"` : ""}.`);

    const pageSize = wantsAll ? lines.length : CMDS_PAGE_SIZE;
    const pages = Math.max(1, Math.ceil(lines.length / pageSize));
    const page = Math.min(Math.max(1, pageArg ?? 1), pages);
    const start = (page - 1) * pageSize;
    const slice = lines.slice(start, start + pageSize);

    const header = pages > 1
        ? `**Commands** ${start + 1}-${start + slice.length} of ${lines.length} · page ${page}/${pages}`
        : `**Commands** (${lines.length})`;

    const parts = [header, ...slice];
    if (page < pages) parts.push(`Next: ${prefix}cmds${query ? ` ${query}` : ""} ${page + 1}`);

    await replyInfo(ctx, parts.join("\n"));
}

async function guildsCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const query = parsed.positional.join(" ").toLowerCase();
    const guilds = Object.values(GuildStore.getGuilds())
        .filter(guild => !query || guild.name.toLowerCase().includes(query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 20);

    if (!guilds.length) return replyError(ctx, `No servers match "${query}".`);

    await replyInfo(ctx, `**Servers** (${guilds.length})\n${guilds.map(guild => `${guild.name} — ${guild.id}`).join("\n")}`);
}

async function channelsCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    let guild = ctx.channel.guild_id ? GuildStore.getGuild(ctx.channel.guild_id) : undefined;
    let words = [...parsed.positional];

    if (words[0]) {
        const requested = resolveGuild(words[0]);
        if (requested) {
            guild = requested;
            words = words.slice(1);
        }
    }

    if (!guild) return replyError(ctx, "Open a server channel or pass a server ID/name first.");

    const query = words.join(" ").toLowerCase();
    const channels = GuildChannelStore.getChannels(guild.id);
    const all = [...channels.SELECTABLE, ...channels.VOCAL].map(entry => entry.channel);
    const unique = [...new Map(all.map(channel => [channel.id, channel])).values()]
        .filter(channel => !query || channel.name?.toLowerCase().includes(query))
        .slice(0, 25);

    if (!unique.length) return replyError(ctx, `No channels match "${query}".`);

    const lines = unique.map(channel => `${channel.isVocal() ? "🔊" : "#"}${channel.name} — ${channel.id}`);
    await replyInfo(ctx, `**${guild.name} channels** (${unique.length})\n${lines.join("\n")}`);
}

function dmName(channel: Channel) {
    if (channel.isGroupDM()) {
        const names = channel.recipients.map(id => UserStore.getUser(id)?.username).filter(Boolean);
        return channel.name || names.join(", ") || "Group DM";
    }

    const user = channel.recipients[0] ? UserStore.getUser(channel.recipients[0]) : undefined;
    return user?.globalName ?? user?.username ?? "DM";
}

async function dmsCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const query = parsed.positional.join(" ").toLowerCase();
    const dms = ChannelStore.getSortedPrivateChannels()
        .filter(channel => channel.isDM() || channel.isGroupDM())
        .filter(channel => !query || dmName(channel).toLowerCase().includes(query))
        .slice(0, 20);

    if (!dms.length) return replyError(ctx, "No DMs found.");

    await replyInfo(ctx, `**DMs** (${dms.length})\n${dms.map(channel => `${dmName(channel)} — ${channel.id}`).join("\n")}`);
}

async function openCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const channel = resolveChannel(parsed.positional[0], ctx.channel.guild_id);
    if (!channel) return replyError(ctx, `Usage: ${cmd("open <channel id, mention, or name>")}`);

    ChannelRouter.transitionToChannel(channel.id);
    await replyDone(ctx, `Opened #${channel.name ?? channel.id}.`);
}

function userLabel(user: User) {
    return user.globalName ? `${user.globalName} (@${user.username})` : `@${user.username}`;
}

async function userinfoCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const user = parsed.positional[0] ? resolveUser(parsed.positional[0]) : UserStore.getCurrentUser();
    if (!user) return replyError(ctx, `Could not find user "${parsed.positional[0]}".`);

    await replyInfo(ctx, [
        `**${userLabel(user)}**`,
        `ID: ${user.id}`,
        `Bot: ${user.bot ? "yes" : "no"}`,
        `Created: ${moment(SnowflakeUtils.extractTimestamp(user.id)).format("LLL")}`
    ].join("\n"));
}

async function searchuserCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const query = parsed.positional.join(" ").toLowerCase();
    if (!query) return replyError(ctx, `Usage: ${cmd("searchuser <name>")}`);

    const users = Object.values(UserStore.getUsers())
        .filter(user => user.username.toLowerCase().includes(query) || user.globalName?.toLowerCase().includes(query))
        .slice(0, 15);

    if (!users.length) return replyError(ctx, `No users match "${query}".`);
    await replyInfo(ctx, `**Users** (${users.length})\n${users.map(user => `${userLabel(user)} — ${user.id}`).join("\n")}`);
}

async function channelinfoCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const channel = (parsed.positional[0] ? resolveChannel(parsed.positional[0], ctx.channel.guild_id) : ctx.channel) ?? ctx.channel;
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : undefined;

    await replyInfo(ctx, [
        `**#${channel.name ?? "DM"}**`,
        `ID: ${channel.id}`,
        `Type: ${channel.isDM() ? "DM" : channel.isGroupDM() ? "Group DM" : channel.isVocal() ? "voice" : "text"}`,
        `Server: ${guild ? `${guild.name} (${guild.id})` : "none"}`,
        `Topic: ${channel.topic || "none"}`
    ].join("\n"));
}

async function serverinfoCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const guild = resolveGuild(parsed.positional[0]) ?? (ctx.channel.guild_id ? GuildStore.getGuild(ctx.channel.guild_id) : undefined);
    if (!guild) return replyError(ctx, `Usage: ${cmd("serverinfo [server id or name]")}`);

    await replyInfo(ctx, [
        `**${guild.name}**`,
        `ID: ${guild.id}`,
        `Members: ${GuildMemberCountStore.getMemberCount(guild.id)}`,
        `Channels: ${GuildChannelStore.getChannels(guild.id)?.count ?? "?"}`,
        `Created: ${moment(SnowflakeUtils.extractTimestamp(guild.id)).format("LLL")}`
    ].join("\n"));
}

async function deleteCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const messageId = parsed.positional[0];
    if (!messageId) return replyError(ctx, `Usage: ${cmd("delete <message id>")}`);

    await MessageActions.deleteMessage(ctx.channelId, messageId);
    await replyDone(ctx, "Message deleted.");
}

async function editCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const messageId = parsed.positional[0];
    const content = contentFrom(parsed, 1, 1);
    if (!messageId || !content) return replyError(ctx, `Usage: ${cmd("edit <message id> <text>")}`);

    await MessageActions.editMessage(ctx.channelId, messageId, { content });
    await replyDone(ctx, "Message edited.");
}

function normalizeEmoji(input: string) {
    const custom = /^<a?:(\w+):(\d+)>$/.exec(input);
    return custom ? `${custom[1]}:${custom[2]}` : input;
}

async function reactionCommand(ctx: RemoteContext, parsed: ParsedCommand, remove: boolean) {
    const messageId = parsed.positional[0];
    const emoji = parsed.positional[1];
    if (!messageId || !emoji) return replyError(ctx, `Usage: ${cmd(`${remove ? "unreact" : "react"} <message id> <emoji>`)}`);

    const normalized = normalizeEmoji(emoji);
    const path = `${Constants.Endpoints.MESSAGE(ctx.channelId, messageId)}/reactions/${normalized.includes(":") ? normalized : encodeURIComponent(normalized)}/@me`;

    if (remove) await RestAPI.del({ url: path });
    else await RestAPI.put({ url: path });

    await replyDone(ctx, remove ? "Reaction removed." : "Reaction added.");
}

async function joinCommand(ctx: RemoteContext, parsed: ParsedCommand) {
    const channel = resolveChannel(parsed.positional[0], ctx.channel.guild_id);
    if (!channel || !channel.isVocal()) return replyError(ctx, `Usage: ${cmd("join <voice channel id, mention, or name>")}`);

    ChannelActions.selectVoiceChannel(channel.id);
    await replyDone(ctx, `Joined ${channel.name ?? channel.id}.`);
}

async function leaveCommand(ctx: RemoteContext) {
    const voiceState = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id);
    if (!voiceState?.channelId) return replyInfo(ctx, "Not connected to voice.");

    ChannelActions.selectVoiceChannel(null);
    await replyDone(ctx, "Left voice.");
}

async function setMute(ctx: RemoteContext, enabled: boolean) {
    if (MediaEngineStore.isSelfMute() !== enabled) VoiceActions.toggleSelfMute();
    await replyDone(ctx, `Microphone ${enabled ? "muted" : "unmuted"}.`);
}

async function setDeafen(ctx: RemoteContext, enabled: boolean) {
    if (MediaEngineStore.isSelfDeaf() !== enabled) VoiceActions.toggleSelfDeaf();
    await replyDone(ctx, `Deafen ${enabled ? "on" : "off"}.`);
}

function defineCommand(name: string, category: string, usage: string, description: string, handler: CommandDef["handler"]) {
    commandDefs[name] = { category, usage, description, handler };
}

defineCommand("help", "core", "help [category|command]", "Show command help.", helpCommand);
defineCommand("ping", "core", "ping", "Check REST latency and uptime.", pingCommand);
defineCommand("uptime", "core", "uptime", "Show client and plugin uptime.", uptimeCommand);
defineCommand("status", "core", "status [online|idle|dnd|invisible]", "Show status or set your presence.", statusCommand);
defineCommand("id", "core", "id", "Show user, channel, guild, and voice IDs.", idCommand);
defineCommand("bind", "core", "bind", "Allow commands in this channel.", bindCommand);
defineCommand("unbind", "core", "unbind", "Remove this channel from the allowlist.", unbindCommand);
defineCommand("allowall", "core", "allowall [on|off]", "Accept commands in every channel.", allowAllCommand);
defineCommand("notify", "utility", "notify <text>", "Send a notification on the computer.", notifyCommand);
defineCommand("reload", "utility", "reload", "Reload the Discord client.", reloadCommand);
defineCommand("eval", "utility", "eval <code>", "Run JavaScript in the client.", evalCommand);

defineCommand("plugin", "plugins", "plugin list|enable|disable|toggle|info [name]", "Manage plugins.", pluginCommand);
defineCommand("view", "plugins", "view plugin <search>", "Search plugins and pick one.", viewCommand);
defineCommand("select", "plugins", "select <number>", "Pick a plugin from the last list.", selectCommand);
defineCommand("settings", "plugins", "settings [plugin] [page]", "Show plugin settings.", settingsCommand);
defineCommand("set", "plugins", "set [plugin] <setting> <value>", "Change a plugin setting.", setCommand);
defineCommand("get", "plugins", "get [plugin] <setting>", "Show one plugin setting.", getCommand);
defineCommand("toggle", "plugins", "toggle [plugin] <setting>", "Flip a boolean plugin setting.", toggleCommand);

defineCommand("say", "messages", "say [in:<channel>] <text>", "Send a message as yourself.", sayCommand);
defineCommand("send", "messages", "send [in:<channel>]", "Send whatever is in your chat box.", sendCommand);
defineCommand("dm", "messages", "dm <user> <text>", "Send a DM to someone.", dmCommand);
defineCommand("schedulemsg", "messages", "schedulemsg <delay> <text>", "Send a message later.", scheduleCommand);
defineCommand("schedules", "messages", "schedules", "List scheduled messages.", schedulesCommand);
defineCommand("unschedule", "messages", "unschedule <id>", "Cancel a scheduled message.", unscheduleCommand);
defineCommand("remind", "messages", "remind <delay> <text>", "Set a reminder that mentions you.", remindCommand);

defineCommand("slash", "slash", "slash <command> [options]", "Run any slash command with options.", slashCommand);
defineCommand("run", "slash", "run <command> [options]", "Run a plugin command, or a slash command if none matches.", runCommand);
defineCommand("cmds", "slash", "cmds [search] [page|all]", "List plugin and slash commands.", cmdsCommand);

defineCommand("guilds", "discord", "guilds [search]", "List your servers.", guildsCommand);
defineCommand("channels", "discord", "channels [server] [search]", "List channels in a server.", channelsCommand);
defineCommand("dms", "discord", "dms [search]", "List your DMs.", dmsCommand);
defineCommand("open", "discord", "open <channel>", "Navigate the client to a channel.", openCommand);
defineCommand("userinfo", "discord", "userinfo [user]", "Show user information.", userinfoCommand);
defineCommand("searchuser", "discord", "searchuser <name>", "Search cached users by name.", searchuserCommand);
defineCommand("channelinfo", "discord", "channelinfo [channel]", "Show channel information.", channelinfoCommand);
defineCommand("serverinfo", "discord", "serverinfo [server]", "Show server information.", serverinfoCommand);
defineCommand("delete", "discord", "delete <message id>", "Delete a message.", deleteCommand);
defineCommand("edit", "discord", "edit <message id> <text>", "Edit one of your messages.", editCommand);
defineCommand("react", "discord", "react <message id> <emoji>", "Add a reaction.", (ctx, parsed) => reactionCommand(ctx, parsed, false));
defineCommand("unreact", "discord", "unreact <message id> <emoji>", "Remove a reaction.", (ctx, parsed) => reactionCommand(ctx, parsed, true));

defineCommand("join", "voice", "join <voice channel>", "Join a voice channel.", joinCommand);
defineCommand("leave", "voice", "leave", "Leave voice.", leaveCommand);
defineCommand("mute", "voice", "mute", "Mute your microphone.", ctx => setMute(ctx, true));
defineCommand("unmute", "voice", "unmute", "Unmute your microphone.", ctx => setMute(ctx, false));
defineCommand("deafen", "voice", "deafen", "Deafen yourself.", ctx => setDeafen(ctx, true));
defineCommand("undeafen", "voice", "undeafen", "Undeafen yourself.", ctx => setDeafen(ctx, false));

export async function dispatchCommand(ctx: RemoteContext) {
    const { name } = ctx.parsed;
    const definition = commandDefs[name] ?? commandDefs[commandAliases[name] ?? name];

    if (definition) return definition.handler(ctx, ctx.parsed);

    const plugin = findPluginByQuery(name);
    const subcommand = ctx.parsed.positional[0]?.toLowerCase();

    if (plugin && subcommand === "settings") {
        return showPluginSettings(ctx, plugin, 1);
    }

    if (plugin && subcommand === "set") {
        const key = ctx.parsed.positional[1];
        const value = splitWords(ctx.parsed.rawArgs, 2).rest;
        if (!key || !value) return replyError(ctx, `Usage: ${cmd(`${name} set <setting> <value>`)}`);
        return applySetting(ctx, plugin, key, value);
    }

    const local = await executeLocalCommand(ctx, name, ctx.parsed);
    if (local) {
        await (local.content ? reply(ctx, local.content) : replyDone(ctx, `Ran /${name}.`));
        return;
    }

    await executeSlashCommand(ctx, name, ctx.parsed);
    await replyDone(ctx, `Sent /${name}.`);
}
