// ==================================================================
// ===== REPEATING TEXTURES =========================================
// ==================================================================

/**
 * Textures for images that repeat: parallax layers and scrolling tiles.
 *
 * PIXI repeats an image of any size other than a power of two in its shader,
 * wrapping the coordinate with fract(). Where it wraps, the coordinate jumps
 * from one edge of the image to the other within a single pixel, and the GPU,
 * reading that jump as an extreme minification, samples that pixel from the
 * smallest mipmap. The result is a one-pixel line of blurred colour at the
 * seam, which flickers as the image moves and the seam lands on different
 * pixels. Foundry mipmaps its textures, so every repeating layer showed it.
 *
 * A texture without mipmaps has nothing to drop to, so the seam disappears.
 * Foundry's own texture cannot be changed -- the same image may be a tile or a
 * background elsewhere, which want their mipmaps -- so a second texture is
 * made over the same loaded image, and repeats use that. The image itself is
 * not loaded twice.
 */

/** Foundry's texture -> the mipmap-free twin made for it. */
const twins = new Map();

export function repeatingTexture(texture) {
    const base = texture?.baseTexture;
    if (!base || base.mipmap === PIXI.MIPMAP_MODES.OFF) return texture;
    const existing = twins.get(base);
    if (existing && !existing.baseTexture.destroyed) return existing;
    const source = base.resource?.source;
    if (!source) return texture;
    const twinBase = new PIXI.BaseTexture(source, {
        mipmap: PIXI.MIPMAP_MODES.OFF,
        scaleMode: base.scaleMode,
        alphaMode: base.alphaMode,
        resolution: base.resolution
    });
    const twin = new PIXI.Texture(twinBase);
    twins.set(base, twin);
    return twin;
}

/**
 * Free the twins' GPU memory when the canvas goes away. They are disposed
 * rather than destroyed: destroying would destroy their resource too, and for
 * a video that pauses and unloads the very element Foundry is still playing.
 */
export function releaseRepeatingTextures() {
    for (const twin of twins.values()) twin.baseTexture.dispose();
    twins.clear();
}
