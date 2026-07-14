import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'

/* -------------------------------------------------------------------------
   Faithful port of Immersive Garden's home relief (reverse-engineered from
   their default.BZYNaK9D.js — see memory reference-immersive-garden-effect):

   • 3D GLB relief, matcap-shaded => continuous plaster wall
   • Mouse leaves a dissipating fluid DYE trail (screen-space)
   • The "chromatic" look is IRIDESCENCE: surface normal -> HSV -> hue-shift,
     mixed in ONLY where fresnel-rim × dye × animated-lines × amplitude
   ------------------------------------------------------------------------- */

const PATH = '/hero/relief.glb'
const WALL = '#e8e4dc'
const TRAIL = 1024

// Light plaster matcap: bright upper-left highlight easing to a soft grey rim.
function makeMatcap(size = 256) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(
    size * 0.38, size * 0.34, size * 0.02,
    size * 0.5, size * 0.52, size * 0.62,
  )
  g.addColorStop(0.0, '#f8f5ef')
  g.addColorStop(0.35, '#ece7de')
  g.addColorStop(0.7, '#dbd5cb')
  g.addColorStop(1.0, '#c2bcb1')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // faint grain so the plaster isn't glassy
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 4
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeTrail() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = TRAIL
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, TRAIL, TRAIL)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.NoColorSpace
  return { canvas, ctx, tex }
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec4 vMvPosition;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vMvPosition = mv;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec4 vMvPosition;

  uniform sampler2D uMatcap;
  uniform sampler2D uTrail;
  uniform sampler2D uPlaster;
  uniform vec2  uResolution;
  uniform float uTime;

  uniform float uAmplitude;
  uniform float uHueShift;
  uniform float uColorRange;
  uniform float uFresnelSharpness;
  uniform float uFresnelOpacity;
  uniform float uLinesSpeed;
  uniform float uLinesScale;
  uniform float uLinesStrength;
  uniform float uLinesWaveLength;
  uniform float uFluidMagnitude;

  // IG's matcap uv from view position + view normal
  vec2 getMatcapUv(vec4 mv, vec3 n) {
    vec3 viewDir = normalize(-mv.xyz);
    vec3 x = normalize(vec3(viewDir.z, 0.0, -viewDir.x));
    vec3 y = cross(viewDir, x);
    return vec2(dot(x, n), dot(y, n)) * 0.495 + 0.5;
  }
  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec3 n = normalize(vViewNormal);

    // Plaster base: matcap shading + faint grain.
    vec2 matcapUv = getMatcapUv(vMvPosition, n);
    vec3 base = texture2D(uMatcap, matcapUv).rgb;
    float grain = texture2D(uPlaster, vUv * 4.0).r;
    base *= mix(0.96, 1.04, grain);

    // Mouse fluid dye (screen-space; trail canvas is y-down so flip y).
    vec2 suv = gl_FragCoord.xy / uResolution;
    float dye = texture2D(uTrail, vec2(suv.x, 1.0 - suv.y)).r;
    float fluidEdges = smoothstep(0.0, 0.6, dye) * uFluidMagnitude;

    // Fresnel edge mask — iridescence lives on grazing rims.
    float fres = abs(dot(n, vec3(0.0, 0.0, 1.0)));
    float invF = 1.0 - pow(1.0 - fres, uFresnelSharpness);
    float mask = smoothstep(1.0, 0.1, mix(invF, 1.0, 1.0 - uFresnelOpacity));

    // Animated shimmer lines.
    vec2 uvLines = vUv + uTime * 0.01 * uLinesSpeed;
    uvLines.x = uvLines.x * 1000.0 / uLinesScale;
    uvLines.y = sin(uvLines.y * 50.0 * uLinesWaveLength) * 20.0 / uLinesScale;
    float lines = smoothstep(-1.0, 0.5, sin(uvLines.x + uvLines.y));
    lines = mix(1.0, lines, uLinesStrength);

    // Iridescent color from the surface normal.
    vec3 nv = n;
    nv.z *= uColorRange;
    nv = normalize(nv);
    vec3 nc = (nv + 1.0) * 0.5;
    nc = rgb2hsv(nc);
    nc.r = fract(nc.r + uHueShift);
    nc = hsv2rgb(nc);

    float amt = clamp(mask * fluidEdges * lines * uAmplitude, 0.0, 1.0);
    vec3 col = mix(base, nc, amt);

    gl_FragColor = vec4(col, 1.0);
  }
`

export default function HeroRelief() {
  const { scene } = useGLTF(PATH)
  const matcapTex = useMemo(() => makeMatcap(256), [])
  const plasterMap = useTexture('/hero/plaster.jpg')
  const root = useRef<THREE.Group>(null!)
  const { size, camera } = useThree()

  const trail = useMemo(() => makeTrail(), [])
  const pointer = useRef(new THREE.Vector2(0.5, 0.5))
  const head = useRef(new THREE.Vector2(0.5, 0.5))
  const prev = useRef(new THREE.Vector2(0.5, 0.5))
  const hasMoved = useRef(false)

  useMemo(() => {
    plasterMap.wrapS = plasterMap.wrapT = THREE.RepeatWrapping
    plasterMap.colorSpace = THREE.SRGBColorSpace
  }, [plasterMap])

  const uniforms = useMemo(
    () => ({
      uMatcap: { value: matcapTex },
      uTrail: { value: trail.tex },
      uPlaster: { value: plasterMap },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uAmplitude: { value: 0.55 },
      uHueShift: { value: 0.17 },
      uColorRange: { value: 4.0 },
      uFresnelSharpness: { value: 2.5 },
      uFresnelOpacity: { value: 1.0 },
      uLinesSpeed: { value: 2.0 },
      uLinesScale: { value: 2.63 },
      uLinesStrength: { value: 0.5 },
      uLinesWaveLength: { value: 0.2 },
      uFluidMagnitude: { value: 1.4 },
    }),
    [matcapTex, plasterMap, trail.tex],
  )

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms,
        side: THREE.DoubleSide,
      }),
    [uniforms],
  )

  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      if (obj.name.toLowerCase().includes('cube')) {
        obj.visible = false
        return
      }
      obj.material = material
      obj.frustumCulled = false
    })
    return clone
  }, [material, scene])

  useLayoutEffect(() => {
    const g = root.current
    if (!g) return

    const reset = (yaw: number) => {
      g.position.set(0, 0, 0)
      g.scale.set(1, 1, 1)
      g.rotation.set(0, yaw, 0)
      g.updateMatrixWorld(true)
    }

    let bestRot = 0
    let bestThickness = Infinity
    let bestFacing = -Infinity
    for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI] as const) {
      reset(yaw)
      const b = new THREE.Box3().setFromObject(g)
      const thickness = b.max.z - b.min.z
      let facing = 0
      let n = 0
      g.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || !obj.visible) return
        const attr = obj.geometry.getAttribute('normal')
        if (!attr) return
        const v = new THREE.Vector3()
        const step = Math.max(1, Math.floor(attr.count / 2500))
        for (let i = 0; i < attr.count; i += step) {
          v.fromBufferAttribute(attr, i).transformDirection(obj.matrixWorld)
          facing += v.z
          n++
        }
      })
      const avg = n ? facing / n : 0
      if (
        thickness < bestThickness * 0.95 ||
        (Math.abs(thickness - bestThickness) <= bestThickness * 0.05 && avg > bestFacing)
      ) {
        bestThickness = thickness
        bestFacing = avg
        bestRot = yaw
      }
    }
    void bestThickness

    reset(bestRot)
    let box = new THREE.Box3().setFromObject(g)
    const dim = box.getSize(new THREE.Vector3())

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 32
      camera.near = 0.05
      camera.far = 80
      camera.position.set(0, 0, 2.25)
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    }

    const dist = camera.position.z
    const vFov =
      camera instanceof THREE.PerspectiveCamera
        ? THREE.MathUtils.degToRad(camera.fov)
        : Math.PI / 4
    const visibleH = 2 * Math.tan(vFov / 2) * dist
    const visibleW = visibleH * (size.width / Math.max(size.height, 1))

    // Full-bleed wall — IG sculptures occupy the field, not a postage stamp.
    const s = Math.max(visibleW / Math.max(dim.x, 1e-6), visibleH / Math.max(dim.y, 1e-6)) * 1.45

    g.scale.setScalar(s)
    g.position.set(0, 0, 0)
    g.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(g)
    g.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-1))
    g.updateMatrixWorld(true)
  }, [camera, model, size.height, size.width])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      hasMoved.current = true
      pointer.current.set(e.clientX / window.innerWidth, e.clientY / window.innerHeight)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((state, dt) => {
    uniforms.uResolution.value.set(size.width * state.viewport.dpr, size.height * state.viewport.dpr)
    uniforms.uTime.value = state.clock.elapsedTime

    const { ctx, tex } = trail
    // Dissipating dye — soft wash across the wall.
    const keep = Math.pow(0.985, dt * 60)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(0,0,0,${1 - keep})`
    ctx.fillRect(0, 0, TRAIL, TRAIL)

    if (hasMoved.current) {
      const ease = 1 - Math.exp(-1.5 * dt)
      head.current.lerp(pointer.current, ease)
      const steps = Math.max(1, Math.ceil(head.current.distanceTo(prev.current) * TRAIL * 0.7))
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 1 : i / steps
        const x = THREE.MathUtils.lerp(prev.current.x, head.current.x, t) * TRAIL
        const y = THREE.MathUtils.lerp(prev.current.y, head.current.y, t) * TRAIL
        const r = TRAIL * 0.14
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, 'rgba(255,255,255,0.5)')
        g.addColorStop(0.35, 'rgba(255,255,255,0.2)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      prev.current.copy(head.current)
    }
    tex.needsUpdate = true
  })

  useEffect(
    () => () => {
      trail.tex.dispose()
      material.dispose()
    },
    [material, trail.tex],
  )

  return (
    <>
      <color attach="background" args={[WALL]} />
      <group ref={root}>
        <primitive object={model} />
      </group>
    </>
  )
}

useGLTF.preload(PATH)
