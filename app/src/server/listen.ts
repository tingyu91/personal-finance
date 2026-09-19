/** Tally only ever listens on loopback. Nothing is reachable from the network. */
export const LISTEN = { hostname: '127.0.0.1', port: 5317 } as const;
