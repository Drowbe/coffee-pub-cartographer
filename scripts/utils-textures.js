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
 * background elsewhere, which want their mipmaps -- so repeats draw from a
 * copy without them.
 *
 * The copy is made by drawing Foundry's texture into a render texture once,
 * through PIXI's ordinary pipeline. An earlier version built a second texture
 * straight from the loaded image instead, and got the image's alpha handling
 * wrong: soft transparent edges came out brighter than they should, so
 * branches and other cut-out art looked as if they glowed. Drawing it means
 * the copy holds exactly what Foundry would draw.
 *
 * A video cannot be copied this way -- the copy would be one frozen frame --
 * so a video keeps Foundry's own texture, seam and all.
 */

/** Foundry's base texture -> the render-texture copy made from it. */
const copies = new Map();

export function repeatingTexture(texture) {
    const base = texture?.baseTexture;
    if (!base?.valid || base.mipmap === PIXI.MIPMAP_MODES.OFF) return texture;
    if (base.resource instanceof PIXI.VideoResource) return texture;
    const renderer = canvas?.app?.renderer;
    if (!renderer) return texture;
    const existing = copies.get(base);
    if (existing && !existing.destroyed) return existing;

    const copy = PIXI.RenderTexture.create({
        width: texture.width,
        height: texture.height,
        resolution: base.resolution,
        scaleMode: base.scaleMode
    });
    copy.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    const sprite = new PIXI.Sprite(texture);
    renderer.render(sprite, { renderTexture: copy, clear: true });
    sprite.destroy({ texture: false, baseTexture: false });
    copies.set(base, copy);
    return copy;
}

/** Free the copies when the canvas goes away. They are ours alone, so they are destroyed outright. */
export function releaseRepeatingTextures() {
    for (const copy of copies.values()) {
        if (!copy.destroyed) copy.destroy(true);
    }
    copies.clear();
}
