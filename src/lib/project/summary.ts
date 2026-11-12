import { totalDuration } from '../timeline/timeline'
import { NO_TRANSITION, type ProjectRecord, type Transition } from './types'

/** Abspielbare, fertig verarbeitete Clips eines gespeicherten Projekts. */
export function playableRecords(p: ProjectRecord): ProjectRecord['clips'] {
  return p.clips.filter((c) => c.playable && c.duration > 0)
}

/**
 * Länge des fertigen Videos wie im Schnitt (store.totalDuration): Übergang gilt
 * jeweils nach dem vorderen Clip, nicht abspielbare Clips werden übersprungen.
 */
export function projectDuration(p: ProjectRecord): number {
  const play = playableRecords(p)
  const transitions: Transition[] = []
  for (let i = 0; i < play.length - 1; i++) {
    transitions.push(p.transitions[p.clips.indexOf(play[i]!)] ?? { ...NO_TRANSITION })
  }
  return totalDuration(play, transitions)
}

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** Anzeigename: eigener Name oder Erstellungsdatum („12. Nov., 14:32“). */
export function projectTitle(p: Pick<ProjectRecord, 'name' | 'createdAt' | 'updatedAt'>): string {
  if (p.name) return p.name
  const t = p.createdAt ?? p.updatedAt
  return t ? dateFormat.format(t) : 'Projekt'
}
