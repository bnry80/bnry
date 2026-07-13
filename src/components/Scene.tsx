import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import HeroRelief from '../three/HeroRelief'

/**
 * Full-viewport WebGL layer that sits behind the editorial UI.
 * An orthographic camera keeps the relief flat and pixel-stable.
 */
export default function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 1], zoom: 1 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <Suspense fallback={null}>
          <HeroRelief />
        </Suspense>
      </Canvas>
    </div>
  )
}
