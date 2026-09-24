import { isCliBrandOnly, stripCliPrefix, type CliIdentity } from './osc-title'
import { looksLikePathTitle } from '../shared/types'
import type { PanePatch, PaneState } from '../shared/types'

/** Apply a pane patch without allowing an automatic title source to unlock a manual title. */
export function updatePaneTitle(pane: PaneState, patch: PanePatch, engineName: string): PaneState {
  const engine = patch.engine !== undefined ? patch.engine : pane.engine
  const titleLocked = patch.titleLocked !== undefined ? patch.titleLocked : pane.titleLocked
  let title = pane.title

  if (patch.title !== undefined) {
    // A title patch without an explicit lock/unlock is an automatic source
    // (for example the phone picker). It must not replace a user's title.
    if (!pane.titleLocked || patch.titleLocked !== undefined) title = patch.title
  } else if (patch.engine !== undefined && !pane.titleLocked) {
    title = engineName
  }

  return {
    ...pane,
    engine,
    model: patch.model !== undefined ? patch.model : pane.model,
    title,
    titleLocked
  }
}

/** Adopt a CLI-generated title only while the pane is in automatic-title mode. */
export function adoptAutoTitle(pane: PaneState, title: string, cli: CliIdentity, engineName: string): PaneState {
  if (pane.titleLocked || !pane.engine) return pane
  const nextTitle = stripCliPrefix(title, cli).trim()

  if (isCliBrandOnly(title, cli)) {
    return pane.title === engineName ? pane : { ...pane, title: engineName }
  }
  if (!nextTitle || looksLikePathTitle(nextTitle) || nextTitle === pane.title) return pane
  return { ...pane, title: nextTitle }
}
