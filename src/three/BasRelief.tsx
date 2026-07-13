import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeWordmarkHeightmap } from './heightmap'

/* -------------------------------------------------------------------------
   Bas-relief shader
   The image/heightmap's brightness is read as surface height. We reconstruct
   a surface normal from the local brightness gradient, then light it with a
   single point light that follows the cursor — producing the "carved into a
   surface, lit from a moving source" look (à la immersive-g.com).
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

  uniform sampler2D uTexture;
  uniform vec2  uResolution;   // canvas pixel size
  uniform float uTexel;        // 1.0 / heightmap resolution
  uniform vec2  uLight;        // light position, 0..1 screen space (y up)
  uniform float uLightZ;       // light height above the plate
  uniform float uDepth;        // relief strength (normal exaggeration)
  uniform float uHeightScale;  // physical rise of the surface
  uniform float uShine;        // specular exponent
  uniform float uSpec;         // specular strength
  uniform float uTime;
  uniform vec3  uLit;          // lit color
  uniform vec3  uShadow;       // shadow color
  uniform vec3  uGround;       // recessed ground tint

  float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

  float getH(vec2 uv){
    return luma(texture2D(uTexture, uv).rgb);
  }

  // cheap hash for film grain
  float hash(vec2 p){
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main(){
    float aspect = uResolution.x / uResolution.y;

    // Aspect-corrected space: square heightmap centered, no distortion.
    vec2 p = vUv - 0.5;
    p.x *= aspect;
    vec2 huv = p + 0.5;

    float h  = getH(huv);
    float hx = getH(huv + vec2(uTexel, 0.0)) - getH(huv - vec2(uTexel, 0.0));
    float hy = getH(huv + vec2(0.0, uTexel)) - getH(huv - vec2(0.0, uTexel));

    // Surface normal from the height gradient.
    vec3 n = normalize(vec3(-hx * uDepth, -hy * uDepth, 1.0));

    // Point light following the cursor, in the same aspect-corrected space.
    vec2 lp = uLight - 0.5;
    lp.x *= aspect;
    vec3 lightPos = vec3(lp, uLightZ);
    vec3 fragPos  = vec3(p, h * uHeightScale);
    vec3 L = normalize(lightPos - fragPos);

    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 Hh = normalize(L + V);

    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(n, Hh), 0.0), uShine) * uSpec;
    float amb  = 0.14;

    // Distance falloff so the light feels local, like a lamp over a plate.
    float dist = length(lightPos - fragPos);
    float atten = 1.0 / (1.0 + 1.1 * dist * dist);

    float lit = amb + (diff * 0.95 + spec) * (0.55 + 0.9 * atten);

    // Recessed ground stays darker; raised type catches the light.
    vec3 base = mix(uGround, uShadow, smoothstep(0.02, 0.10, h));
    vec3 col  = mix(base, uLit, clamp(lit, 0.0, 1.0));

    // Fine grain for a plaster/stone surface.
    float g = hash(vUv * uResolution + uTime) - 0.5;
    col += g * 0.028;

    // Gentle vignette to seat the plate in the page.
    float vig = smoothstep(1.15, 0.35, length(vUv - 0.5));
    col *= mix(0.82, 1.0, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`

export default function BasRelief() {
  const matRef = useRef<THREE.ShaderMaterial>(null!)
  const { viewport, size } = useThree()

  // Smoothed light position + a slow idle orbit when the cursor is still.
  const light = useRef(new THREE.Vector2(0.5, 0.55))
  const target = useRef(new THREE.Vector2(0.5, 0.55))
  const lastMove = useRef(0)

  const texture = useMemo(() => makeWordmarkHeightmap(2048), [])

  const uniforms = useMemo(
    () => ({
      uTexture: { value: texture },
      uResolution: { value: new THREE.Vector2(size.width, size.height) },
      uTexel: { value: 1 / 2048 },
      uLight: { value: new THREE.Vector2(0.5, 0.55) },
      uLightZ: { value: 0.5 },
      uDepth: { value: 3.2 },
      uHeightScale: { value: 0.12 },
      uShine: { value: 22.0 },
      uSpec: { value: 0.38 },
      uTime: { value: 0 },
      uLit: { value: new THREE.Color('#dfe3cf') },
      uShadow: { value: new THREE.Color('#79826b') },
      uGround: { value: new THREE.Color('#2f3427') },
    }),
    [texture, size.width, size.height],
  )

  // Track the pointer in 0..1 screen space (y up).
  useMemo(() => {
    const onMove = (e: PointerEvent) => {
      target.current.set(e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight)
      lastMove.current = performance.now()
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const idle = (performance.now() - lastMove.current) > 1600

    if (idle) {
      // Slow orbit around center while the cursor rests.
      target.current.set(0.5 + Math.cos(t * 0.5) * 0.22, 0.55 + Math.sin(t * 0.5) * 0.16)
    }

    light.current.lerp(target.current, 0.06)

    const u = matRef.current.uniforms
    u.uLight.value.copy(light.current)
    u.uResolution.value.set(size.width, size.height)
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
