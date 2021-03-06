import {CoCoModule} from "../interfaces";
import * as DiscordJS from "discord.js"; 
import {
  Collection,
  Guild,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  Role,
  TextChannel,
  User
} from "discord.js";

const regex = /^.*<@(?:&(\d+)|([^\n:<>@&]+))>.*?((?:<a?)?:[^\n: ]+:(?:\d+>)?|(?:\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]))/;
const reaction_regex = new RegExp(regex, "gm")
const reaction_regex_single_line = regex;
const channel_regex = /^<#(\d+)>/;
const role_regex = /(^.*)(<@(?:&(\d+)|([^\n:<>@&]+))>)/gm;

async function messageReaction(client: DiscordJS.Client, add: boolean, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
  if (user.bot) return;
  let channel = await client.channels.fetch(reaction.message.channelId).catch(() => undefined) as TextChannel | undefined;
  let message = await channel?.messages.fetch(reaction.message.id).catch(() => undefined);
  if (message?.author.id !== client.user?.id || message?.content || message?.embeds.length !== 1) return;
  // Parse
  let body = message?.embeds[0].description;
  if (!body) return;
  let roles = parseMessageBody(body);
  if (!roles || roles.length < 1) return;
  // Parsed
  let roleDefinition = roles.find(r => r.emoji === reaction.emoji.toString());
  if (!roleDefinition) return;
  let member = await message?.guild?.members.fetch(user.id).catch(() => undefined);
  if (!member) return;
  if (add) member.roles.add(roleDefinition.role).catch(() => undefined);
  else member.roles.remove(roleDefinition.role).catch(() => undefined);
}

const reactionRoleModule: CoCoModule = {
  name: 'reaction-role',
  permission: 'Wizard',
  description: 'Creates a reaction embed in the specified channel.',
  async command(message, _args, _client) {
    // Wizard Permission level, this should be done in createMessage handler by checking the permissions field.
    let wizRole = message.member?.roles.cache.filter(role => role.name === 'Wizard');
    if (wizRole && wizRole.size === 0)
      return message.channel.send('You are not the bot wizard.');

    // Guild Command Only
    if (!message.guild) return message.reply('This command is only available in a guild.');
    let body = message.content;
    // Trim off the command prefix
    body = body.substr(body.indexOf(' ')).trim();
    // Trim off the channel
    let channel = body.match(channel_regex);
    if (!channel || !channel[1]) return usage(message);
    body = body.replace(channel_regex, '').trim();
    let channelId = channel[1];
    // Validate that this channel is from the origin guild
    let channelReference = await message.guild.channels.fetch(channelId).catch(_ => undefined) as TextChannel | undefined;
    if (!channelReference) return message.reply('I couldn\'t find that channel.');
    // Parse body for reaction roles
    let reactionDefinitions: (ReactionRole | undefined)[] | undefined = parseMessageBody(body);
    if (!reactionDefinitions) return usage(message);
    // Resolve roles
    let abort = false;
    reactionDefinitions =
      await Promise.all(
        reactionDefinitions.map(
          def => def && resolveRoleFor(def, message.guild)
        )
      )
        .catch(_ => {
          abort = true;
          return undefined;
        });
    if (abort) {
      return message.reply("I need permission to manage roles in order to create new roles.");
    }
    // Update message
    body = body.replace(role_regex, function (m, g1, g2, id, name) {
      if (id) return m;
      let def = reactionDefinitions?.find(d => d && d.name === name);
      if (def) return g1 + `<@&${def.role}>`;
      return m;
    });
    // Create the message
    let reactionMessage = await channelReference.send({
      embeds: [{
        description: body,
        color: 0x2F4562
      }]
    });
    // React to said message
    reactionDefinitions?.forEach(def => {
      if (def) reactionMessage.react(def.emoji).catch(() => {
        message.reply("Unable to react with: " + def.emoji + ", you may have to do this manually.");
      });
    });
  },
  service(client) {
    client.on("messageReactionAdd", messageReaction.bind(null, client, true));
    client.on("messageReactionRemove", messageReaction.bind(null, client, false));
  }
}

interface ReactionRole {
  role: string,
  name: string,
  emoji: string
}

function parseMessageBody(body: string): ReactionRole[] | undefined {
  // Good to go, parse the roles in the message
  let reactionRoles = body.match(reaction_regex);
  if (!reactionRoles || !reactionRoles.length) return undefined;
  // We have multiple, extrapolate.
  return reactionRoles.map(r => {
    // This match was pre-ensured by the reaction_regex
    let match = r.match(reaction_regex_single_line) || [];
    return {role: match[1] || "", name: match[2] || "", emoji: match[3] || ""};
  });
}

async function resolveRoleFor(definition: ReactionRole, guild?: Guild | null) {
  // Role id is already resolved
  if (definition.role) return definition;
  // Load roles
  let roles: Collection<string, Role> | undefined = await guild?.roles.fetch().catch(_ => undefined);
  // Attempt to find by name
  let role = roles?.find(r => r.name === definition.name);
  // Resolve role if found
  if (role) {
    definition.role = role.id;
    return definition;
  }
  // Create role if missing
  return guild?.roles.create({name: definition.name}).then(role => {
    // Resolve role and return
    definition.role = role.id;
    return definition;
  });
}

// Messy usage message
async function usage(message: Message) {
  await message.reply(`Usage: reaction-role #channel-mention
Now you can type whatever you want here
Any line that has a role @Mention and an :emoji:
will become a reaction assignable role.
if you have multiple roles you want to be assignable
make sure each @Role and :emoji: are on separate lines.
you can also have the bot create roles that do not yet exist for you
by using <@My New Cool Role Name> or course with an :emoji: on the same line
And here is the exact regex used if you're curious.
^.*<@(?:&(\\d+)|([^\\n:<>@&]+))>.*?((?:<a?)?:[^\\n: ]+:(?:\\d+>)?|(?:\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]))
Final thing, at least one reaction role is required.`)
}

export default reactionRoleModule