const main = require('../bot')
const colors = require('../utils/colors')
const emojis = require('../utils/emojis')
const errors = require('../utils/errors')
const bump = require('../utils/bump')
const donator = require('../utils/donator')
const common = require('../utils/common')
const moment = require('moment')
const ms = require('ms')
const Guild = require('../models/Guild')

module.exports.run = async (msg, invoke, args, prefix, guildDatabase) => {
  let guild = msg.guild
  let channel = msg.channel
  let author = msg.author

  if(!guildDatabase.autoBump) {
    if(guildDatabase.lastBump && guildDatabase.lastBump.time) {
      let cooldown = donator.translateCooldown(guildDatabase)
      let nextBump = moment(guildDatabase.lastBump.time.valueOf() + cooldown)
      if(nextBump.isAfter(moment())) {
        let remaining = ms(nextBump.valueOf() - moment().valueOf(), { long: true })
        let options = {
          embed: {
            color: colors.red,
            title: `${emojis.xmark} **Oops, you are on cooldown!**`,
            description: `**Next Bump:** in ${remaining}`
          }
        }
        return channel.send('', options)
      }
    }

    let options = {
      embed: {
        color: colors.blue,
        title: emojis.loading + ' **Your server is beeing bumped...**'
      }
    }
    let message = await channel.send('', options)
    options = await bump.getPreviewEmbed(guild, guildDatabase)
    let amount = await bump.bumpToAllShards(options)
    options = {
      embed: {
        color: colors.green,
        title: emojis.check + ' *Success*',
        description: `Your server has been bumped to \`${amount} Servers\`. It may take some time until your bump is shown in every server with a bump channel.`
      }
    }
    message.edit('', options)
    guildDatabase.lastBump = {}
    guildDatabase.lastBump.user = author.id
    guildDatabase.lastBump.time = Date.now()
    guildDatabase.save()
  } else {
    let lastBumpUser = await main.client.fetchUser(guildDatabase.lastBump.user)
    let options = {
      embed: {
        color: colors.orange,
        title: `${emojis.importantNotice} **Autobump enabled**`,
        description: 'You can\'t manually bump your server because you have autobump enabled.\n' +
            `As long as you have autobump enabled, the bot automatically bumps your server every ${ms(donator.translateCooldown(guildDatabase), { long: true })}.` +
            `${guildDatabase.lastBump && guildDatabase.lastBump.time && guildDatabase.lastBump.user ? `\n\n` +
                `**Last bump:** ${ms(Date.now().valueOf() - guildDatabase.lastBump.time.valueOf(), { long: true })} ago\n` +
                `**Last bump by:** ${lastBumpUser ? lastBumpUser.tag : guildDatabase.lastBump.user}` +
                `` : ''}`
      }
    }
    channel.send('', options)
  }
}

module.exports.name = 'bump'
module.exports.description = 'Use this command to bump your server.'
module.exports.syntax = 'bump'