import moment from "moment";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import config from "./config";
import AssignedTier from "./models/AssignedTier";
import Donator from "./models/Donator";
import PremiumTier from "./models/PremiumTier";
import OpenBump from "./OpenBump";
import Utils from "./Utils";

export default class Premium {
  constructor(private instance: OpenBump) {}

  public async init() {
    await this.premiumLoop();
  }

  private async premiumLoop() {
    console.log("Running premium loop...");

    // TODO: Make sure there are no conflicts with other shards checking premiums at the same time

    // Go through new and current violators
    const violators = await Donator.findAll({
      attributes: {
        include: [
          [
            Sequelize.fn(
              "SUM",
              Sequelize.col("assignedTiers.premiumTier.cost")
            ),
            "totalAssigned"
          ],
          [Sequelize.literal("patreon + bonus"), "totalBalance"]
        ]
      },
      group: "userId",
      include: [
        {
          model: AssignedTier,
          attributes: ["id", "premiumTierId"],
          required: true,
          include: [
            {
              model: PremiumTier.scope(""),
              attributes: ["cost"],
              required: true
            }
          ]
        }
      ],
      where: {
        "$assignedTiers.premiumTier.cost$": {
          [Op.gt]: 0
        }
      },
      having: {
        totalAssigned: {
          [Op.gt]: Sequelize.col("totalBalance")
        }
      }
    });

    for (const violator of violators) {
      if (!violator.transitionStartedAt) {
        // No transition started yet
        violator.set("transitionStartedAt", new Date());

        try {
          const user = await this.instance.client.users.fetch(violator.userId);
          const embed = {
            color: Utils.Colors.ORANGE,
            title: `${Utils.Emojis.IMPORTANTNOTICE} Payment issue`,
            description:
              "Hey there, we recently detected a problem with your premium. " +
              "It looks like your balance is not enough to cover the cost for all activated servers. " +
              "Please fix this issue asap." +
              "You can increate your pledge or disable/change change servers. " +
              `To get an overview of your activated premium servers, use the command \`${Utils.getPrefix()}premium\` to do so. ` +
              "Please note, the premium command needs to be executed on your own server and not via DMs. " +
              `If you believe this is an error, please contact **[Support](${config.settings.support})**.\n` +
              `\n` +
              `**Current Balance:** ${violator.get("totalBalance")} cents\n` +
              `**Required Balance:** ${violator.get("totalAssigned")} cents`
          };
          await user.send({ embed });
          violator.transitionStartInformed = true;
        } catch (error) {
          violator.transitionStartInformed = false;
        }
        if (violator.changed()) await violator.save();
      } else if (
        violator.transitionStartedAt &&
        moment(violator.transitionStartedAt).isBefore(moment().subtract(1, "m")) // TODO: Update to 3 days
      ) {
        // Transition due
        await AssignedTier.destroy({ where: { donatorId: violator.id } });

        try {
          const user = await this.instance.client.users.fetch(violator.userId);
          const embed = {
            color: Utils.Colors.RED,
            title: `${Utils.Emojis.XMARK} Premium deactivated`,
            description:
              "Hey there, this is a notice that your premium has been deactivated. " +
              "This happened because your balance was not able to cover all activated servers for 3 days. " +
              "All of your premium activations have been disabled." +
              `If you believe this is an error, please contact **[Support](${config.settings.support})**.`
          };
          await user.send({ embed });
          violator.transitionStartedAt = null;
          violator.transitionStartInformed = null;
          violator.transitionFixedAt = null;
          violator.transitionEndedAt = null;
        } catch (error) {
          violator.transitionEndedAt = new Date();
        }
        if (violator.changed()) await violator.save();
      } else if (
        violator.transitionStartedAt &&
        !violator.transitionStartInformed
      ) {
        // Transition not due, but not yet informed
        try {
          const user = await this.instance.client.users.fetch(violator.userId);
          const embed = {
            color: Utils.Colors.ORANGE,
            title: `${Utils.Emojis.IMPORTANTNOTICE} Payment issue`,
            description:
              "Hey there, we recently detected a problem with your premium. " +
              "It looks like your balance is not enough to cover the cost for all activated servers. " +
              "Please fix this issue asap." +
              "You can increate your pledge or disable/change change servers. " +
              `To get an overview of your activated premium servers, use the command \`${Utils.getPrefix()}premium\` to do so. ` +
              "Please note, the premium command needs to be executed on your own server and not via DMs. " +
              `If you believe this is an error, please contact **[Support](${config.settings.support})**.`
          };
          await user.send({ embed });
          violator.transitionStartInformed = true;
        } catch (error) {
          violator.transitionStartInformed = false;
        }
        if (violator.changed()) await violator.save();
      }
    }

    // Go through resolved violators
    const exs = await Donator.findAll({
      attributes: {
        include: [
          [
            Sequelize.fn(
              "SUM",
              Sequelize.col("assignedTiers.premiumTier.cost")
            ),
            "totalAssigned"
          ],
          [Sequelize.literal("patreon + bonus"), "totalBalance"]
        ]
      },
      group: "userId",
      include: [
        {
          model: AssignedTier,
          attributes: ["id", "premiumTierId"],
          required: true,
          include: [
            {
              model: PremiumTier.scope(""),
              attributes: ["cost"],
              required: true
            }
          ]
        }
      ],
      where: {
        transitionStartedAt: {
          [Op.ne]: null
        }
      },
      having: {
        totalAssigned: {
          [Op.lte]: Sequelize.col("totalBalance")
        }
      }
    });

    for (const ex of exs) {
      if (!ex.transitionFixedAt) ex.transitionFixedAt = new Date();

      try {
        const user = await this.instance.client.users.fetch(ex.userId);
        const embed = {
          color: Utils.Colors.GREEN,
          title: `${Utils.Emojis.CHECK} Issue resolved`,
          description:
            "Hey there, we recently detected a problem with your premium. " +
            "However, it looks like the issue has been resolved and we removed the entry from our database. " +
            "Thank you for your support!"
        };
        await user.send({ embed });
        ex.transitionStartedAt = null;
        ex.transitionStartInformed = null;
        ex.transitionFixedAt = null;
        ex.transitionEndedAt = null;
      } catch (error) {
        ex.transitionStartedAt = null;
        ex.transitionStartInformed = null;
        ex.transitionEndedAt = null;
        ex.transitionFixedAt = new Date();
      }
      if (ex.changed()) await ex.save();
    }

    // Only for debug reasons
    console.log(
      "violators",
      violators.map(
        (violator) =>
          `${violator.userId}:${violator.get("totalAssigned")}/${violator.get(
            "totalBalance"
          )}`
      )
    );
    console.log(
      "exs",
      exs.map(
        (ex) =>
          `${ex.userId}:${ex.get("totalAssigned")}/${ex.get("totalBalance")}`
      )
    );

    setTimeout(this.premiumLoop.bind(this), 1000 * 60);
  }
}