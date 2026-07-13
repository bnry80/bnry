import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/* -------------------------------------------------------------------------
   Hero relief — flat-image treatment of the baked 3D render.

   The lighting in the source render is already baked, so this pass adds the
   *interactive* layer over it: a cursor-tracked chromatic aberration, a soft
   depth parallax, and a local "reveal" that lifts contrast/sheen around the
   pointer. For TRUE cursor relighting (highlights that slide across the
   surface, à la immersive-g), swap in a baked normal + depth map — see
   HeroReliefLit (todo) — this component is the JPG-only path.
   ------------------------------------------------------------------------- */

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uTex;
  uniform vec2  uResolution;   // canvas pixels
  uniform float uImageAspect;  // width / height of the source image
  uniform vec2  uLight;        // cursor, 0..1, y up
  uniform float uRadius;       // lens radius (aspect-corrected screen units)
  uniform float uSoft;         // 0..1 soft edge as fraction of radius
  uniform float uMagnify;      // lens magnification (refraction feel)
  uniform float uCA;           // chromatic aberration (radial, small)
  uniform float uGamma;        // tone: darken the blown-out plaster
  uniform float uGhost;        // faint relief embossed before reveal (0..1)
  uniform float uReveal;       // global reveal amount (intro / pointer present)
  uniform vec3  uBase;         // hidden paper color
  uniform float uTime;

  // "cover" fit: fill the viewport, cropping the overflowing axis.
  vec2 coverUv(vec2 uv, float A, float imgA){
    vec2 s = A > imgA ? vec2(1.0, imgA / A) : vec2(A / imgA, 1.0);
    return (uv - 0.5) * s + 0.5;
  }

  void main(){
    float A = uResolution.x / uResolution.y;

    // Lens distance in aspect-corrected screen space (true circle).
    vec2 sp = vec2(vUv.x * A, vUv.y);
    vec2 sc = vec2(uLight.x * A, uLight.y);
    float t = distance(sp, sc) / uRadius;     // 0 at cursor, 1 at rim

    float mask = (1.0 - smoothstep(1.0 - uSoft, 1.0, t)) * uReveal;

    // Sample positions in image space.
    vec2 uvImg = coverUv(vUv, A, uImageAspect);
    vec2 cImg  = coverUv(uLight, A, uImageAspect);

    // Magnifying refraction: zoom toward the cursor, strongest at the centre
    // and easing to none at the rim => a domed-glass feel, no streaking.
    float dome = 1.0 - smoothstep(0.0, 1.0, t);          // 1 centre -> 0 rim
    vec2 samplePos = cImg + (uvImg - cImg) * (1.0 - uMagnify * dome * uReveal);

    // Subtle radial chromatic aberration — a few pixels, growing to the rim.
    vec2 caOff = (uvImg - cImg) * uCA * mask;
    float r = texture2D(uTex, samplePos + caOff).r;
    float g = texture2D(uTex, samplePos).g;
    float b = texture2D(uTex, samplePos - caOff).b;
    vec3 relief = pow(clamp(vec3(r, g, b), 0.0, 1.0), vec3(uGamma));

    // Hidden state: paper with an optional whisper of the relief.
    vec3 ghost = pow(clamp(texture2D(uTex, uvImg).rgb, 0.0, 1.0), vec3(uGamma));
    vec3 hidden = mix(uBase, ghost, uGhost);

    vec3 col = mix(hidden, relief, mask);
    gl_FragColor = vec4(col, 1.0);
  }
`

export default function HeroRelief() {
  const matRef = useRef<THREE.ShaderMaterial>(null!)
  const { viewport, size } = useThree()

  const light = useRef(new THREE.Vector2(0.5, 0.5))
  const targetRef = useRef(new THREE.Vector2(0.5, 0.5))
  const lastMove = useRef(0)

  // Plain loader — no Suspense / drei hook needed for a single image, and it
  // sidesteps the React 19 StrictMode "invalid hook call" from useTexture.
  const texture = useMemo(() => {
    const t = new THREE.TextureLoader().load('/hero/relief-base.jpg', (tex) => {
      matRef.current.uniforms.uImageAspect.value = tex.image.width / tex.image.height
    })
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  const revealAmt = useRef(0)

  const uniforms = useMemo(
    () => ({
      uTex: { value: texture },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uImageAspect: { value: 3000 / 2000 },
      uLight: { value: new THREE.Vector2(0.5, 0.5) },
      uRadius: { value: 0.24 }, // lens size (screen aspect units)
      uSoft: { value: 0.4 }, // soft edge as fraction of radius
      uMagnify: { value: 0.18 }, // lens magnification (refraction feel)
      uCA: { value: 0.006 }, // radial chromatic aberration (a few px)
      uGamma: { value: 1.45 }, // darken blown-out plaster toward gray
      uGhost: { value: 0.04 }, // faint relief embossed before reveal
      uReveal: { value: 0 }, // eased in on first pointer move
      uBase: { value: new THREE.Color('#fcfcfc') },
      uTime: { value: 0 },
    }),
    [texture, size.width, size.height],
  )

  useMemo(() => {
    const onMove = (e: PointerEvent) => {
      targetRef.current.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight)
      lastMove.current = performance.now()
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const hasMoved = lastMove.current > 0

    // Lens simply follows the cursor (smoothed). Hidden until the first move.
    light.current.lerp(targetRef.current, 0.14)
    const wantReveal = hasMoved ? 1 : 0
    revealAmt.current += (wantReveal - revealAmt.current) * 0.08

    const u = matRef.current.uniforms
    u.uLight.value.copy(light.current)
    u.uResolution.value.set(size.width, size.height)
    u.uReveal.value = revealAmt.current
    u.uTime.value = t
  })

  return (
    <mesh scale={[viewport.width, viewport.height, 1]}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
      />
    </mesh>
  )
}
