/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sleep } from "@utils/misc";
import type { ApplicationCommand, ApplicationCommandOption, Channel } from "@vencord/discord-types";
import { ApplicationCommandOptionType } from "@vencord/discord-types/enums";
import { ApplicationCommandIndexStore, AuthenticationStore, ChannelStore, FluxDispatcher, GuildRoleStore, RestAPI, SnowflakeUtils } from "@webpack/common";

import { parseBoolean, type ParsedCommand, type RemoteContext, resolveChannel, resolveUser } from "./utils";

interface BuiltOption {
    type: ApplicationCommandOptionType;
    name: string;
    value?: string | number | boolean;
    options?: BuiltOption[];
}

const COMMAND_TYPES = [1];

export function queryApplicationCommands(channel: Channel, text: string) {
    const result = ApplicationCommandIndexStore.query(
        { type: "channel", channel },
        {
            commandTypes: COMMAND_TYPES,
            text,
            builtIns: "deny",
            applicationCommands: true
        },
        {
            allowFetch: true,
            allowApplicationState: true
        }
    );

    return (result?.commands ?? []).filter(command => command.applicationId !== "-1");
}

function requestCommandIndexRefresh(channel: Channel) {
    FluxDispatcher.dispatch({
        type: "APPLICATION_COMMAND_INDEX_FETCH_REQUEST",
        target: { type: "channel", channelId: channel.id }
    });

    if (channel.guild_id) {
        FluxDispatcher.dispatch({
            type: "APPLICATION_COMMAND_INDEX_FETCH_REQUEST",
            target: { type: "guild", guildId: channel.guild_id }
        });
    }
}

function commandName(command: ApplicationCommand) {
    return (command.untranslatedName ?? command.displayName ?? "").toLowerCase();
}

function applicationName(command: ApplicationCommand) {
    return command.section?.name ?? command.applicationId;
}

function findCommand(commands: ApplicationCommand[], name: string, appFilter?: string) {
    const lowerName = name.toLowerCase();
    const matches = commands.filter(command => {
        const names = [command.untranslatedName, command.displayName].filter(Boolean).map(value => value.toLowerCase());
        return names.includes(lowerName);
    });

    const filtered = appFilter
        ? matches.filter(command => command.applicationId === appFilter || applicationName(command).toLowerCase().includes(appFilter.toLowerCase()))
        : matches;

    if (!filtered.length) return undefined;

    const unique = [...new Map(filtered.map(command => [command.applicationId, command])).values()];
    if (unique.length > 1) {
        throw new Error(
            `Multiple bots have /${name}: ${unique.map(command => `${applicationName(command)} (${command.applicationId})`).join(", ")}. Add app:<name or id> to pick one.`
        );
    }

    return unique[0];
}

function buildOptions(command: ApplicationCommand, parsed: ParsedCommand, guildId?: string) {
    const positional = [...parsed.positional];
    const named = new Map(parsed.named);
    const usedNamed = new Set<string>();
    named.delete("app");

    let options: BuiltOption[];

    if (command.subCommandPath?.length) {
        for (const entry of command.subCommandPath) {
            const index = positional.findIndex(value => value.toLowerCase() === entry.name.toLowerCase());
            if (index !== -1) positional.splice(index, 1);
        }

        options = buildOptionList(command.options ?? [], positional, named, usedNamed, guildId);
        for (let i = command.subCommandPath.length - 1; i >= 0; i--) {
            const entry = command.subCommandPath[i];
            options = [{ type: entry.type, name: entry.name, options }];
        }
    } else {
        options = buildOptionList(command.options ?? [], positional, named, usedNamed, guildId);
    }

    const unknown = [...named.keys()].filter(key => !usedNamed.has(key));
    if (unknown.length) throw new Error(`Unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
    if (positional.length) throw new Error(`Too many arguments: ${positional.join(" ")}`);

    return options;
}

function buildOptionList(
    definitions: ApplicationCommandOption[],
    positional: string[],
    named: Map<string, string>,
    usedNamed: Set<string>,
    guildId?: string
): BuiltOption[] {
    const subcommands = definitions.filter(
        definition => definition.type === ApplicationCommandOptionType.SUB_COMMAND || definition.type === ApplicationCommandOptionType.SUB_COMMAND_GROUP
    );

    if (subcommands.length) {
        const selected = positional[0]?.toLowerCase();
        const subcommand = subcommands.find(definition => definition.name.toLowerCase() === selected);

        if (!subcommand) {
            throw new Error(`Choose a subcommand: ${subcommands.map(definition => definition.name).join(", ")}`);
        }

        positional.shift();

        return [{
            type: subcommand.type,
            name: subcommand.name,
            options: buildOptionList(subcommand.options ?? [], positional, named, usedNamed, guildId)
        }];
    }

    const options: BuiltOption[] = [];

    for (const definition of definitions) {
        const key = definition.name.toLowerCase();
        let raw = named.get(key);

        if (raw !== undefined) usedNamed.add(key);
        else if (positional.length) raw = positional.shift();

        if (raw === undefined) {
            if (definition.required) throw new Error(`Missing required option: ${definition.name}`);
            continue;
        }

        options.push({
            type: definition.type,
            name: definition.name,
            value: convertValue(definition, raw, guildId)
        });
    }

    return options;
}

function convertValue(definition: ApplicationCommandOption, raw: string, guildId?: string): string | number | boolean {
    if (definition.choices?.length) {
        const choice = definition.choices.find(
            option => option.name.toLowerCase() === raw.toLowerCase() || String(option.value).toLowerCase() === raw.toLowerCase()
        );

        if (!choice) {
            throw new Error(`${definition.name} must be one of: ${definition.choices.map(option => option.name).join(", ")}`);
        }

        return choice.value;
    }

    switch (definition.type) {
        case ApplicationCommandOptionType.STRING: {
            if (definition.min_length !== undefined && raw.length < definition.min_length) {
                throw new Error(`${definition.name} must be at least ${definition.min_length} characters.`);
            }
            if (definition.max_length !== undefined && raw.length > definition.max_length) {
                throw new Error(`${definition.name} must be at most ${definition.max_length} characters.`);
            }
            return raw;
        }
        case ApplicationCommandOptionType.INTEGER: {
            const value = Number.parseInt(raw, 10);
            if (!Number.isFinite(value)) throw new Error(`${definition.name} must be a whole number.`);
            if (definition.min_value !== undefined && value < definition.min_value) throw new Error(`${definition.name} must be at least ${definition.min_value}.`);
            if (definition.max_value !== undefined && value > definition.max_value) throw new Error(`${definition.name} must be at most ${definition.max_value}.`);
            return value;
        }
        case ApplicationCommandOptionType.NUMBER: {
            const value = Number(raw);
            if (!Number.isFinite(value)) throw new Error(`${definition.name} must be a number.`);
            if (definition.min_value !== undefined && value < definition.min_value) throw new Error(`${definition.name} must be at least ${definition.min_value}.`);
            if (definition.max_value !== undefined && value > definition.max_value) throw new Error(`${definition.name} must be at most ${definition.max_value}.`);
            return value;
        }
        case ApplicationCommandOptionType.BOOLEAN: {
            const value = parseBoolean(raw);
            if (value === null) throw new Error(`${definition.name} must be true or false.`);
            return value;
        }
        case ApplicationCommandOptionType.USER: {
            const id = resolveUserId(raw);
            if (!id) throw new Error(`${definition.name} must be a user ID, mention, or known username.`);
            return id;
        }
        case ApplicationCommandOptionType.CHANNEL: {
            const id = resolveChannelId(raw, guildId);
            if (!id) throw new Error(`${definition.name} must be a channel ID or mention.`);
            return id;
        }
        case ApplicationCommandOptionType.ROLE: {
            const id = resolveRoleId(raw, guildId);
            if (!id) throw new Error(`${definition.name} must be a role ID or mention.`);
            return id;
        }
        case ApplicationCommandOptionType.MENTIONABLE: {
            const id = resolveUserId(raw) ?? resolveRoleId(raw, guildId) ?? resolveChannelId(raw, guildId);
            if (!id) throw new Error(`${definition.name} must be a user, role, or channel.`);
            return id;
        }
        case ApplicationCommandOptionType.ATTACHMENT:
            throw new Error(`${definition.name} is an attachment and cannot be set from a text command.`);
        default:
            throw new Error(`Unsupported option type for ${definition.name}.`);
    }
}

export function resolveUserId(input: string) {
    const mention = /^<@!?(\d+)>$/.exec(input)?.[1];
    if (mention) return mention;

    const user = resolveUser(input);
    if (user) return user.id;

    return /^\d{17,20}$/.test(input) ? input : undefined;
}

export function resolveChannelId(input: string, guildId: string | undefined) {
    const mention = /^<#(\d+)>$/.exec(input)?.[1];
    if (mention) return mention;

    const channel = resolveChannel(input, guildId);
    if (channel) return channel.id;

    return /^\d{17,20}$/.test(input) ? input : undefined;
}

export function resolveRoleId(input: string, guildId: string | undefined) {
    const mention = /^<@&(\d+)>$/.exec(input)?.[1];
    if (mention) return mention;
    if (/^\d{17,20}$/.test(input)) return input;
    if (!guildId) return undefined;

    const query = input.replace(/^@/, "").toLowerCase();
    const roles = Object.values(GuildRoleStore.getRolesSnapshot(guildId));

    return roles.find(role => role.name.toLowerCase() === query)?.id
        ?? roles.find(role => role.name.toLowerCase().includes(query))?.id;
}

function buildInteraction(command: ApplicationCommand, options: BuiltOption[], channel: Channel, channelId: string) {
    const root = command.rootCommand;
    const commandId = root?.id ?? command.id;
    const version = root?.version ?? command.version;
    if (!commandId || !version) throw new Error("This command is missing its id or version.");

    const sessionId = AuthenticationStore.getSessionId?.();
    if (!sessionId) throw new Error("Could not read the Discord session id.");

    const name = root?.name ?? command.untranslatedName;

    return {
        type: 2,
        application_id: command.applicationId,
        guild_id: channel.guild_id ?? null,
        channel_id: channelId,
        session_id: sessionId,
        nonce: SnowflakeUtils.fromTimestamp(Date.now()),
        data: {
            version,
            id: commandId,
            name,
            type: 1,
            options,
            application_command: {
                id: commandId,
                type: 1,
                application_id: command.applicationId,
                version,
                name,
                description: root?.description ?? command.untranslatedDescription ?? ""
            }
        }
    };
}

export async function executeSlashCommand(ctx: Pick<RemoteContext, "channelId">, name: string, parsed: ParsedCommand) {
    const channel = ChannelStore.getChannel(ctx.channelId);
    if (!channel) throw new Error("Could not find the current channel.");

    let commands = queryApplicationCommands(channel, name);
    const appFilter = parsed.named.get("app");
    let command = findCommand(commands, name, appFilter);

    for (let attempt = 0; attempt < 3 && !command; attempt++) {
        requestCommandIndexRefresh(channel);
        await sleep(750);
        commands = queryApplicationCommands(channel, name);
        command = findCommand(commands, name, appFilter);
    }

    if (!command) throw new Error(`No slash command named /${name} was found in this channel.`);

    const options = buildOptions(command, parsed, channel.guild_id);
    const payload = buildInteraction(command, options, channel, ctx.channelId);

    await RestAPI.post({
        url: "/interactions",
        body: payload
    });
}
