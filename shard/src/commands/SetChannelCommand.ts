import { SuccessfulParsedMessage } from "discord-command-parser";
import Command from "../Command";
import Guild from "../models/Guild";
import Utils, { GuildMessage } from "../Utils";

export default class SetChannelCommand extends Command {
  public name = "setchannel";
  public aliases = ["set-channel", "channel"];
  public syntax = "setchannel [channel|reset]";
  public description = "Set the bump feed channel for your server";

  public async run(
    { message, arguments: args }: SuccessfulParsedMessage<GuildMessage>,
    guildDatabase: Guild
  ) {
    const { channel, guild, member } = message;

    this.requireUserPemission(["MANAGE_GUILD"], member);

    if (args.length === 1) {
      if (!(args[0] === "reset" || args[0] === "default")) {
        const newChannel = Utils.findChannel(args[0], guild);

        const issues = Utils.Bump.getBumpChannelIssues(
          newChannel,
          guildDatabase
        );
        if (issues.length) {
          const embed = {
            color: Utils.Colors.RED,
            title: `${Utils.Emojis.XMARK} Can't use that channel`,
            description:
              `**Please fix these issues before using ${newChannel}:**\n` +
              issues.map((issue) => `- ${issue}`).join("\n")
          };
          return void (await channel.send({ embed }));
        }

        guildDatabase.feed = newChannel.id;
        await guildDatabase.save();

        const embed = {
          color: Utils.Colors.GREEN,
          title: `${Utils.Emojis.CHECK} Channel has been updated`,
          description: `__**New Channel:**__ ${newChannel}`
        };
        return void (await channel.send({ embed }));
      } else {
        guildDatabase.feed = null;
        await guildDatabase.save();

        const embed = {
          color: Utils.Colors.GREEN,
          title: `${Utils.Emojis.CHECK} Channel has been updated`,
          description: `__**New Channel:**__ *No Channel*`
        };
        return void (await channel.send({ embed }));
      }
    } else {
      const embed = {
        color: Utils.Colors.BLUE,
        title: `${Utils.Emojis.INFORMATION} Set a bump channel`,
        description:
          `__**Current Channel:**__ ${
            guildDatabase.feed ? `<#${guildDatabase.feed}>` : "*No Channel*"
          }\n` +
          `\n` +
          `By setting a bump channel, you agree to receive the other server's bumps on your server. In return, you'll get a cooldown reduction of 15 minutes.\n` +
          `\n` +
          `**Syntax:** ${Utils.getPrefix(guildDatabase)}${this.syntax}`
      };
      return void (await channel.send({ embed }));
    }
  }
}
