import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, type WebGLRenderer, type XRTargetRaySpace } from 'three'
import { ImmersiveInteractionSystem } from '../src/interaction-system'

afterEach(() => { vi.restoreAllMocks() })

const setup = () => {
  let now = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const controllers = [new Group(), new Group()] as XRTargetRaySpace[]
  const hands = [new Group(), new Group()].map(group => Object.assign(group, {
    joints: { 'thumb-tip': new Group(), 'index-finger-tip': new Group() }
  }))
  const root = new Group()
  const camera = new PerspectiveCamera()
  const activate = vi.fn()
  const controlAction = vi.fn()
  let questionVisible = true
  const hit = new Mesh(new BoxGeometry(1, 1, 0.02), new MeshBasicMaterial())
  hit.position.z = -1
  hit.userData.asyncQuestionActivate = activate
  root.add(hit)
  const underlying = new Mesh(new BoxGeometry(1, 1, 0.02), new MeshBasicMaterial())
  underlying.position.z = -1.2
  underlying.userData.action = 'toggle-voice'
  root.add(underlying)
  const interaction = new ImmersiveInteractionSystem({
    renderer: { xr: {
      getController: (index: number) => controllers[index],
      getControllerGrip: () => new Group(),
      getHand: (index: number) => hands[index],
      getCamera: () => camera
    } } as unknown as WebGLRenderer,
    root, getPanels: () => new Map(), getControlTargets: () => [underlying],
    getAsyncQuestionTargets: () => questionVisible ? [hit] : [],
    getStatusTargets: () => [], getStatusMenuTarget: () => null,
    isStatusOpen: () => false, getStatusInvocation: () => null,
    onScroll: vi.fn(), onPanelInteracted: vi.fn(), onPanelMoved: vi.fn(),
    onPanelFocused: vi.fn(), onPanelDismiss: vi.fn(), onAction: controlAction,
    onStatusToggle: vi.fn(), onStatusDismiss: vi.fn(), onStatusAction: vi.fn(),
    onInputCapabilitiesChanged: vi.fn()
  })
  const source = {
    hand: {}, handedness: 'right', profiles: [], targetRayMode: 'tracked-pointer'
  } as unknown as XRInputSource
  controllers[0]!.dispatchEvent({ type: 'connected', data: source })
  const frame = (pinching: boolean) => {
    hands[0]!.joints['index-finger-tip'].position.x = pinching ? 0.01 : 0.1
    hands[0]!.joints['index-finger-tip'].updateMatrixWorld()
    root.updateMatrixWorld(true)
    interaction.update(now, 0.016)
  }
  frame(false)
  return {
    activate, frame, controlAction,
    hideQuestion: () => { questionVisible = false },
    advance: (milliseconds: number) => { now += milliseconds },
    select: (type: 'selectstart' | 'selectend') => controllers[0]!.dispatchEvent({ type, data: source }),
    dispose: () => {
      interaction.dispose()
      for (const mesh of [hit, underlying]) { mesh.geometry.dispose(); mesh.material.dispose() }
    }
  }
}

describe('immersive question selection', () => {
  it.each(['native-first', 'pinch-first'] as const)('sends once when a %s pinch also emits native selection', order => {
    const { activate, frame, select, advance, dispose } = setup()
    if (order === 'native-first') {
      select('selectstart')
      frame(true)
    } else {
      frame(true)
      select('selectstart')
    }
    expect(activate).toHaveBeenCalledTimes(1)
    // Successful option submission may replace the target before both release
    // paths arrive; holding the same pinch must never answer the next question.
    advance(400)
    select('selectend')
    frame(true)
    select('selectstart')
    expect(activate).toHaveBeenCalledTimes(1)
    select('selectend')
    frame(false)
    advance(400)
    select('selectstart')
    expect(activate).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('does not click through to an underlying control when the final answer removes the panel', () => {
    const { activate, frame, select, advance, hideQuestion, controlAction, dispose } = setup()
    frame(true)
    expect(activate).toHaveBeenCalledTimes(1)
    hideQuestion()
    select('selectstart')
    expect(controlAction).not.toHaveBeenCalled()
    select('selectend')
    frame(false)
    advance(100)
    select('selectstart')
    expect(controlAction).not.toHaveBeenCalled()
    select('selectend')
    advance(400)
    select('selectstart')
    expect(controlAction).toHaveBeenCalledWith('toggle-voice')
    dispose()
  })
})
