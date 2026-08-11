import {
  parseImmersiveWorkspaceRoute
} from '@codori/client/shared/workspace'
import type { RealtimeConversationSnapshot } from '@codori/client/shared/realtime'
import {
  detectImmersiveCapability,
  requestImmersiveSession,
  resolvePassthroughAvailability,
  type ImmersiveModeSupport,
  type ImmersiveSessionMode
} from './xr-capability'
import type { ImmersiveScene } from './immersive-scene'
import {
  resolveImmersiveVoiceActivity,
  VoiceRuntime
} from './voice-runtime'
import { coordinateRealtimeAutoStart } from './realtime-auto-start'
import { ImmersiveSoundEffects } from './sound-effects'
import {
  WorkspaceRuntime,
  type WorkspaceRuntimeSnapshot
} from './workspace-runtime'
import {
  createStatusActions,
  type StatusActionId
} from './status-window-model'
import './style.css'

const requiredElement = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing immersive UI element #${id}.`)
  }
  return element as T
}

const entryCard = document.querySelector<HTMLElement>('.entry-card')
if (!entryCard) {
  throw new Error('Missing immersive entry card.')
}
const entryMessage = requiredElement<HTMLParagraphElement>('entry-message')
const entryActions = requiredElement<HTMLDivElement>('entry-actions')
const enterButton = requiredElement<HTMLButtonElement>('enter-xr')
const continueLink = requiredElement<HTMLAnchorElement>('continue-2d')
const retryButton = requiredElement<HTMLButtonElement>('retry-entry')
const reducedEffects = requiredElement<HTMLInputElement>('reduced-effects')
const canvas = requiredElement<HTMLCanvasElement>('xr-canvas')
const sceneStatus = requiredElement<HTMLDivElement>('scene-status')
const sceneControls = requiredElement<HTMLDivElement>('scene-controls')
const exitButton = requiredElement<HTMLButtonElement>('exit-xr')
const fallbackMenu = requiredElement<HTMLButtonElement>('fallback-menu')
const domOverlayRoot = requiredElement<HTMLElement>('app')

const route = parseImmersiveWorkspaceRoute(window.location.href)
const returnTo = route?.returnTo ?? '/'
continueLink.href = returnTo
const searchParams = new URLSearchParams(window.location.search)
const developmentDebug = import.meta.env.DEV
  && searchParams.get('debug') === '1'
const developmentKitchenSink = developmentDebug
  && searchParams.get('kitchenSink') === '1'
const developmentBlendPreview = developmentKitchenSink
  && (
    searchParams.get('blend') === 'alpha-blend'
    || searchParams.get('blend') === 'additive'
  )
  ? searchParams.get('blend') as 'alpha-blend' | 'additive'
  : null
const developmentStatusPreview = searchParams.get('status') !== '0'
const developmentBackground = (() => {
  const background = searchParams.get('background')
  return background === 'bright' || background === 'dark'
    ? background
    : 'textured'
})()
const developmentPaneState = (() => {
  const state = searchParams.get('paneState')
  return state === 'idle' || state === 'hover' || state === 'grab'
    ? state
    : 'active'
})()
const developmentPaneId = searchParams.get('paneId') || 'kitchen-command'
const developmentHandControls = searchParams.get('handControls') !== '0'
const soundEffects = new ImmersiveSoundEffects()
window.addEventListener('pagehide', () => {
  void soundEffects.dispose()
}, { once: true })

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
reducedEffects.checked = reducedMotionQuery.matches

let immersiveScene: ImmersiveScene | null = null
let immersiveScenePromise: Promise<ImmersiveScene> | null = null
let workspaceRuntime: WorkspaceRuntime | null = null
let voiceRuntime: VoiceRuntime | null = null
let activeSession: XRSession | null = null
let activeSessionMode: ImmersiveSessionMode = 'immersive-vr'
let supportedModes: ImmersiveModeSupport = { vr: false, ar: false }
let defaultEntryMode: ImmersiveSessionMode = 'immersive-vr'
let transitionTarget: ImmersiveSessionMode | null = null
let releaseSessionListeners: (() => void) | null = null
let releaseWorkspace: (() => void) | null = null
let releaseVoice: (() => void) | null = null
let startingRuntime: Promise<void> | null = null
let returningTo2d = false
let voiceRequested = false
let lastWorkspaceError: string | null = null
let latestWorkspace: WorkspaceRuntimeSnapshot | null = null
let latestVoice: RealtimeConversationSnapshot | null = null

const disposeConnectedRuntimes = async () => {
  releaseWorkspace?.()
  releaseWorkspace = null
  releaseVoice?.()
  releaseVoice = null
  const voice = voiceRuntime
  const workspace = workspaceRuntime
  voiceRuntime = null
  workspaceRuntime = null
  await Promise.allSettled([
    voice?.dispose(),
    workspace?.dispose()
  ].filter((task): task is Promise<void> => Boolean(task)))
}

const sessionActive = (snapshot: RealtimeConversationSnapshot) =>
  snapshot.state === 'requesting-permission'
  || snapshot.state === 'creating-offer'
  || snapshot.state === 'starting'
  || snapshot.state === 'connected'
  || snapshot.state === 'stopping'

const statusVoiceState = () => {
  if (!latestVoice) {
    return 'unavailable' as const
  }
  if (latestVoice.autoplayBlocked) {
    return 'resume-audio' as const
  }
  return sessionActive(latestVoice) ? 'active' as const : 'inactive' as const
}

const updateStatusWindow = () => {
  if (!immersiveScene || !latestWorkspace) {
    return
  }
  const blendMode = activeSession?.environmentBlendMode ?? 'opaque'
  const passthrough = resolvePassthroughAvailability({
    arSupported: supportedModes.ar,
    vrSupported: supportedModes.vr,
    mode: activeSessionMode,
    environmentBlendMode: blendMode
  })
  immersiveScene.setStatusWindowSnapshot({
    rateLimits: latestWorkspace.rateLimits,
    context: latestWorkspace.context,
    connection: latestWorkspace.connection,
    voice: statusVoiceState(),
    activePaneCount: latestWorkspace.panels.length,
    threadLabel: latestWorkspace.thread?.preview
      || latestWorkspace.thread?.id
      || null,
    workspaceLabel: route
      ? `${route.identity.workspace.kind}:${route.identity.workspace.id}`
      : null,
    sessionLabel: `${activeSessionMode} · ${blendMode}`,
    actions: createStatusActions({
      passthroughSupported: passthrough.supported,
      passthroughActive: passthrough.active,
      passthroughDisabledReason: passthrough.disabledReason,
      voiceState: statusVoiceState(),
      reducedEffects: reducedEffects.checked
    })
  })
}

const setEntryMessage = (message: string) => {
  entryMessage.textContent = message
}

const setSceneStatus = (message: string, error = false) => {
  sceneStatus.textContent = message
  sceneStatus.hidden = !message
  immersiveScene?.setStatus(message, error)
}

const showScene = () => {
  entryCard.hidden = true
  canvas.hidden = false
  sceneControls.hidden = false
  sceneStatus.hidden = true
}

const showEntry = () => {
  entryCard.hidden = false
  canvas.hidden = true
  sceneControls.hidden = true
  sceneStatus.hidden = true
}

const updateVoiceUi = (snapshot: RealtimeConversationSnapshot) => {
  latestVoice = snapshot
  updateStatusWindow()
  immersiveScene?.setTranscript(snapshot.transcripts, snapshot.generation)
  immersiveScene?.setActivity(
    snapshot.state === 'error'
      ? 'error'
      : resolveImmersiveVoiceActivity(snapshot)
  )

  if (snapshot.autoplayBlocked) {
    setSceneStatus(
      'Voice audio is blocked by autoplay policy. Select Resume audio.',
      true
    )
    return
  }
  if (snapshot.error) {
    setSceneStatus(snapshot.error, true)
    return
  }
  if (
    voiceRequested
    && snapshot.capability.status !== 'available'
    && snapshot.capability.status !== 'checking'
  ) {
    setSceneStatus(snapshot.capability.message, true)
    return
  }
  setSceneStatus(lastWorkspaceError ?? '')
}

const ensureScene = async () => {
  if (immersiveScene) {
    return immersiveScene
  }
  if (!immersiveScenePromise) {
    immersiveScenePromise = import('./immersive-scene')
      .then(({ ImmersiveScene: Scene }) => {
        immersiveScene = new Scene({
          canvas,
          reducedEffects: () => reducedEffects.checked,
          onAction: (action) => {
            if (action === 'toggle-voice') {
              void toggleVoice()
            } else {
              void exitImmersive()
            }
          },
          onPanelScroll: (panelId, deltaLines, maximumStart) => {
            workspaceRuntime?.scrollPanel(panelId, deltaLines, maximumStart)
          },
          onPanelInteracted: (panelId) => {
            workspaceRuntime?.touchPanel(panelId)
          },
          onPanelMoved: (panelId, position) => {
            workspaceRuntime?.markPanelMoved(panelId, position)
          },
          onPanelFocused: (panelId, position) => {
            workspaceRuntime?.focusPanel(panelId, position)
          },
          onPanelDismiss: (panelId) => {
            workspaceRuntime?.dismissPanel(panelId)
          },
          onPanelAppeared: (panelCount) => {
            soundEffects.playPanelAppear(panelCount)
          },
          onStatusAction: (action) => {
            void handleStatusAction(action)
          },
          onStatusOpened: () => {
            soundEffects.playStatusOpen()
          },
          onStatusClosed: () => {
            soundEffects.playStatusClose()
          },
          onStatusFallbackChanged: (visible) => {
            fallbackMenu.hidden = !(
              visible
              && activeSession
              && activeSession.domOverlayState
            )
          }
        })
        updateStatusWindow()
        return immersiveScene
      })
  }
  return await immersiveScenePromise
}

const startWorkspaceRuntime = async () => {
  if (startingRuntime) {
    return await startingRuntime
  }
  if (!route) {
    throw new Error(
      'Immersive Codori requires a materialized project or chat thread. Return to 2D and open a thread first.'
    )
  }
  startingRuntime = (async () => {
    const runtime = new WorkspaceRuntime({
      identity: route.identity,
      wsBase: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`,
      httpBase: window.location.origin
    })
    workspaceRuntime = runtime
    releaseWorkspace = runtime.subscribe((snapshot) => {
      latestWorkspace = snapshot
      lastWorkspaceError = snapshot.error
      immersiveScene?.setPanels(snapshot.panels)
      if (!voiceRuntime || !sessionActive(voiceRuntime.getSnapshot())) {
        immersiveScene?.setActivity(snapshot.activity)
        immersiveScene?.setTranscript(
          snapshot.transcripts,
          snapshot.generation
        )
      }
      if (snapshot.error) {
        setSceneStatus(snapshot.error, true)
      }
      updateStatusWindow()
    })
    await runtime.start()

    const voice = new VoiceRuntime({
      client: runtime.client,
      threadId: route.identity.threadId,
      cwd: runtime.snapshot().thread?.cwd ?? null
    })
    voiceRuntime = voice
    releaseVoice = voice.subscribe(updateVoiceUi)
  })().catch(async (error) => {
    startingRuntime = null
    await disposeConnectedRuntimes()
    throw error
  })
  return await startingRuntime
}

const toggleVoice = async () => {
  if (!voiceRuntime) {
    setSceneStatus('The workspace is still connecting.', true)
    return
  }
  voiceRequested = true
  try {
    const snapshot = voiceRuntime.getSnapshot()
    if (snapshot.autoplayBlocked) {
      await voiceRuntime.toggle()
      return
    }
    if (sessionActive(snapshot)) {
      await voiceRuntime.stop()
      immersiveScene?.prepareAgentAwakening()
      return
    }
    await soundEffects.unlock()
    immersiveScene?.prepareAgentAwakening()
    immersiveScene?.awakenAgent()
    soundEffects.playAwakening()
    await voiceRuntime.start()
  } catch (error) {
    setSceneStatus(
      error instanceof Error ? error.message : String(error),
      true
    )
  }
}

const transitionSessionMode = async (mode: ImmersiveSessionMode) => {
  const previous = activeSession
  if (!previous || transitionTarget) {
    return
  }
  if (mode === 'immersive-ar' && !supportedModes.ar) {
    setSceneStatus('This device does not report immersive AR support.', true)
    return
  }
  if (mode === 'immersive-vr' && !supportedModes.vr) {
    setSceneStatus('This device does not report immersive VR support.', true)
    return
  }
  transitionTarget = mode
  let replacement: XRSession | null = null
  try {
    await previous.end()
  } catch (error) {
    transitionTarget = null
    setSceneStatus(
      `Could not end the current XR session for transition: ${
        error instanceof Error ? error.message : String(error)
      }`,
      true
    )
    return
  }
  try {
    replacement = await requestImmersiveSession({
      secureContext: window.isSecureContext,
      xr: navigator.xr
    }, mode, domOverlayRoot)
    activeSession = replacement
    activeSessionMode = mode
    bindSessionListeners(replacement)
    const scene = await ensureScene()
    await scene.setSession(replacement, mode)
    workspaceRuntime?.setSuspended(false)
    showScene()
    updateStatusWindow()
  } catch (error) {
    if (replacement) {
      releaseSessionListeners?.()
      releaseSessionListeners = null
      if (activeSession === replacement) {
        activeSession = null
      }
      await immersiveScene?.setSession(null).catch(() => {})
      await replacement.end().catch(() => {})
    }
    workspaceRuntime?.setSuspended(true)
    showEntry()
    entryActions.hidden = false
    enterButton.hidden = false
    retryButton.hidden = true
    enterButton.textContent = mode === 'immersive-ar'
      ? 'Re-enter passthrough'
      : 'Re-enter immersive VR'
    enterButton.onclick = () => {
      void enterImmersive(mode)
    }
    setEntryMessage(
      `The browser could not switch XR sessions in-place. Your Codori workspace and voice session are preserved; use the explicit re-entry action. ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  } finally {
    transitionTarget = null
  }
}

const handleStatusAction = async (action: StatusActionId) => {
  switch (action) {
    case 'passthrough':
      await transitionSessionMode(
        activeSessionMode === 'immersive-ar'
          ? 'immersive-vr'
          : 'immersive-ar'
      )
      break
    case 'recenter':
      immersiveScene?.recenterWorkspace()
      break
    case 'voice':
      await toggleVoice()
      break
    case 'reduced-effects':
      reducedEffects.checked = !reducedEffects.checked
      updateStatusWindow()
      break
    case 'exit':
      await exitImmersive()
      break
  }
}

const returnTo2d = () => {
  if (returningTo2d) {
    return
  }
  returningTo2d = true
  window.location.assign(returnTo)
}

const handleSessionEnded = () => {
  releaseSessionListeners?.()
  releaseSessionListeners = null
  activeSession = null
  fallbackMenu.hidden = true
  if (transitionTarget) {
    return
  }
  workspaceRuntime?.setSuspended(true)
  returnTo2d()
}

const bindSessionListeners = (session: XRSession) => {
  releaseSessionListeners?.()
  const handleEnd = () => {
    handleSessionEnded()
  }
  const handleVisibility = () => {
    workspaceRuntime?.setSuspended(
      document.hidden || session.visibilityState === 'hidden'
    )
  }
  session.addEventListener('end', handleEnd)
  session.addEventListener('visibilitychange', handleVisibility)
  let released = false
  releaseSessionListeners = () => {
    if (released) {
      return
    }
    released = true
    session.removeEventListener('end', handleEnd)
    session.removeEventListener('visibilitychange', handleVisibility)
  }
}

const exitImmersive = async () => {
  if (activeSession) {
    await activeSession.end()
    return
  }
  returnTo2d()
}

const enterImmersive = async (
  mode: ImmersiveSessionMode = defaultEntryMode
) => {
  enterButton.disabled = true
  retryButton.hidden = true
  setEntryMessage('Requesting an immersive session…')
  try {
    const soundUnlock = soundEffects.unlock()
    const session = await requestImmersiveSession({
      secureContext: window.isSecureContext,
      xr: navigator.xr
    }, mode, domOverlayRoot)
    await soundUnlock
    activeSession = session
    activeSessionMode = mode
    bindSessionListeners(session)
    showScene()
    const scene = await ensureScene()
    await scene.setSession(session, mode)
    if (workspaceRuntime && voiceRuntime) {
      workspaceRuntime.setSuspended(false)
      updateStatusWindow()
      return
    }
    await coordinateRealtimeAutoStart({
      prepare: startWorkspaceRuntime,
      isCurrent: () => activeSession === session,
      beforeStart: () => {
        scene.awakenAgent()
        soundEffects.playAwakening()
      },
      start: async () => {
        if (!voiceRuntime) {
          throw new Error('The voice runtime did not initialize.')
        }
        voiceRequested = true
        await voiceRuntime.start()
      },
      onStartError: (error) => {
        setSceneStatus(
          error instanceof Error ? error.message : String(error),
          true
        )
      }
    })
  } catch (error) {
    const failedSession = activeSession
    releaseSessionListeners?.()
    releaseSessionListeners = null
    activeSession = null
    if (failedSession) {
      try {
        await failedSession.end()
      } catch {
        // Preserve the original entry failure below.
      }
    }
    showEntry()
    entryActions.hidden = false
    retryButton.hidden = false
    setEntryMessage(
      `Could not enter immersive Codori: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  } finally {
    enterButton.disabled = false
  }
}

const enterDebugScene = async () => {
  showScene()
  const scene = await ensureScene()
  if (developmentKitchenSink) {
    const { createDevelopmentKitchenSink } = await import(
      './development-kitchen-sink'
    )
    const fixture = createDevelopmentKitchenSink(performance.now())
    scene.setActivity('speaking')
    scene.setTranscript(fixture.transcripts, fixture.generation)
    scene.setPanels(fixture.panels)
    scene.setPanelInteractionPreview(developmentPaneId, developmentPaneState)
    scene.setPanelHandControlsPreview(developmentHandControls)
    scene.setHandOutlinePreview(true)
    scene.setStatus(
      'Kitchen sink · non-immersive texture and layout preview'
    )
    scene.setStatusWindowSnapshot({
      rateLimits: [{
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 34,
          resetsAt: '2026-08-11T15:00:00+09:00',
          windowDurationMins: 300
        },
        secondary: {
          usedPercent: 61,
          resetsAt: '2026-08-18T09:00:00+09:00',
          windowDurationMins: 10_080
        }
      }],
      context: {
        contextWindow: 258_400,
        usedTokens: 81_400,
        remainingTokens: 177_000,
        usedPercent: 31.5,
        remainingPercent: 68.5
      },
      connection: 'connected',
      voice: 'active',
      activePaneCount: fixture.panels.length,
      threadLabel: 'Issue #143 kitchen sink',
      workspaceLabel: 'project:codori',
      sessionLabel: developmentBlendPreview
        ? `immersive-ar · ${developmentBlendPreview}`
        : 'preview · opaque',
      actions: createStatusActions({
        passthroughSupported: false,
        passthroughActive: false,
        passthroughDisabledReason: 'Preview is not an immersive AR session.',
        voiceState: 'active',
        reducedEffects: reducedEffects.checked
      })
    })
    if (developmentStatusPreview) {
      scene.openStatusForPreview()
    }
    if (developmentBlendPreview) {
      const surrogateBackgrounds = {
        bright: 'linear-gradient(135deg, #fffef4, #c7e7f3)',
        dark: 'linear-gradient(135deg, #05070b, #142331)',
        textured: [
          'repeating-linear-gradient(35deg, rgba(255,255,255,0.18) 0 8px, rgba(14,32,40,0.08) 8px 17px)',
          'linear-gradient(135deg, #eadfbc, #527b8c)'
        ].join(',')
      }
      canvas.style.background = surrogateBackgrounds[developmentBackground]
      scene.setSessionVisualMode('immersive-ar', developmentBlendPreview)
    }
    return
  }
  scene.setStatus(
    'Non-immersive development preview. This is not an active WebXR session.'
  )
  try {
    await startWorkspaceRuntime()
  } catch (error) {
    setSceneStatus(
      error instanceof Error ? error.message : String(error),
      true
    )
  }
}

const checkCapability = async () => {
  if (!route) {
    entryActions.hidden = false
    enterButton.hidden = true
    retryButton.hidden = true
    setEntryMessage(
      'Immersive Codori requires a materialized thread. Continue in 2D, open a project or chat thread, then use its immersive action.'
    )
    return
  }

  if (developmentDebug) {
    entryActions.hidden = false
    enterButton.hidden = false
    enterButton.textContent = developmentKitchenSink
      ? 'Open kitchen sink preview'
      : 'Open non-immersive preview'
    enterButton.onclick = () => {
      void enterDebugScene()
    }
    setEntryMessage(developmentKitchenSink
      ? 'Kitchen sink preview renders representative XR text surfaces without claiming an immersive session.'
      : 'Development preview mode renders the spatial scene without claiming an immersive session.')
    return
  }

  setEntryMessage('Checking this browser for immersive WebXR support…')
  entryActions.hidden = true
  retryButton.hidden = true
  const capability = await detectImmersiveCapability({
    secureContext: window.isSecureContext,
    xr: navigator.xr
  })
  if (capability.status === 'available') {
    supportedModes = capability.modes
    defaultEntryMode = capability.entryMode
    enterButton.hidden = false
    enterButton.textContent = capability.entryMode === 'immersive-ar'
      ? 'Enter immersive AR Codori'
      : 'Enter immersive Codori'
    enterButton.onclick = () => {
      void enterImmersive(capability.entryMode)
    }
    entryActions.hidden = false
    setEntryMessage(
      capability.entryMode === 'immersive-ar'
        ? 'Your browser reports immersive AR support. Transparent pixels will reveal the environment only when the session blend mode permits it.'
        : 'Your browser reports immersive VR support. Entry and microphone access remain explicit actions.'
    )
    return
  }

  if (capability.status === 'unsupported') {
    window.location.replace(returnTo)
    return
  }

  entryActions.hidden = false
  enterButton.hidden = true
  retryButton.hidden = false
  setEntryMessage(capability.message)
}

enterButton.addEventListener('click', () => {
  if (enterButton.onclick === null) {
    void enterImmersive()
  }
})
retryButton.addEventListener('click', () => {
  void checkCapability()
})
exitButton.addEventListener('click', () => {
  void exitImmersive()
})
fallbackMenu.addEventListener('click', () => {
  immersiveScene?.toggleStatusFromFallback()
})
reducedEffects.addEventListener('change', updateStatusWindow)
window.addEventListener('resize', () => {
  immersiveScene?.resize()
})
document.addEventListener('visibilitychange', () => {
  workspaceRuntime?.setSuspended(
    document.hidden || activeSession?.visibilityState === 'hidden'
  )
})
window.addEventListener('pagehide', () => {
  returningTo2d = true
  const session = activeSession
  releaseSessionListeners?.()
  releaseSessionListeners = null
  activeSession = null
  if (session) {
    void session.end().catch(() => {})
  }
  immersiveScene?.dispose()
  immersiveScene = null
  immersiveScenePromise = null
  void disposeConnectedRuntimes()
}, { once: true })

showEntry()
void checkCapability()
