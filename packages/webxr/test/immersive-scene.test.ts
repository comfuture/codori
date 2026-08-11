import { describe, expect, it } from 'vitest'
import {
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry
} from 'three'
import {
  configureRoomSurfaceRendering,
  ROOM_FLOOR_RENDER_ORDER,
  ROOM_GRID_RENDER_ORDER,
  ROOM_WALL_RENDER_ORDER
} from '../src/immersive-scene'

describe('immersive room rendering', () => {
  it('renders floor surfaces before panes without writing occluding depth', () => {
    const floorMaterial = new MeshBasicMaterial()
    const floor = new Mesh(new PlaneGeometry(20, 20), floorMaterial)
    const grid = new GridHelper(20, 20)
    const wallMaterial = new MeshBasicMaterial()
    const wall = new Mesh(new PlaneGeometry(20, 3.6), wallMaterial)

    configureRoomSurfaceRendering(floor, grid, [wall])

    expect(floorMaterial.depthWrite).toBe(false)
    for (const material of Array.isArray(grid.material)
      ? grid.material
      : [grid.material]) {
      expect(material.depthWrite).toBe(false)
    }
    expect(floor.renderOrder).toBe(ROOM_FLOOR_RENDER_ORDER)
    expect(grid.renderOrder).toBe(ROOM_GRID_RENDER_ORDER)
    expect(wallMaterial.depthWrite).toBe(false)
    expect(wall.renderOrder).toBe(ROOM_WALL_RENDER_ORDER)
    expect(floor.renderOrder).toBeLessThan(0)
    expect(grid.renderOrder).toBeLessThan(0)
    expect(wall.renderOrder).toBeLessThan(0)

    floor.geometry.dispose()
    floorMaterial.dispose()
    wall.geometry.dispose()
    wallMaterial.dispose()
    grid.geometry.dispose()
    for (const material of Array.isArray(grid.material)
      ? grid.material
      : [grid.material]) {
      material.dispose()
    }
  })
})
