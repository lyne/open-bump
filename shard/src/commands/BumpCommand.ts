import { SuccessfulParsedMessage } from "discord-command-parser";
import Discord, { ClientUser } from "discord.js";
import moment from "moment";
import ms from "ms";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import Command from "../Command";
import config from "../config";
import Application from "../models/Application";
import BumpData from "../models/BumpData";
import Guild from "../models/Guild";
import User from "../models/User";
import OpenBump from "../OpenBump";
import { SBLPBumpEntity } from "../SBLP";
import Utils, { EmbedError, GuildMessage } from "../Utils";

export default class BumpCommand extends Command {
  public name = "bump";
  public syntax = "bump";
  public description = "Bump your server";
  public interactive = "Bump captcha has been cancelled!";

  public async run(
    { message }: SuccessfulParsedMessage<GuildMessage>,
    guildDatabase: Guild,
    userDatabase: User,
    id: string,
    unhookInteraction: () => void
  ) {
    const { channel, guild, author } = message;

    if (
      !guildDatabase.getFeatures().includes("AUTOBUMP") ||
      !guildDatabase.autobump
    ) {
      if (
        moment(userDatabase.lastBumpedAt || 0).isBefore(
          moment().subtract(2, "d")
        )
      )
        userDatabase.bumpsSinceCaptcha = 0;
      userDatabase.lastBumpedAt = new Date();
      if (
        userDatabase.bumpsSinceCaptcha >= 5 ||
        userDatabase.requireCaptcha ||
        guildDatabase.sblpRequireCaptcha
      ) {
        // Captcha required
        userDatabase.requireCaptcha = true;
        if (userDatabase.changed()) await userDatabase.save();
        console.log(
          `[DEBUG] Require captcha for user ${userDatabase.id} on guild ${guildDatabase.id}`
        );
        await Utils.UBPS.captcha(channel, author, id);
        userDatabase.bumpsSinceCaptcha = 1;
        userDatabase.requireCaptcha = false;
        guildDatabase.sblpRequireCaptcha = false;
        if (userDatabase.changed()) await userDatabase.save();
      } else {
        // No captcha required
        userDatabase.bumpsSinceCaptcha++;
        if (userDatabase.changed()) await userDatabase.save();
      }
      unhookInteraction();

      const votingEnabled = config.lists.topgg.enabled;
      const voted = await Utils.Lists.hasVotedTopGG(author.id);
      const voteCooldown = guildDatabase.getCooldown(true, true);
      const cooldown = guildDatabase.getCooldown(true, voted);
      const maxedOut =
        guildDatabase.getCooldown(false, voted) <= config.settings.cooldown.min;
      const nextBump = guildDatabase.lastBumpedAt
        ? guildDatabase.lastBumpedAt.valueOf() + cooldown
        : 0;
      const remaining = nextBump - Date.now();
      if (nextBump && nextBump > Date.now()) {
        const suggestions: Array<Partial<Discord.EmbedFieldData>> = [];

        let integrationSuggestion;

        if (!guildDatabase.feed && !maxedOut && Utils.randomInt(2) === 0)
          suggestions.push({
            name: `${Utils.Emojis.BELL} Suggestion: Bump Channel`,
            value:
              `You don't want to wait ${ms(cooldown, {
                long: true
              })} until you can bump? Set your guild a bump channel!\n` +
              `To set a bump channel, please use the command \`${Utils.getPrefix(
                guildDatabase
              )}setchannel <channel>\`.`
          });
        else if (
          votingEnabled &&
          !voted &&
          !maxedOut &&
          cooldown > voteCooldown &&
          (Utils.Lists.isWeekendTopGG() || Utils.randomInt(3) === 0)
        )
          suggestions.push({
            name: `${Utils.Emojis.BELL} Suggestion: Vote`,
            value:
              `You don't want to wait ${ms(cooldown, {
                long: true
              })} until you can bump? **[Vote for ${
                this.instance.client.user?.username
              }!](${Utils.Lists.getLinkTopGG()})**\n` +
              `It will decrease your cooldown by ${ms(cooldown - voteCooldown, {
                long: true
              })} for the next 12 hours.`
          });
        else if (!guildDatabase.isPremium() && Utils.randomInt(3) === 0)
          suggestions.push({
            name: `${Utils.Emojis.BELL} Suggestion: Premium`,
            value:
              `You don't want to wait ${ms(cooldown, {
                long: true
              })} until you can bump? Upgrade to premium!\n` +
              `To view more information about premium, use the command \`${Utils.getPrefix(
                guildDatabase
              )}premium\`.`
          });
        else if (
          Utils.randomInt(2) === 0 &&
          (integrationSuggestion = await this.instance.integration.getBotSuggestion(
            guild
          ))
        ) {
          const integrationSuggestionField = {
            name: `${Utils.Emojis.BELL} Bot Suggestion: ${integrationSuggestion.name}`,

            value: `Bump bots are most effective when used together. **[Start using ${integrationSuggestion.name} today!](${integrationSuggestion.invite})**`
          };
          suggestions.push(integrationSuggestionField);
        }

        let description =
          `**Total Cooldown:** ${ms(cooldown, { long: true })}\n` +
          `**Next Bump:** In ${ms(remaining, { long: true })}`;

        if (
          guildDatabase.lastBumpedWith &&
          guildDatabase.lastBumpedWith !== this.instance.client.user?.id
        ) {
          // Last bump via SBLP
          if (guildDatabase.lastBumpedWith === Utils.BumpProvider.SANDBOX) {
            description =
              `**This server was recently used with Sandbox Mode enabled!**\n` +
              `After using Sandbox Mode, the cooldown is restarted.\n` +
              `\n` +
              description;
          } else {
            const provider =
              (await this.instance.client.users
                .fetch(guildDatabase.lastBumpedWith)
                .catch(() => {})) ||
              (await Application.findOne({
                where: { id: guildDatabase.lastBumpedWith }
              }));
            const lastTrigger =
              (await this.instance.client.users
                .fetch(String(guildDatabase.lastBumpedBy))
                .catch(() => {})) || undefined;
            console.log(guildDatabase.lastBumpedWith, provider, lastTrigger);
            if (provider && lastTrigger) {
              description =
                `**This server was bumped to multiple bots using SBLP!**\n` +
                `${lastTrigger.tag} has recently bumped this server using ${
                  provider instanceof Application ? provider.name : provider.tag
                }.\n` +
                `${this.instance.client.user?.username} has been informed about that and bumped your server with ${this.instance.client.user?.username} too!\n` +
                `\n` +
                description;
            }
          }
        }

        const reminderField: Partial<Discord.EmbedFieldData> = {
          name: `${Utils.Emojis.REMINDER} Reminder`,
          value:
            `Do you want to be reminded when you can bump again? ` +
            `React with ${Utils.Emojis.REMINDER} to this message and ${this.instance.client.user?.username} will let you know once the cooldown is over.`
        };

        const reminderFieldIndex = suggestions.push(reminderField) - 1;

        const embed = {
          color: Utils.Colors.RED,
          title: `${Utils.Emojis.XMARK} You are on cooldown!`,
          description,
          fields: suggestions
        };

        const cooldownMessage = await channel.send({ embed });

        const reminderReaction = await cooldownMessage
          .react(Utils.Emojis.REMINDER)
          .catch(() => {});

        const reminded: Array<string> = [];
        await cooldownMessage.awaitReactions(
          (reaction: Discord.MessageReaction, user: Discord.User) => {
            (async () => {
              if (user instanceof ClientUser || user.bot) return;
              if (
                reaction.emoji.name !== Utils.Emojis.REMINDER &&
                reaction.emoji.id !== Utils.Emojis.getRaw(Utils.Emojis.REMINDER)
              )
                return;

              if (reminded.includes(user.id)) return;
              reminded.push(user.id);

              const [userDatabase] = await User.findOrCreate({
                where: { id: user.id },
                defaults: { id: user.id }
              });

              await Utils.remind(userDatabase, guildDatabase, channel.id);

              await channel.send(
                `${Utils.Emojis.CHECK} Will remind \`${user.tag}\` once this server can be bumped again.`
              );
            })();
            return false;
          },
          { time: 30000 }
        );

        if (reminderReaction)
          await reminderReaction.users
            .remove(OpenBump.instance.client.user?.id)
            .catch(() => {});

        embed.fields.splice(reminderFieldIndex, 1);
        return void (await cooldownMessage.edit({ embed }));
      }

      guildDatabase.lastBumpedAt = new Date();
      guildDatabase.lastBumpedBy = author.id;
      guildDatabase.lastBumpedWith = this.instance.client.user?.id;
      guildDatabase.totalBumps++;
      await guildDatabase.save();

      // Start SBLP (async)
      const sblp = new SBLPBumpEntity(
        void 0,
        this.instance.client.user?.id as string,
        false,
        config.settings.integration?.sblp.post,
        guild.id,
        channel.id,
        message.author.id
      );

      const loadingEmbedEmbed = {
        color: Utils.Colors.BLUE,
        title: `${Utils.Emojis.LOADING} Building your server's bump message... [1/2]`
      };
      const loadingMessage = await channel.send({ embed: loadingEmbedEmbed });

      // TODO: Use correct bump utils function to regulate receivers
      let bumpEmbed;

      try {
        bumpEmbed = await Utils.Bump.getEmbed(guild, guildDatabase, author.id);
      } catch (error) {
        if (error instanceof EmbedError) {
          guildDatabase.lastBumpedAt = null;
          await guildDatabase.save();
          return void (await loadingMessage.edit({ embed: error.toEmbed() }));
        } else throw error;
      }

      const loadingBumpEmbed = {
        color: Utils.Colors.BLUE,
        title: `${Utils.Emojis.LOADING} Pushing your server's bump message to other servers... [2/2]`
      };
      await loadingMessage.edit({ embed: loadingBumpEmbed });

      let { amount, featured } = await Utils.Bump.bump(
        guildDatabase,
        bumpEmbed
      );

      const featuredGuildDatabases = featured.length
        ? await Guild.findAll({
            where: {
              id: {
                [Op.in]: featured.map(({ id }) => id),
                [Op.ne]: guildDatabase.sandbox ? null : guild.id
              },
              name: {
                [Op.and]: [
                  {
                    [Op.ne]: null
                  },
                  {
                    [Op.ne]: ""
                  }
                ]
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

      console.log(
        `Guild ${guild.name} (${guild.id}) has been successfully bumped to ${amount} servers.`
      );

      const fields: Array<Partial<Discord.EmbedFieldData>> = [];

      if (featuredGuildDatabases.length) {
        fields.push({
          name: `${Utils.Emojis.FEATURED} Featured servers your server was bumped to`,
          value: Utils.niceList(
            featuredGuildDatabases.map(
              (guild) =>
                `**[${guild.name}](https://discord.gg/${guild.bumpData.invite})**`
            )
          )
        });
      }

      const integrationSuggestion = await this.instance.integration.getBotSuggestion(
        guild
      );

      const integrationSuggestionField = integrationSuggestion && {
        name: `${Utils.Emojis.BELL} Bot Suggestion: ${integrationSuggestion.name}`,

        value: `Bump bots are most effective when used together. **[Start using ${integrationSuggestion.name} today!](${integrationSuggestion.invite})**`
      };

      if (integrationSuggestionField) fields.push(integrationSuggestionField);

      const nextBumpField: Partial<Discord.EmbedFieldData> = {};
      const buildNextBumpField = (reminder: boolean) => {
        nextBumpField.name = `${Utils.Emojis.CLOCK} Next Bump`;
        nextBumpField.value = `You can bump again in ${ms(cooldown, {
          long: true
        })}.${
          votingEnabled && !voted && !maxedOut && cooldown > voteCooldown
            ? `\n` +
              `**[Vote for ${
                this.instance.client.user?.username
              }](${Utils.Lists.getLinkTopGG()})** to reduce your cooldown by ${ms(
                cooldown - voteCooldown,
                {
                  long: true
                }
              )} for the next 12 hours!`
            : ""
        }${
          reminder
            ? `\n\n` +
              `Do you want to be reminded when you can bump again? ` +
              `React with ${Utils.Emojis.REMINDER} to this message and ${this.instance.client.user?.username} will let you know once the cooldown is over.`
            : ""
        }`;
      };
      buildNextBumpField(true);
      fields.push(nextBumpField);

      let description = `Your server has been successfully bumped.`;

      const providerStates = sblp?.getProviderStates();
      const effectiveProviderStates: typeof providerStates = [];

      if (providerStates)
        for (const entry of providerStates) {
          const providerMember = await guild.members
            .fetch(entry.provider)
            .catch(() => {});
          if (providerMember) effectiveProviderStates.push(entry);
        }

      const successEmbed = {
        color: Utils.Colors.GREEN,
        title: `${Utils.Emojis.CHECK} Success`,
        description,
        fields
      };

      if (sblp && effectiveProviderStates.length) {
        successEmbed.description +=
          `\n\n` +
          `${this.instance.client.user?.username} is also bumping other bump bots you have on your server. ` +
          `Check the list below to get a detailed view of which other bump bots are being bumped.`;

        const sblpField = {
          name: `${Utils.Emojis.SBLP} Other bump bots`,
          value: effectiveProviderStates
            .map(({ provider, message }) => `<@${provider}>: \`${message}\``)
            .join("\n")
        };

        sblp.onUpdate(async () => {
          const before = JSON.stringify(sblpField);
          sblpField.value = effectiveProviderStates
            .map(
              ({ provider }) =>
                `<@${provider}>: \`${sblp.getProviderState(provider)}\``
            )
            .join("\n");
          const after = JSON.stringify(sblpField);
          if (before !== after)
            await loadingMessage.edit({ embed: successEmbed });
        });

        fields.unshift(sblpField);
      }

      await loadingMessage.edit({ embed: successEmbed });

      const reminderReaction = await loadingMessage
        .react(Utils.Emojis.REMINDER)
        .catch(() => {});

      const reminded: Array<string> = [];
      await loadingMessage.awaitReactions(
        (reaction: Discord.MessageReaction, user: Discord.User) => {
          (async () => {
            if (user instanceof ClientUser || user.bot) return;
            if (
              reaction.emoji.name !== Utils.Emojis.REMINDER &&
              reaction.emoji.id !== Utils.Emojis.getRaw(Utils.Emojis.REMINDER)
            )
              return;

            if (reminded.includes(user.id)) return;
            reminded.push(user.id);

            const [userDatabase] = await User.findOrCreate({
              where: { id: user.id },
              defaults: { id: user.id }
            });

            await Utils.remind(userDatabase, guildDatabase, channel.id);

            await channel.send(
              `${Utils.Emojis.CHECK} Will remind \`${user.tag}\` once this server can be bumped again.`
            );
          })();
          return false;
        },
        { time: 30000 }
      );

      if (reminderReaction)
        await reminderReaction.users
          .remove(OpenBump.instance.client.user?.id)
          .catch(() => {});

      buildNextBumpField(false);
      await loadingMessage.edit({ embed: successEmbed });
    } else {
      const embed = {
        color: Utils.Colors.ORANGE,
        title: `${Utils.Emojis.IMPORTANTNOTICE} Autobump Enabled`,
        description:
          `You can't manually bump your server because you have autobump enabled.\n` +
          `As long as you have autobump enabled, ${
            this.instance.client.user?.username
          } automatically bumps your server every ${ms(
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
