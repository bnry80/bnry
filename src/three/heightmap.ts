import * as THREE from 'three'

/**
 * Builds a grayscale HEIGHTMAP on a canvas and returns it as a texture.
 * The bas-relief shader reads brightness as surface height:
 *   white = raised, black = recessed.
 *
 * This procedural version "carves" the Binary Pencil wordmark + asterisk so we
 * have an on-brand hero with zero external assets. To use a real portrait
 * instead, replace this with `useTexture('/portrait.jpg')` — the shader treats
 * any image the same way (bright areas rise, dark areas sink).
 */
export function makeWordmarkHeightmap(size = 2048): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!

  // Recessed ground: mid-dark with a soft central rise so the plate reads 3D.
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, size, size)

  const g = ctx.createRadialGradient(
    size * 0.5, size * 0.5, size * 0.05,
    size * 0.5, size * 0.5, size * 0.62,
  )
  g.addColorStop(0, '#1c1c1c')
  g.addColorStop(1, '#0b0b0b')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Soft glow under the type => rounded, carved edges rather than a hard cut.
  ctx.shadowColor = 'rgba(255,255,255,0.55)'
  ctx.shadowBlur = size * 0.012

  // Big condensed wordmark — the raised relief.
  ctx.fillStyle = '#ffffff'
  ctx.font = `${Math.round(size * 0.30)}px Anton, 'Arial Narrow', sans-serif`
  ctx.fillText('BINARY', size * 0.5, size * 0.42)

  ctx.font = `${Math.round(size * 0.135)}px Anton, 'Arial Narrow', sans-serif`
  ctx.fillText('PENCIL', size * 0.5, size * 0.60)

  // Asterisk / sparkle marks flanking the type.
  ctx.font = `${Math.round(size * 0.11)}px Fraunces, Georgia, serif`
  ctx.fillStyle = '#eaeaea'
  ctx.fillText('✳', size * 0.5, size * 0.735)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace // heightmap is data, not sRGB color
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}
