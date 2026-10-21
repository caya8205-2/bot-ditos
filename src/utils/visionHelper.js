/**
 * Deteksi kapabilitas multimodal sebuah model.
 *
 * Sumber utama adalah katalog provider (endpoint /models) yang mengekspos
 * `input_modalities` per model. Pola nama hanya dipakai sebagai fallback
 * kalau katalog belum tersedia, supaya bot tidak menebak-nebak.
 *
 * Image dan video dipisah karena tidak semua model vision bisa video.
 */

const catalog = require('./modelCatalog');

/**
 * Versi sinkron (dipakai di jalur yang tidak bisa await).
 * Membaca cache katalog; kalau belum ada, jatuh ke pola nama.
 */
function isVisionSupported(modelName) {
    return catalog.isVisionSupportedSync(modelName);
}

function isVideoSupported(modelName) {
    return catalog.isVideoSupportedSync(modelName);
}

/**
 * Versi async, lebih akurat karena bisa mengambil katalog bila cache kosong.
 */
async function isVisionSupportedAsync(modelName) {
    return catalog.isVisionSupportedAsync(modelName);
}

async function isVideoSupportedAsync(modelName) {
    return catalog.isVideoSupportedAsync(modelName);
}

/**
 * Prefetch katalog di awal supaya deteksi sinkron langsung akurat.
 */
function warmModelCatalog() {
    return catalog.warmCatalog();
}

module.exports = {
    isVisionSupported,
    isVideoSupported,
    isVisionSupportedAsync,
    isVideoSupportedAsync,
    warmModelCatalog,
};
