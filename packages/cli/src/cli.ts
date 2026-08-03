#!/usr/bin/env node
import { formatCliError, runCli } from '@codori/server'

/**
 * Thin launcher for the globally installed `codori` binary.
 *
 * All command parsing, behavior, and output live in `@codori/server` so the
 * installed binary and `npx @codori/server` cannot drift apart. This file only
 * owns process-level concerns: invoking the CLI and mapping a failure onto a
 * readable stderr line plus a nonzero exit code.
 */
void runCli().catch((error: unknown) => {
  process.stderr.write(formatCliError(error))
  process.exitCode = 1
})
