import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { FluidSim } from './FluidSim'

/* -------------------------------------------------------------------------
   Immersive Garden-style home relief:

   • Blank matte plaster wall by default — the 3D GLB relief is hidden
   • The mouse splats velocity + dye into a REAL fluid simulation (FluidSim);
     the dye field is the reveal mask, so the reveal flows, swirls and keeps
     momentum after the cursor passes instead of stamping fading circles
   • Where revealed, the mesh grows out of the page (vertex displacement)
     with matcap shading and a whisper of chromatic aberration on the edge
   ------------------------------------------------------------------------- */

const PATH = '/hero/relief.glb'
const WALL = '#ececea'

// Matte plaster matcap: high-key, low-contrast, soft top-light. Deliberately
// NO specular hotspot and NO dark rim — that contrast is what read as glossy
// silver. This gives soft clay/porcelain diffuse shading instead.
function makeMatcap(size = 256) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!

  // Soft diffuse: gently brighter up top, slightly cooler-dim at the bottom.
  const lin = ctx.createLinearGradient(0, 0, 0, size)
  lin.addColorStop(0.0, '#fcfcfb')
  lin.addColorStop(0.55, '#f0f0ee')
  lin.addColorStop(1.0, '#e2e2df')
  ctx.fillStyle = lin
  ctx.fillRect(0, 0, size, size)

  // Very broad, faint fill light (no tight hotspot => matte, not shiny).
  const fill = ctx.createRadialGradient(
    size * 0.44, size * 0.36, 0,
    size * 0.5, size * 0.5, size * 0.75,
  )
  fill.addColorStop(0.0, 'rgba(255,255,255,0.28)')
  fill.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, size, size)

  // Gentle soft-AO only right at the silhouette — keeps it light, not metallic.
  const rim = ctx.createRadialGradient(
    size * 0.5, size * 0.5, size * 0.38,
    size * 0.5, size * 0.5, size * 0.5,
  )
  rim.addColorStop(0.0, 'rgba(60,58,54,0)')
  rim.addColorStop(1.0, 'rgba(60,58,54,0.14)')
  ctx.fillStyle = rim
  ctx.fillRect(0, 0, size, size)

  // Faint grain so it reads as chalk, not plastic.
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 3
    img.data[i] += n
    img.data[i + 1] += n
    img.data[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const vertex = /* glsl */ `
  uniform sampler2D uTrail;
  uniform float uGrow;
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec4 vMvPosition;
  varying float vGrow;
  void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Sample the fluid dye at this vertex's projected screen position.
    vec4 clip = projectionMatrix * mv;
    vec2 screenUv = clip.xy / clip.w * 0.5 + 0.5;
    float dye = texture2D(uTrail, screenUv).r;
    float grow = smoothstep(0.0, 0.5, dye);
    vGrow = grow;

    // Recede into the page when hidden; sit at full depth where revealed, so
    // the 3D relief grows OUT of the flat wall as the cursor passes.
    mv.z -= uGrow * (1.0 - grow);

    vMvPosition = mv;
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
  uniform vec3  uWall;
  uniform float uCA;

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
    vec2 matcapUv = getMatcapUv(vMvPosition, n);

    // Fluid dye => reveal mask (screen space; GL render target is y-up).
    vec2 suv = gl_FragCoord.xy / uResolution;
    float dye = texture2D(uTrail, suv).r;
    float mask = smoothstep(0.03, 0.55, dye);

    // Subtle chromatic aberration at the fresh reveal boundary (green/magenta).
    float edge = clamp(mask * (1.0 - mask) * 4.0, 0.0, 1.0);
    vec2 caDir = normalize(vec2(dFdx(dye), dFdy(dye)) + 1e-6);
    vec2 caOff = caDir * edge * uCA;
    float rr = texture2D(uMatcap, matcapUv + caOff).r;
    float gg = texture2D(uMatcap, matcapUv).g;
    float bb = texture2D(uMatcap, matcapUv - caOff).b;
    vec3 relief = vec3(rr, gg, bb);

    // Hidden state: blank plaster wall with faint paper grain.
    float grain = texture2D(uPlaster, vUv * 3.0).r;
    vec3 wall = uWall * mix(0.975, 1.025, grain);

    // The sculpted relief is revealed only along the mouse trail.
    vec3 col = mix(wall, relief, mask);
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function HeroRelief() {
  const { scene } = useGLTF(PATH)
  const matcapTex = useMemo(() => makeMatcap(256), [])
  const plasterMap = useTexture('/hero/plaster.jpg')
  const root = useRef<THREE.Group>(null!)
  const { size, camera, gl } = useThree()

  // Real fluid simulation — the dye field drives the reveal.
  const sim = useMemo(() => new FluidSim(gl), [gl])
  const pointer = useRef(new THREE.Vector2(0.5, 0.5))
  const prev = useRef(new THREE.Vector2(0.5, 0.5))
  const delta = useRef(new THREE.Vector2())
  const hasMoved = useRef(false)

  useMemo(() => {
    plasterMap.wrapS = plasterMap.wrapT = THREE.RepeatWrapping
    plasterMap.colorSpace = THREE.SRGBColorSpace
  }, [plasterMap])

  const uniforms = useMemo(
    () => ({
      uMatcap: { value: matcapTex },
      uTrail: { value: sim.texture },
      uPlaster: { value: plasterMap },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uWall: { value: new THREE.Color(WALL) },
      uCA: { value: 0.012 },
      uGrow: { value: 0.3 },
    }),
    [matcapTex, plasterMap, sim],
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
      // uv space, y up — matches the sim's render-target orientation.
      const next = new THREE.Vector2(
        e.clientX / window.innerWidth,
        1 - e.clientY / window.innerHeight,
      )
      if (!hasMoved.current) prev.current.copy(next)
      hasMoved.current = true
      pointer.current.copy(next)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((state, dt) => {
    uniforms.uResolution.value.set(size.width * state.viewport.dpr, size.height * state.viewport.dpr)
    uniforms.uTime.value = state.clock.elapsedTime

    // Splat this frame's stroke into the fluid, then integrate the sim.
    delta.current.subVectors(pointer.current, prev.current)
    if (hasMoved.current && delta.current.lengthSq() > 1e-9) {
      sim.splat(pointer.current, delta.current, size.width / Math.max(size.height, 1))
    }
    prev.current.copy(pointer.current)
    sim.step(dt)
    uniforms.uTrail.value = sim.texture
  })

  useEffect(
    () => () => {
      sim.dispose()
      material.dispose()
    },
    [material, sim],
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
