/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { commands as localCommands, type VencordCommand } from "@api/Commands";
import type { Channel, CommandArgument, CommandContext, CommandOption } from "@vencord/discord-types";
import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@vencord/discord-types/enums";
import { ChannelStore, GuildStore } from "@webpack/common";

import { resolveChannelId, resolveRoleId, resolveUserId } from "./slash";
import { parseBoolean, type ParsedCommand, type RemoteContext } from "./utils";

interface LocalArgument {
    type: ApplicationCommandOptionType;
    name: string;
    value: string | number | boolean;
    focused: undefined;
    options: LocalArgument[];
}

interface ParseState {
    positional: string[];
    named: Map<string, string>;
    used: Set<string>;
    guildId?: string;
}

export interface LocalCommandResult {
    content?: string;
}

export function findLocalCommand(name: string) {
    const exact = localCommands[name];
    if (exact) return exact;

    const lower = name.toLowerCase();
    return Object.values(localCommands).find(command => command.name.toLowerCase() === lower);
}

export function getLocalCommands(query = "") {
    const normalized = query.trim().toLowerCase();

    return Object.values(localCommands).filter(command => {
        if (command.name.includes(" ")) return false;
        if (!normalized) return true;

        return command.name.toLowerCase().includes(normalized)
            || (command.description ?? "").toLowerCase().includes(normalized);
    });
}

export async function executeLocalCommand(ctx: Pick<RemoteContext, "channelId">, name: string, parsed: ParsedCommand): Promise<LocalCommandResult | null> {
    const qualifier = parsed.positional[0];
    const command = findLocalCommand(name) ?? (qualifier ? findLocalCommand(`${name} ${qualifier}`) : undefined);
    if (!command) return null;

    const commandParsed = command.name.includes(" ")
        ? { ...parsed, positional: parsed.positional.slice(1) }
        : parsed;

    const channel = ChannelStore.getChannel(ctx.channelId);
    if (!channel) throw new Error("Could not find the current channel.");

    const commandCtx = buildContext(channel);

    if (command.predicate && !command.predicate(commandCtx)) {
        throw new Error(`/${command.name} is not available here.`);
    }

    const args = isTextCommand(command) && (command.options?.length ?? 0) <= 1
        ? [textArgument(command, commandParsed.rawArgs)]
        : argumentsFromParsed(command, commandParsed, channel.guild_id);

    const result = await command.execute(args as CommandArgument[], commandCtx);
    const content = result && typeof result === "object" && "content" in result && typeof result.content === "string"
        ? result.content
        : undefined;

    return { content };
}

function isTextCommand(command: VencordCommand) {
    return command.inputType === ApplicationCommandInputType.BUILT_IN_TEXT;
}

function textArgument(command: VencordCommand, rawArgs: string): LocalArgument {
    const option = command.options?.[0];

    return {
        type: option?.type ?? ApplicationCommandOptionType.STRING,
        name: option?.name ?? "message",
        value: rawArgs,
        focused: undefined,
        options: []
    };
}

function argumentsFromParsed(command: VencordCommand, parsed: ParsedCommand, guildId?: string) {
    const state: ParseState = {
        positional: [...parsed.positional],
        named: new Map(parsed.named),
        used: new Set(),
        guildId
    };

    const args = buildArguments(command.options ?? [], state);
    const unknown = [...state.named.keys()].filter(key => !state.used.has(key));
    const names = (command.options ?? []).map(definition => definition.name);

    if (unknown.length) {
        throw new Error(`Unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}${names.length ? `. Available: ${names.join(", ")}` : ""}`);
    }

    if (state.positional.length) throw new Error(`Too many arguments: ${state.positional.join(" ")}`);

    return args;
}

function buildArguments(definitions: CommandOption[], state: ParseState): LocalArgument[] {
    const subcommands = definitions.filter(
        definition => definition.type === ApplicationCommandOptionType.SUB_COMMAND
            || definition.type === ApplicationCommandOptionType.SUB_COMMAND_GROUP
    );

    if (subcommands.length) {
        const selected = state.positional.shift()?.toLowerCase();
        const subcommand = subcommands.find(definition => definition.name.toLowerCase() === selected);

        if (!subcommand) throw new Error(`Choose a subcommand: ${subcommands.map(definition => definition.name).join(", ")}`);

        return [{
            type: subcommand.type,
            name: subcommand.name,
            value: subcommand.name,
            focused: undefined,
            options: buildArguments(subcommand.options ?? [], state)
        }];
    }

    const args: LocalArgument[] = [];

    for (const definition of definitions) {
        const key = definition.name.toLowerCase();
        let raw = state.named.get(key);

        if (raw !== undefined) state.used.add(key);
        else if (state.positional.length) raw = state.positional.shift();

        if (raw === undefined) {
            if (definition.required) throw new Error(`Missing required option: ${definition.name}`);
            continue;
        }

        args.push({
            type: definition.type,
            name: definition.name,
            value: convertValue(definition, raw, state.guildId),
            focused: undefined,
            options: []
        });
    }

    return args;
}

function convertValue(definition: CommandOption, raw: string, guildId?: string): string | number | boolean {
    switch (definition.type) {
        case ApplicationCommandOptionType.INTEGER: {
            const value = Number.parseInt(raw, 10);
            return Number.isFinite(value) ? value : raw;
        }
        case ApplicationCommandOptionType.NUMBER: {
            const value = Number(raw);
            return Number.isFinite(value) ? value : raw;
        }
        case ApplicationCommandOptionType.BOOLEAN:
            return parseBoolean(raw) ?? raw;
        case ApplicationCommandOptionType.USER:
            return resolveUserId(raw) ?? raw;
        case ApplicationCommandOptionType.CHANNEL:
            return resolveChannelId(raw, guildId) ?? raw;
        case ApplicationCommandOptionType.ROLE:
            return resolveRoleId(raw, guildId) ?? raw;
        case ApplicationCommandOptionType.MENTIONABLE:
            return resolveUserId(raw) ?? resolveRoleId(raw, guildId) ?? resolveChannelId(raw, guildId) ?? raw;
        default:
            return raw;
    }
}

function buildContext(channel: Channel) {
    const context: CommandContext & { channelId: string; guildId?: string; } = {
        channel,
        guild: channel.guild_id ? GuildStore.getGuild(channel.guild_id) : undefined,
        channelId: channel.id,
        guildId: channel.guild_id
    };

    return context;
}
