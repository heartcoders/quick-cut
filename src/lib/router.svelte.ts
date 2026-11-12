export const ROUTES = ['record', 'cut', 'export'] as const
export type Route = (typeof ROUTES)[number]

const DEFAULT_ROUTE: Route = 'record'

export function parseHash(hash: string): Route {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? ''
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT_ROUTE
}

class Router {
  current = $state<Route>(DEFAULT_ROUTE)

  start(): () => void {
    const sync = () => {
      this.current = parseHash(location.hash)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }

  go(route: Route, { replace = false } = {}): void {
    const hash = `#/${route}`
    if (replace) {
      history.replaceState(null, '', hash)
      this.current = route
    } else if (location.hash !== hash) {
      location.hash = hash // löst hashchange aus
    }
  }
}

export const router = new Router()
