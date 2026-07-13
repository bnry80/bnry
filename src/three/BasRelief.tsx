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
  uniform float uReveal;       // cursor reveal radius (aspect space)
  uniform float uChroma;       // iridescent edge dispersion
  uniform float uAmbient;      // base fill light (airy plaster => high)
  uniform float uTime;
  uniform vec3  uLit;          // highlight color
  uniform vec3  uShadow;       // recess / mid color
  uniform vec3  uGround;       // paper base color

  float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
  float getH(vec2 uv){ return luma(texture2D(uTexture, uv).rgb); }

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main(){
    float aspect = uResolution.x / uResolution.y;

    // Aspect-corrected space: square heightmap centered, no distortion.
    vec2 p = vUv - 0.5;
    p.x *= aspect;
    vec2 huv = p + 0.5;

    // Cursor position + soft reveal falloff (1 near the pointer).
    vec2 lp = uLight - 0.5;
    lp.x *= aspect;
    float dCursor = distance(p, lp);
    float reveal = smoothstep(uReveal, 0.0, dCursor);

    // Relief is always present but deepens / catches light near the cursor.
    float depth = uDepth * (0.6 + 0.7 * reveal);

    float h  = getH(huv);
    float hx = getH(huv + vec2(uTexel, 0.0)) - getH(huv - vec2(uTexel, 0.0));
    float hy = getH(huv + vec2(0.0, uTexel)) - getH(huv - vec2(0.0, uTexel));

    vec3 n = normalize(vec3(-hx * depth, -hy * depth, 1.0));
    float slope = clamp(length(vec2(hx, hy)) * depth * 2.5, 0.0, 1.0);

    // Soft plaster lighting.
    vec3 lightPos = vec3(lp, uLightZ);
    vec3 fragPos  = vec3(p, h * uHeightScale);
    vec3 L = normalize(lightPos - fragPos);
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 Hh = normalize(L + V);

    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(n, Hh), 0.0), uShine) * uSpec * (0.55 + 0.9 * reveal);

    // Self-occlusion: recesses fall into soft shadow => sculptural read.
    float ao = mix(0.68, 1.0, smoothstep(0.0, 0.16, h));

    float light = (uAmbient + diff * 0.55) * ao + spec;

    // Paper base with a faint two-scale fiber texture.
    float paper = (vnoise(vUv * vec2(aspect, 1.0) * 520.0) - 0.5) * 0.05
                + (vnoise(vUv * 120.0) - 0.5) * 0.04;

    vec3 base = mix(uGround, uShadow, smoothstep(0.02, 0.55, h));
    vec3 col  = mix(base, uLit, clamp(light, 0.0, 1.0));
    col += paper;

    // Faint iridescent chromatic fringe on the raised edges (à la immersive-g).
    float fres = pow(1.0 - n.z, 1.5);
    vec3 iris = 0.5 + 0.5 * cos(6.2831 * (fres * 1.2 + vec3(0.0, 0.33, 0.67)));
    col = mix(col, col + (iris - 0.5), clamp(slope * fres * uChroma, 0.0, 1.0));

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
      uLightZ: { value: 0.45 },
      uDepth: { value: 4.2 },
      uHeightScale: { value: 0.1 },
      uShine: { value: 26.0 },
      uSpec: { value: 0.55 },
      uReveal: { value: 0.7 },
      uChroma: { value: 0.2 },
      uAmbient: { value: 0.64 },
      uTime: { value: 0 },
      uLit: { value: new THREE.Color('#f7f8f1') },
      uShadow: { value: new THREE.Color('#c7ccb8') },
      uGround: { value: new THREE.Color('#e7e8de') },
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
