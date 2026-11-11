/**
 * "Send to MFD" window, opened by Freeboard-SK when the user chooses the
 * action on a route (see src/freeboard.ts). Freeboard loads it from this
 * server, so it calls the plugin's upload API with the user's own session.
 */

import { resolveTheme } from '../lib';
import { connectBus } from './bus';
import {
  NAME_LIMIT,
  UPLOAD_URL,
  failureMessage,
  mfdName,
  routeSummary,
  routeTarget,
  sentMessage,
} from './send-lib';
import type { Theme } from '../lib';
import type { RouteTarget } from './send-lib';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const what = el<HTMLDivElement>('what');
const nameInput = el<HTMLInputElement>('name');
const sendButton = el<HTMLButtonElement>('send');
const message = el<HTMLParagraphElement>('message');

let route: RouteTarget | undefined;
/** The route's own name, which the MFD gets when the name field is empty. */
let routeName = '';
/** Bumped per target, so a late answer for an earlier route is ignored. */
let generation = 0;
let sending = false;

function setTheme(theme: Theme): void {
  document.documentElement.className = theme === 'night' ? 'theme-night' : 'theme-day';
}

function say(text: string, kind?: 'ok' | 'error' | 'busy'): void {
  message.textContent = text;
  message.className = 'message' + (kind ? ' message-' + kind : '');
}

function update(): void {
  sendButton.disabled = !route || sending;
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    throw new Error(failureMessage(res.status, body));
  }
  return body;
}

function show(invocation: unknown): void {
  const run = ++generation;
  const target = routeTarget(invocation);
  route = undefined;
  routeName = '';
  say('');
  if ('problem' in target) {
    what.textContent = target.problem;
    nameInput.value = '';
    nameInput.disabled = true;
    update();
    return;
  }
  what.textContent = 'Route: ' + (target.name || target.id);
  nameInput.value = mfdName(target.name);
  nameInput.disabled = false;
  update();
  getJson(target.url)
    .then((resource) => {
      if (run !== generation) {
        return;
      }
      const summary = routeSummary(resource, target.name);
      what.textContent =
        'Route: ' + (summary.name || target.id) + ' (' + summary.points + ' points)';
      if (summary.fromMfd) {
        say('This route came from the MFD; it is already there.');
        nameInput.disabled = true;
        update();
        return;
      }
      nameInput.value = mfdName(summary.name);
      routeName = summary.name;
      route = target;
      update();
    })
    .catch((err: unknown) => {
      if (run === generation) {
        say(err instanceof Error ? err.message : String(err), 'error');
      }
    });
}

async function send(): Promise<void> {
  const target = route;
  if (!target || sending) {
    return;
  }
  const run = generation;
  const name = mfdName(nameInput.value);
  sending = true;
  update();
  say('Sending…', 'busy');
  try {
    await getJson(UPLOAD_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ routes: [name ? { id: target.id, name } : { id: target.id }] }),
    });
    if (run === generation) {
      say(sentMessage(name || mfdName(routeName) || target.id), 'ok');
      // Uploads only add on the MFD: a second click would make a copy.
      route = undefined;
    }
  } catch (err) {
    if (run === generation) {
      say(err instanceof Error ? err.message : String(err), 'error');
    }
  } finally {
    sending = false;
    update();
  }
}

setTheme(
  resolveTheme(
    location.search,
    !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches,
  ),
);
nameInput.maxLength = NAME_LIMIT;
sendButton.addEventListener('click', () => void send());

connectBus()
  .then(async (bus) => {
    show(bus.handshake.context && bus.handshake.context.invocation);
    // A window that stays open hears later choices as events.
    await bus.subscribe(['action.invoked'], (_event, invocation) => show(invocation));
    if (bus.has('nightMode')) {
      const follow = (state: unknown) => {
        const enabled = (state as { enabled?: unknown } | null)?.enabled;
        setTheme(enabled === true ? 'night' : 'day');
      };
      await bus.subscribe(['nightMode.changed'], (_event, state) => follow(state));
      follow(await bus.call('nightMode.get'));
    }
  })
  .catch(() => {
    what.textContent = 'Open this window from a route in Freeboard-SK.';
  });
