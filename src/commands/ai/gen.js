const { civitai } = require('../../utils/civitaiManager');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { OWNER_ID } = require('../../config');
const { replyEmbedAndSave, reportErrorToDiscord } = require('../../utils/helpers');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

module.exports = {
    name: 'gen',
    description: 'Generate image using Civitai (Stable Diffusion)',
    aliases: ['generate'],
    async execute(message, args, client) {
        return message.reply('⚠️ Command d!gen lagi maintenance (sengaja dimatiin sama <@' + OWNER_ID + '> <:xixixixi:1119669394822406264>)');

        const prompt = args.join(" ").trim();

        const usageEmbed = new EmbedBuilder()
            .setTitle('🧠 AI Image Generator')
            .setDescription('Generate gambar anime-style pakai AI (Civitai).')
            .addFields({ name: 'Cara Pakai', value: '`d!gen <prompt>`\nContoh: `d!gen 1girl, white hair, blue eyes, masterpiece`' })
            .setColor('#00D9FF');

        if (!prompt) {
            return replyEmbedAndSave(message, { embeds: [usageEmbed] });
        }

        try {
            if (!process.env.CIVITAI_API_KEY) {
                return message.reply('⚠️ Civitai API key belum diset. Hubungi owner bot.');
            }

            const progressMsg = await message.reply('🧠 Generating image... (ini bisa makan waktu 30s - 5 menit)');

            const modelUrn = "urn:air:sdxl:checkpoint:civitai:1595884@1805971";
            const loraUrn = "urn:air:sdxl:lora:civitai:1506082@2284955";
            const enhancedPrompt = `${prompt}, masterpiece, best quality, ultra-detailed, 8k`;

            console.log('[Civitai] Starting generation with prompt:', enhancedPrompt);

            const jobConfig = {
                model: modelUrn,
                params: {
                    prompt: enhancedPrompt,
                    negativePrompt: "lowres, bad anatomy, bad hands, blurry, extra fingers, text, error, missing limbs, cropped, worst quality, low quality",
                    width: 832,
                    height: 1216,
                    steps: 30,
                    cfgScale: 5,
                    scheduler: "EulerA",
                    seed: -1
                },
                additionalNetworks: {
                    [loraUrn]: { strength: 0.8 }
                }
            };

            const generation = await civitai.image.fromText(jobConfig);
            const jobId = generation.id || generation.jobId || generation.token;

            if (!jobId) {
                await progressMsg.edit('❌ Gagal create generation job');
                return;
            }

            let decodedJobId = jobId;
            try {
                const decoded = Buffer.from(jobId, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (parsed.Jobs?.[0]) decodedJobId = parsed.Jobs[0];
            } catch (e) {
                console.log('[Civitai] Using raw job ID');
            }

            console.log('[Civitai] Polling job:', decodedJobId);

            // Manual polling
            const TIMEOUT = 300000;
            const POLL_INTERVAL = 5000;
            const startTime = Date.now();
            let lastUpdate = 0;
            let result = null;

            while (true) {
                const elapsed = Date.now() - startTime;

                if (elapsed > TIMEOUT) {
                    await progressMsg.edit('⏱️ Generation timeout. Coba lagi nanti.');
                    return;
                }

                try {
                    const statusRes = await fetch(`https://orchestration.civitai.com/v1/consumer/jobs/${decodedJobId}`, {
                        headers: {
                            'Authorization': `Bearer ${process.env.CIVITAI_API_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    });

                    if (!statusRes.ok) {
                        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
                        continue;
                    }

                    const status = await statusRes.json();
                    const eventType = status.lastEvent?.type || 'unknown';
                    const isCompleted = status.lastEvent?.jobHasCompleted || false;
                    const isAvailable = status.result?.[0]?.available || false;

                    if (elapsed - lastUpdate > 15000) {
                        const elapsedSec = Math.floor(elapsed / 1000);
                        await progressMsg.edit(
                            `🧠 Generating image...\n` +
                            `Status: **${eventType}**\n` +
                            `Time: ${elapsedSec}s / 300s`
                        );
                        lastUpdate = elapsed;
                    }

                    if (isCompleted && isAvailable) {
                        result = status;
                        console.log('[Civitai] Generation complete!');
                        break;
                    }

                    if (eventType === 'Failed' || eventType === 'Error') {
                        await progressMsg.edit('❌ Generation failed');
                        return;
                    }

                } catch (pollError) {
                    console.error('[Civitai] Poll error:', pollError.message);
                }

                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            }

            const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const imgUrl = result.result?.[0]?.blobUrl;

            if (!imgUrl) {
                await progressMsg.edit('❌ Image URL not found in result');
                console.log('[Civitai] Result:', result.result);
                return;
            }

            console.log('[Civitai] Using blobUrl:', imgUrl);

            try {
                const imgResponse = await fetch(imgUrl);

                if (!imgResponse.ok) {
                    console.log('[Civitai] Image download failed:', imgResponse.status);
                    await progressMsg.edit('❌ Failed to download image');
                    return;
                }

                const imageBuffer = await imgResponse.arrayBuffer();
                const attachment = new AttachmentBuilder(Buffer.from(imageBuffer), {
                    name: 'generated.png'
                });

                const resultEmbed = new EmbedBuilder()
                    .setTitle('✨ Generated Image')
                    .setDescription(`**Prompt:** \`${prompt}\`\n**Time:** ${totalElapsed}s`)
                    .setImage('attachment://generated.png')
                    .setColor('#00D9FF')
                    .setFooter({ text: `Requested by ${message.author.username}` })
                    .setTimestamp();

                await message.channel.send({
                    embeds: [resultEmbed],
                    files: [attachment]
                });

                await progressMsg.delete().catch(() => { });
                console.log('[Civitai] Success!');

            } catch (downloadError) {
                console.error('[Civitai] Download error:', downloadError.message);
                await message.channel.send(
                    `✨ **Generated!**\n` +
                    `**Prompt:** \`${prompt}\`\n` +
                    `Image URL (external): ${imgUrl}\n\n` +
                    `*Kalau gak muncul, copy link dan buka di browser*`
                );
                await progressMsg.delete().catch(() => { });
            }

        } catch (error) {
            console.error('[Civitai] Error:', error);
            let errorMsg = '❌ Error pas generate gambar:\n';
            if (error.status === 400) errorMsg += '📝 **Bad Request**';
            else if (error.status === 429) errorMsg += '⚠️ **Rate Limit**';
            else if (error.status === 401) errorMsg += '🔑 **Auth Error**';
            else errorMsg += `\`\`\`${error.message}\`\`\``;

            await message.reply(errorMsg);
            if (error.status !== 429) reportErrorToDiscord(client, error); // Note: client passed here? original used global reportErrorToDiscord(error), which used global client? No, index.js had client. 
            // reportErrorToDiscord in helpers.js expects (client, error).
            // gen execute passes (message, args, client).
            // so reportErrorToDiscord(client, error) is correct.
        }
    },
};
