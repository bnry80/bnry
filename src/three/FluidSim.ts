import * as THREE from 'three'

/**
 * Compact stable-fluids GPU simulation (Navier–Stokes: splat → vorticity →
 * pressure projection → advection), the same construction Immersive Garden
 * runs for their hover reveal (their bundle ships advect/divergence/pressure/
 * curl/vorticity/splat passes). The mouse splats velocity + dye; the dye
 * field is the reveal mask — it flows, swirls and dissipates with momentum
 * instead of stamping fading circles.
 *
 * Based on the classic Pavel Dobryakov WebGL-Fluid-Simulation (MIT).
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const SPLAT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform float uAspect;
  uniform vec2 uPoint;
  uniform vec3 uColor;
  uniform float uRadius;
  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    vec3 splat = exp(-dot(p, p) / uRadius) * uColor;
    vec3 base = texture2D(uTarget, vUv).xyz;
    gl_FragColor = vec4(base + splat, 1.0);
  }
`

const ADVECTION_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uSource;
  uniform vec2 uTexelSize;
  uniform float uDt;
  uniform float uDissipation;
  void main() {
    vec2 coord = vUv - uDt * texture2D(uVelocity, vUv).xy * uTexelSize;
    vec4 result = texture2D(uSource, coord);
    float decay = 1.0 + uDissipation * uDt;
    gl_FragColor = result / decay;
  }
`

const DIVERGENCE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
    float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
    float div = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`

const CURL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
    float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
    float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
    float vorticity = R - L - T + B;
    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
  }
`

const VORTICITY_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexelSize;
  uniform float uCurlStrength;
  uniform float uDt;
  void main() {
    float L = texture2D(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture2D(uCurl, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture2D(uCurl, vUv + vec2(0.0, uTexelSize.y)).x;
    float C = texture2D(uCurl, vUv).x;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= uCurlStrength * C;
    force.y *= -1.0;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * uDt;
    velocity = clamp(velocity, vec2(-1000.0), vec2(1000.0));
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`

const PRESSURE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (L + R + B + T - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`

const GRADIENT_SUBTRACT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexelSize;
  void main() {
    float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
    float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
    float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
    float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity -= vec2(R - L, T - B);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`

const CLEAR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uValue;
  void main() {
    gl_FragColor = uValue * texture2D(uTexture, vUv);
  }
`

type DoubleFBO = {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget
  swap: () => void
}

function createFBO(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  })
}

function createDoubleFBO(w: number, h: number): DoubleFBO {
  const fbo = { read: createFBO(w, h), write: createFBO(w, h) }
  return {
    ...fbo,
    swap() {
      const t = this.read
      this.read = this.write
      this.write = t
    },
  }
}

export type FluidConfig = {
  simRes: number
  dyeRes: number
  densityDissipation: number
  velocityDissipation: number
  pressure: number
  pressureIterations: number
  curl: number
  splatRadius: number
  splatForce: number
}

export const DEFAULT_FLUID: FluidConfig = {
  simRes: 128,
  dyeRes: 512,
  densityDissipation: 0.4, // long linger — the path stays revealed ~5s+, settling slowly
  velocityDissipation: 2.2, // currents die fast — soft bloom, no sloshing
  pressure: 0.8,
  pressureIterations: 20,
  curl: 2, // barely-there swirl; the reference is calm, not turbulent
  splatRadius: 0.006, // modest brush — the reference reveals a bit at a time
  splatForce: 1200, // gentle spread — a breath, not a jet
}

export class FluidSim {
  readonly config: FluidConfig
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>

  private velocity: DoubleFBO
  private dye: DoubleFBO
  private pressureFBO: DoubleFBO
  private divergenceFBO: THREE.WebGLRenderTarget
  private curlFBO: THREE.WebGLRenderTarget

  private splatMat: THREE.ShaderMaterial
  private advectionMat: THREE.ShaderMaterial
  private divergenceMat: THREE.ShaderMaterial
  private curlMat: THREE.ShaderMaterial
  private vorticityMat: THREE.ShaderMaterial
  private pressureMat: THREE.ShaderMaterial
  private gradientMat: THREE.ShaderMaterial
  private clearMat: THREE.ShaderMaterial

  constructor(renderer: THREE.WebGLRenderer, config: Partial<FluidConfig> = {}) {
    this.renderer = renderer
    this.config = { ...DEFAULT_FLUID, ...config }
    const { simRes, dyeRes } = this.config

    this.velocity = createDoubleFBO(simRes, simRes)
    this.dye = createDoubleFBO(dyeRes, dyeRes)
    this.pressureFBO = createDoubleFBO(simRes, simRes)
    this.divergenceFBO = createFBO(simRes, simRes)
    this.curlFBO = createFBO(simRes, simRes)

    const mat = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: frag,
        uniforms,
        depthTest: false,
        depthWrite: false,
      })

    const simTexel = new THREE.Vector2(1 / simRes, 1 / simRes)

    this.splatMat = mat(SPLAT_FRAG, {
      uTarget: { value: null },
      uAspect: { value: 1 },
      uPoint: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Vector3() },
      uRadius: { value: this.config.splatRadius },
    })
    this.advectionMat = mat(ADVECTION_FRAG, {
      uVelocity: { value: null },
      uSource: { value: null },
      uTexelSize: { value: simTexel.clone() },
      uDt: { value: 0 },
      uDissipation: { value: 0 },
    })
    this.divergenceMat = mat(DIVERGENCE_FRAG, {
      uVelocity: { value: null },
      uTexelSize: { value: simTexel.clone() },
    })
    this.curlMat = mat(CURL_FRAG, {
      uVelocity: { value: null },
      uTexelSize: { value: simTexel.clone() },
    })
    this.vorticityMat = mat(VORTICITY_FRAG, {
      uVelocity: { value: null },
      uCurl: { value: null },
      uTexelSize: { value: simTexel.clone() },
      uCurlStrength: { value: this.config.curl },
      uDt: { value: 0 },
    })
    this.pressureMat = mat(PRESSURE_FRAG, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexelSize: { value: simTexel.clone() },
    })
    this.gradientMat = mat(GRADIENT_SUBTRACT_FRAG, {
      uPressure: { value: null },
      uVelocity: { value: null },
      uTexelSize: { value: simTexel.clone() },
    })
    this.clearMat = mat(CLEAR_FRAG, {
      uTexture: { value: null },
      uValue: { value: this.config.pressure },
    })

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.splatMat)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /** The dye field — use as the reveal mask texture. */
  get texture(): THREE.Texture {
    return this.dye.read.texture
  }

  private blit(target: THREE.WebGLRenderTarget, material: THREE.ShaderMaterial) {
    this.mesh.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  /**
   * @param point  pointer in uv space (y up)
   * @param delta  pointer movement since last frame, uv space
   * @param aspect screen aspect (w/h) so splats stay circular
   */
  splat(point: THREE.Vector2, delta: THREE.Vector2, aspect: number) {
    const u = this.splatMat.uniforms
    u.uAspect.value = aspect
    u.uPoint.value.copy(point)

    // velocity impulse in the stroke direction
    u.uTarget.value = this.velocity.read.texture
    u.uColor.value.set(delta.x * this.config.splatForce, delta.y * this.config.splatForce, 0)
    u.uRadius.value = this.config.splatRadius
    this.blit(this.velocity.write, this.splatMat)
    this.velocity.swap()

    // Low per-splat dye: height BUILDS over successive frames of contact,
    // so the relief visibly rises out of the wall rather than snapping up.
    const amount = Math.min(0.4, Math.max(0.09, delta.length() * 10))
    u.uTarget.value = this.dye.read.texture
    u.uColor.value.set(amount, amount, amount)
    this.blit(this.dye.write, this.splatMat)
    this.dye.swap()
  }

  step(dt: number) {
    const clamped = Math.min(dt, 1 / 30)
    const simTexel = this.advectionMat.uniforms.uTexelSize.value as THREE.Vector2

    // vorticity confinement (organic swirl)
    this.curlMat.uniforms.uVelocity.value = this.velocity.read.texture
    this.blit(this.curlFBO, this.curlMat)

    this.vorticityMat.uniforms.uVelocity.value = this.velocity.read.texture
    this.vorticityMat.uniforms.uCurl.value = this.curlFBO.texture
    this.vorticityMat.uniforms.uDt.value = clamped
    this.blit(this.velocity.write, this.vorticityMat)
    this.velocity.swap()

    // pressure projection (keeps the flow incompressible => fluid look)
    this.divergenceMat.uniforms.uVelocity.value = this.velocity.read.texture
    this.blit(this.divergenceFBO, this.divergenceMat)

    this.clearMat.uniforms.uTexture.value = this.pressureFBO.read.texture
    this.clearMat.uniforms.uValue.value = this.config.pressure
    this.blit(this.pressureFBO.write, this.clearMat)
    this.pressureFBO.swap()

    for (let i = 0; i < this.config.pressureIterations; i++) {
      this.pressureMat.uniforms.uPressure.value = this.pressureFBO.read.texture
      this.pressureMat.uniforms.uDivergence.value = this.divergenceFBO.texture
      this.blit(this.pressureFBO.write, this.pressureMat)
      this.pressureFBO.swap()
    }

    this.gradientMat.uniforms.uPressure.value = this.pressureFBO.read.texture
    this.gradientMat.uniforms.uVelocity.value = this.velocity.read.texture
    this.blit(this.velocity.write, this.gradientMat)
    this.velocity.swap()

    // advect velocity through itself, then the dye through the velocity
    const adv = this.advectionMat.uniforms
    adv.uDt.value = clamped
    adv.uTexelSize.value = simTexel

    adv.uVelocity.value = this.velocity.read.texture
    adv.uSource.value = this.velocity.read.texture
    adv.uDissipation.value = this.config.velocityDissipation
    this.blit(this.velocity.write, this.advectionMat)
    this.velocity.swap()

    adv.uVelocity.value = this.velocity.read.texture
    adv.uSource.value = this.dye.read.texture
    adv.uDissipation.value = this.config.densityDissipation
    this.blit(this.dye.write, this.advectionMat)
    this.dye.swap()

    this.renderer.setRenderTarget(null)
  }

  dispose() {
    for (const t of [
      this.velocity.read,
      this.velocity.write,
      this.dye.read,
      this.dye.write,
      this.pressureFBO.read,
      this.pressureFBO.write,
      this.divergenceFBO,
      this.curlFBO,
    ]) {
      t.dispose()
    }
    for (const m of [
      this.splatMat,
      this.advectionMat,
      this.divergenceMat,
      this.curlMat,
      this.vorticityMat,
      this.pressureMat,
      this.gradientMat,
      this.clearMat,
    ]) {
      m.dispose()
    }
    this.mesh.geometry.dispose()
  }
}
