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
  uniform float uRadius;       // reveal radius (aspect-corrected screen units)
  uniform float uSoft;         // 0..1 edge softness fraction
  uniform float uCA;           // chromatic aberration at the reveal edge
  uniform float uGhost;        // how much relief shows before reveal (0..1)
  uniform float uReveal;       // global reveal amount (intro / pointer present)
  uniform vec3  uBase;         // hidden paper color
  uniform float uTime;

  // "cover" fit: fill the viewport, cropping the overflowing axis.
  vec2 coverUv(vec2 uv, float screenAspect, float imgAspect){
    vec2 s = screenAspect > imgAspect
      ? vec2(1.0, imgAspect / screenAspect)
      : vec2(screenAspect / imgAspect, 1.0);
    return (uv - 0.5) * s + 0.5;
  }

  void main(){
    float A = uResolution.x / uResolution.y;
    vec2 uv = coverUv(vUv, A, uImageAspect);

    // Soft circular mask that follows the cursor (measured in aspect space so
    // the reveal is a true circle, not an ellipse).
    vec2 p = vec2(vUv.x * A, vUv.y);
    vec2 c = vec2(uLight.x * A, uLight.y);
    float dist = distance(p, c);
    float mask = 1.0 - smoothstep(uRadius * (1.0 - uSoft), uRadius, dist);
    mask *= uReveal;

    // Chromatic aberration across the WHOLE revealed area (dispersion grows
    // from the cursor outward toward the mask edge), as in the reference.
    float radial = clamp(dist / uRadius, 0.0, 1.0); // 0 center -> 1 edge
    vec2 dir = normalize(uv - uLight + 1e-5);
    vec2 off = dir * uCA * radial * mask;
    float r = texture2D(uTex, uv + off).r;
    float g = texture2D(uTex, uv).g;
    float b = texture2D(uTex, uv - off).b;
    vec3 relief = vec3(r, g, b);

    // Hidden state: paper with a whisper of the relief embossed into it.
    vec3 hidden = mix(uBase, relief, uGhost);

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
      uRadius: { value: 0.28 }, // reveal circle size (screen aspect units)
      uSoft: { value: 0.5 }, // soft edge as fraction of radius
      uCA: { value: 0.03 }, // chromatic dispersion inside the reveal
      uGhost: { value: 0.06 }, // faint relief embossed before reveal
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
    const idle = performance.now() - lastMove.current > 2400

    // Before the first move (or when idle) let the reveal drift gently so the
    // page is alive; snap to the cursor as soon as it moves.
    if (!hasMoved || idle) {
      targetRef.current.set(0.5 + Math.cos(t * 0.3) * 0.16, 0.5 + Math.sin(t * 0.3) * 0.1)
    }
    light.current.lerp(targetRef.current, 0.09)

    // Ease the global reveal in once things are ready.
    revealAmt.current += (1 - revealAmt.current) * 0.03

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
