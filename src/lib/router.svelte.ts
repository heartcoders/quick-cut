/** Screens innerhalb eines Projekts: `#/p/<id>/<screen>`. */
export const PROJECT_ROUTES = ['record', 'cut', 'export'] as const
export type ProjectRoute = (typeof PROJECT_ROUTES)[number]
export type Route = 'home' | 'settings' | ProjectRoute

export interface Location {
  route: Route
  projectId: string | null
}

const HOME: Location = { route: 'home', projectId: null }

export function parseHash(hash: string): Location {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('?')[0]!
    .split('/')
    .filter(Boolean)
  if (parts[0] === 'settings') return { route: 'settings', projectId: null }
  if (parts[0] === 'p' && parts[1]) {
    const screen = parts[2] ?? 'cut'
    const route = (PROJECT_ROUTES as readonly string[]).includes(screen) ? (screen as ProjectRoute) : 'cut'
    return { route, projectId: decodeURIComponent(parts[1]) }
  }
  // Auch alte Links (#/record, #/cut …) aus der Zeit mit nur einem Projekt.
  return HOME
}

export function toHash({ route, projectId }: Location): string {
  if (route === 'home') return '#/'
  if (route === 'settings') return '#/settings'
  return `#/p/${encodeURIComponent(projectId ?? '')}/${route}`
}

class Router {
  current = $state<Route>('home')
  projectId = $state<string | null>(null)

  start(): () => void {
    const sync = () => {
      const loc = parseHash(location.hash)
      this.current = loc.route
      this.projectId = loc.projectId
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }

  /**
   * Navigieren. Projekt-Screens ohne `projectId` bleiben im geöffneten Projekt.
   */
  go(route: Route, { replace = false, projectId }: { replace?: boolean; projectId?: string } = {}): void {
    const isProject = route !== 'home' && route !== 'settings'
    const id = isProject ? (projectId ?? this.projectId) : null
    if (isProject && !id) return
    const hash = toHash({ route, projectId: id })
    if (replace) {
      history.replaceState(null, '', hash)
      this.current = route
      this.projectId = id
    } else if (location.hash !== hash) {
      location.hash = hash // löst hashchange aus
    }
  }
}

export const router = new Router()
