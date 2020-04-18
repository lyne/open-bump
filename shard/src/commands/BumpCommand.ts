import { ParsedMessage } from "discord-command-parser";
import ms from "ms";
import { Op } from "sequelize";
import Command from "../Command";
import BumpData from "../models/BumpData";
import Guild from "../models/Guild";
import Utils, { EmbedError } from "../Utils";
import { Sequelize } from "sequelize-typescript";

export default class BumpCommand extends Command {
  public name = "bump";
  public syntax = "bump";
  public description = "Bump your server";

  public async run({ message }: ParsedMessage, guildDatabase: Guild) {
    const { channel, guild, author } = message;

    if (
      !guildDatabase.getFeatures().includes("AUTOBUMP") ||
      !guildDatabase.autobump
    ) {
      const cooldown = guildDatabase.getCooldown(true);
      const nextBump = guildDatabase.lastBumpedAt?.valueOf() + cooldown;
      const remaining = nextBump - Date.now();
      if (nextBump && nextBump > Date.now()) {
        // TODO: Suggestions
        const embed = {
          color: Utils.Colors.RED,
          title: `${Utils.Emojis.XMARK} You are on cooldown!`,
          description:
            `**Total Cooldown:** ${ms(cooldown, { long: true })}\n` +
            `**Next Bump:** In ${ms(remaining, { long: true })}`
        };
        return void (await channel.send({ embed }));
      }

      guildDatabase.lastBumpedAt = new Date();
      guildDatabase.lastBumpedBy = author.id;
      guildDatabase.totalBumps++;
      await guildDatabase.save();

      const loadingEmbed = {
        color: Utils.Colors.BLUE,
        title: `${Utils.Emojis.LOADING} Your server is being bumped...`
      };
      const loadingMessage = await channel.send({ embed: loadingEmbed });

      // TODO: Use correct bump utils function to regulate receivers
      let bumpEmbed;

      try {
        bumpEmbed = await Utils.Bump.getEmbed(guild, guildDatabase);
      } catch (error) {
        if (error instanceof EmbedError) {
          return void (await loadingMessage.edit({ embed: error.toEmbed() }));
        } else throw error;
      }

      let { amount, featured } = await Utils.Bump.bump(
        guildDatabase,
        bumpEmbed
      );

      const featuredGuildDatabases = featured.length
        ? await Guild.findAll({
            where: {
              id: {
                [Op.in]: featured.map(({ id }) => id)
              }
            },
            include: [
              {
                model: BumpData,
                where: {
                  invite: {
                    [Op.and]: [
                      {
                        [Op.ne]: null
                      },
                      {
                        [Op.ne]: ""
                      }
                    ]
                  }
                }
              }
            ],
            order: [["hub", "DESC"], Sequelize.literal("rand()")],
            limit: 3
          })
        : [];

      let description =
        `Your server has been bumped to ${amount} servers.\n` +
        `You can bump again in ${ms(guildDatabase.getCooldown(true), {
          long: true
        })}.`;

      if (featuredGuildDatabases.length) {
        description +=
          `\n\n` +
          `**Featured servers your server was bumped to:**\n` +
          Utils.niceList(
            featuredGuildDatabases.map(
              (guild) =>
                `**[${guild.name}](https://discord.gg/${guild.bumpData.invite})**`
            )
          );
      }

      // TODO: Remove server count
      const successEmbed = {
        color: Utils.Colors.GREEN,
        title: `${Utils.Emojis.CHECK} Success`,
        description
      };
      await loadingMessage.edit({ embed: successEmbed });
    } else {
      const embed = {
        color: Utils.Colors.ORANGE,
        title: `${Utils.Emojis.IMPORTANTNOTICE} Autobump Enabled`,
        description:
          `You can't manually bump your server because you have autobump enabled.\n` +
          `As long as you have autobump enabled, the bot automatically bumps your server every ${ms(
            guildDatabase.getCooldown(true),
            { long: true }
          )}.` +
          (guildDatabase.lastBumpedAt && guildDatabase.lastBumpedBy
            ? `\n\n` +
              `**Last bumped at:** ${ms(
                Date.now() - guildDatabase.lastBumpedAt.valueOf(),
                { long: true }
              )} ago\n` +
              `**Last bumped by:** <@${guildDatabase.lastBumpedBy}>`
            : "")
      };
      return void (await channel.send({ embed }));
    }
  }
}
