import type { TranscriptBubbleSegment } from './transcript-bubble-model'
import {
  TEXT_TEXTURE_ANISOTROPY,
  XR_FOVEATION,
  XR_FRAMEBUFFER_SCALE_FACTOR
} from './config'
import type {
  SpatialPanelInput,
  SpatialPanelSnapshot
} from './panel-model'

const panel = (
  input: SpatialPanelInput,
  slot: number,
  now: number
): SpatialPanelSnapshot => ({
  ...input,
  retainedText: input.text,
  truncated: false,
  phase: input.background || input.status === 'in-progress'
    ? 'visible'
    : 'dwelling',
  phaseStartedAt: now,
  scrollOffset: input.id === 'kitchen-command' ? 8 : Number.POSITIVE_INFINITY,
  autoFollow: input.id !== 'kitchen-command',
  userMoved: false,
  position: null,
  slot,
  fileTransitionStartedAt: now - 1_000
})

export const createDevelopmentKitchenSink = (now: number) => {
  const panels: SpatialPanelSnapshot[] = [
    panel({
      id: 'kitchen-command',
      kind: 'command',
      title: 'Command · pnpm test',
      status: 'in-progress',
      text: [
        '\u001B[36mRUN\u001B[0m packages/webxr',
        '✓ transcript visibility',
        '✓ spatial panel lifecycle',
        '⠼ rendering high-density text surfaces…',
        ...Array.from(
          { length: 24 },
          (_, index) => `overflow ${String(index + 1).padStart(2, '0')} · deterministic wrapped-line viewport fixture`
        )
      ].join('\n'),
      cwd: '/Users/comfuture/Project/codori',
      background: false
    }, 0, now),
    panel({
      id: 'kitchen-shell',
      kind: 'command',
      title: 'Shell · git status',
      status: 'completed',
      text: [
        'On branch feat/issue-103-immersive-webxr',
        'Your branch is up to date with origin.',
        '',
        'nothing to commit, working tree clean'
      ].join('\n'),
      cwd: '/Users/comfuture/Project/codori',
      exitCode: 0,
      background: false
    }, 1, now),
    panel({
      id: 'kitchen-file-update',
      sourceId: 'kitchen-file-update-source',
      kind: 'file-change',
      title: 'Edit · text-surface.ts',
      status: 'completed',
      text: '',
      background: false,
      fileChange: {
        sourceId: 'kitchen-file-update-source',
        path: 'packages/webxr/src/text-surface.ts',
        kind: 'update',
        diff: [
          '@@ -270,4 +270,5 @@',
          ' const bodyFontSize = 27',
          '-context.lineWidth = 4',
          '+context.lineWidth = 6',
          "+context.imageSmoothingQuality = 'high'"
        ].join('\n')
      }
    }, 2, now),
    panel({
      id: 'kitchen-mcp',
      kind: 'mcp-tool',
      title: 'Tool · inspect XR layer',
      status: 'in-progress',
      text: [
        `framebuffer scale: ${XR_FRAMEBUFFER_SCALE_FACTOR.toFixed(2)}`,
        `fixed foveation: ${XR_FOVEATION.toFixed(2)}`,
        `text anisotropy: ${TEXT_TEXTURE_ANISOTROPY}x`,
        'projection layer: active',
        'viewport: waiting for immersive session'
      ].join('\n'),
      background: false
    }, 3, now),
    panel({
      id: 'kitchen-dynamic',
      kind: 'dynamic-tool',
      title: 'Approval · deploy preview',
      status: 'requires-action',
      text: [
        'Review the generated XR bundle.',
        '한국어와 English glyphs를 함께 확인하세요.',
        '0123456789  !@#$%^&*()  →  ≤  ≥'
      ].join('\n'),
      background: false
    }, 4, now),
    panel({
      id: 'kitchen-search',
      kind: 'web-search',
      title: 'Web · WebXR rendering quality',
      status: 'completed',
      text: [
        'Three.js XRManager',
        'setFoveation(0): full peripheral resolution',
        'setFramebufferScaleFactor(): session-start only'
      ].join('\n'),
      background: false
    }, 5, now),
    panel({
      id: 'kitchen-terminal',
      kind: 'background-terminal',
      title: 'Terminal · dev server',
      status: 'in-progress',
      text: [
        '\u001B[32mVITE\u001B[0m ready in 312 ms',
        'Local: http://127.0.0.1:5174/xr/',
        'press h + enter to show help',
        '',
        '19:42:08 page reload src/main.ts'
      ].join('\n'),
      cwd: '/Users/comfuture/Project/codori/packages/webxr',
      background: true
    }, 6, now),
    panel({
      id: 'kitchen-file-create',
      sourceId: 'kitchen-file-create-source',
      kind: 'file-change',
      title: 'Create · quality-profile.ts',
      status: 'completed',
      text: '',
      background: false,
      fileChange: {
        sourceId: 'kitchen-file-create-source',
        path: 'packages/webxr/src/quality-profile.ts',
        kind: 'add',
        diff: [
          '@@ -0,0 +1,5 @@',
          '+export const immersiveQuality = {',
          `+  foveation: ${XR_FOVEATION},`,
          `+  framebufferScale: ${XR_FRAMEBUFFER_SCALE_FACTOR},`,
          '+  textPixelRatio: 1.333',
          '+}'
        ].join('\n')
      }
    }, 7, now)
  ]

  const transcripts: TranscriptBubbleSegment[] = [{
    id: 1,
    generation: 1,
    role: 'assistant',
    text: '해상도 검사용 말풍선입니다. Korean, English, 숫자 0123456789와 얇은 획을 함께 확인하세요.',
    final: false
  }]

  return {
    panels,
    transcripts,
    generation: 1
  }
}
