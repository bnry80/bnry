import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import HeroRelief from '../three/HeroRelief'

/**
 * Full-viewport WebGL layer behind the editorial UI.
 * Perspective camera so the cursor light can graze real relief depth.
 */
export default function Scene() {
  return (
    <div className="scene" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 2.2], fov: 32, near: 0.05, far: 50 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <HeroRelief />
        </Suspense>
      </Canvas>
    </div>
  )
}
