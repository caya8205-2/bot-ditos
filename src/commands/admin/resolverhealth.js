'use strict';

const { EmbedBuilder } = require('discord.js');
const youtubeResolver = require('../../utils/youtubeResolver');
const musicCache = require('../../utils/musicCache');

module.exports = {
    name: 'resolverhealth',
    aliases: ['rh', 'resolverstats'],
    description: 'Cek health status YouTube resolver & cache',
    async execute(message) {
        try {
            const metrics = youtubeResolver.getMetrics();
            const cacheStats = musicCache.getCacheStats();
            
            // Health color
            let color = 0x00ff00; // Green
            if (metrics.health.includes('WARNING')) color = 0xffff00; // Yellow
            if (metrics.health.includes('DEGRADED')) color = 0xff9900; // Orange
            if (metrics.health.includes('CRITICAL')) color = 0xff0000; // Red
            
            const embed = new EmbedBuilder()
                .setTitle('🔧 YouTube Resolver Health')
                .setColor(color)
                .setDescription(`**Status:** ${metrics.health}\n**Uptime:** ${metrics.uptime}`)
                .addFields(
                    {
                        name: '📊 Resolve Stats',
                        value: [
                            `Total: ${metrics.resolves.total}`,
                            `Success: ${metrics.resolves.success}`,
                            `Failed: ${metrics.resolves.failure}`,
                            `Success Rate: ${metrics.resolves.successRate}`,
                        ].join('\n'),
                        inline: true,
                    },
                    {
                        name: '💾 Cache Stats',
                        value: [
                            `Hits: ${metrics.cache.hit}`,
                            `Misses: ${metrics.cache.miss}`,
                            `Hit Rate: ${metrics.cache.hitRate}`,
                            `Total Songs: ${cacheStats.total}`,
                        ].join('\n'),
                        inline: true,
                    }
                )
                .setTimestamp();
            
            // Client-specific stats (jika ada)
            const clientEntries = Object.entries(metrics.clients);
            if (clientEntries.length > 0) {
                const clientStats = clientEntries
                    .sort((a, b) => b[1].success - a[1].success)
                    .slice(0, 3)
                    .map(([client, data]) => 
                        `**${client}**: ${data.success}/${data.attempts} (${data.successRate}) • ${data.avgTimeMs}ms`
                    )
                    .join('\n') || 'No data';
                
                embed.addFields({
                    name: '🔌 Top Clients',
                    value: clientStats,
                    inline: false,
                });
            }
            
            // Recent failures
            if (metrics.recentFailures.length > 0) {
                const failures = metrics.recentFailures
                    .map(f => `• ${f.error.substring(0, 60)}... (${f.count}x)`)
                    .join('\n');
                
                embed.addFields({
                    name: '⚠️ Recent Errors',
                    value: failures,
                    inline: false,
                });
            }
            
            // Tips
            if (metrics.health.includes('CRITICAL') || metrics.health.includes('DEGRADED')) {
                embed.setFooter({ text: '💡 Tip: Export YouTube cookies atau enable yt-dlp fallback' });
            }
            
            await message.reply({ embeds: [embed] });
            
        } catch (err) {
            console.error('[resolverhealth] Error:', err);
            await message.reply('Error fetching resolver metrics: ' + err.message);
        }
    },
};
