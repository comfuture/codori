import {
  parseImmersiveWorkspaceRoute
} from '@codori/client/shared/workspace'
import type { RealtimeConversationSnapshot } from '@codori/client/shared/realtime'
import {
  detectImmersiveCapability,
  requestImmersiveSession
} from './xr-capability'
import type { ImmersiveScene } from './immersive-scene'
import {
  resolveImmersiveVoiceActivity,
  VoiceRuntime
} from './voice-runtime'
import { WorkspaceRuntime } from './workspace-runtime'
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

const route = parseImmersiveWorkspaceRoute(window.location.href)
const returnTo = route?.returnTo ?? '/'
continueLink.href = returnTo
const searchParams = new URLSearchParams(window.location.search)
const developmentDebug = import.meta.env.DEV
  && searchParams.get('debug') === '1'
const developmentKitchenSink = developmentDebug
  && searchParams.get('kitchenSink') === '1'

const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
reducedEffects.checked = reducedMotionQuery.matches

let immersiveScene: ImmersiveScene | null = null
let immersiveScenePromise: Promise<ImmersiveScene> | null = null
let workspaceRuntime: WorkspaceRuntime | null = null
let voiceRuntime: VoiceRuntime | null = null
let activeSession: XRSession | null = null
let releaseSessionListeners: (() => void) | null = null
let releaseWorkspace: (() => void) | null = null
let releaseVoice: (() => void) | null = null
let startingRuntime: Promise<void> | null = null
let returningTo2d = false
let voiceRequested = false
let lastWorkspaceError: string | null = null

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
          onPanelScroll: (panelId, deltaLines) => {
            workspaceRuntime?.scrollPanel(panelId, deltaLines)
          },
          onPanelInteracted: (panelId) => {
            workspaceRuntime?.touchPanel(panelId)
          },
          onPanelMoved: (panelId) => {
            workspaceRuntime?.markPanelMoved(panelId)
          },
          onPanelFocused: (panelId) => {
            workspaceRuntime?.focusPanel(panelId)
          },
          onPanelDismiss: (panelId) => {
            workspaceRuntime?.dismissPanel(panelId)
          }
        })
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
    })
    await runtime.start()

    const voice = new VoiceRuntime({
      client: runtime.client,
      threadId: route.identity.threadId
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
    await voiceRuntime.toggle()
  } catch (error) {
    setSceneStatus(
      error instanceof Error ? error.message : String(error),
      true
    )
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

const enterImmersive = async () => {
  enterButton.disabled = true
  retryButton.hidden = true
  setEntryMessage('Requesting an immersive session…')
  try {
    const session = await requestImmersiveSession({
      secureContext: window.isSecureContext,
      xr: navigator.xr
    })
    activeSession = session
    bindSessionListeners(session)
    showScene()
    const scene = await ensureScene()
    await scene.setSession(session)
    await startWorkspaceRuntime()
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
    scene.setStatus(
      'Kitchen sink · non-immersive texture and layout preview'
    )
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
    enterButton.hidden = false
    enterButton.textContent = 'Enter immersive Codori'
    enterButton.onclick = () => {
      void enterImmersive()
    }
    entryActions.hidden = false
    setEntryMessage(
      'Your browser reports immersive VR support. Entry and microphone access remain explicit actions.'
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
