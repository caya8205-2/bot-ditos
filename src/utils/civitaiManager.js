const { Civitai } = require('civitai');


const civitai = new Civitai({
    auth: process.env.CIVITAI_API_KEY
});

// Since the original code accessed 'civitai' directly, we export the instance.
module.exports = { civitai };
