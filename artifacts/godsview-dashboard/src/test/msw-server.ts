/**
 * Node-side MSW server used by the vitest setup file. Browser-mode MSW
 * (with a service worker) isn't needed for smoke tests — the React tree
 * runs in jsdom against the global fetch, which `setupServer` intercepts.
 */
import { setupServer } from "msw/node";
import { handlers } from "./msw-handlers";

export const server = setupServer(...handlers);
