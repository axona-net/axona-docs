# PWA auto-update: the recipe every Axona app should follow

**v0.1 — 2026-09-29 — axona.bot**
Written for David, council seq 555, after two Chrome windows of the same app
disagreed about which version they were running.

## The question

Why does one window pick up a deploy and the window beside it does not?

A service worker is shared by every same-origin client, so it is tempting to
read "the worker updated" as "the app updated". It does not follow. The worker
is shared; **the decision to reload is not.** Each window runs its own copy of
the page, and a window that never asks whether a new worker exists, or never
hears that one took control, keeps serving the build it loaded with. Nothing is
broken in that window. It simply has no reason to move.

So the recipe is not "install a service worker". It is: give every window its
own reason to check, its own reason to reload, and a backstop for the window the
first two miss.

## Why this matters more here than in most apps

For most applications a stale tab is a cosmetic problem — an old build that
still works. Axona is not that case. **The kernel pin ships inside the bundle.**
A client left on a superseded kernel reaches the bridge, then never forms a
mesh. The user sees "connecting" forever, with no error.

That failure has cost the same day twice. On 2026-09-04 it was investigated as a
Safari ICE problem before the cause turned out to be a worker still serving a
pre-4.75 build against an all-4.75 fleet. The remedy recorded at the time was "a
cache clear, not a code change", which fixes one browser on one day. It recurred
on 2026-09-08, with four builds still in one machine's precache, the oldest the
4.75.1 from the first incident.

A manual remedy for a condition that regenerates on every release is not a
remedy. That is the whole argument for applying updates automatically.

## The recipe

### 1. Deploy on push

A GitHub Actions workflow builds on push to `main` and publishes. Nothing about
the client matters until the new bundle is actually being served.

### 2. `registerType: 'prompt'`, and send the message yourself

Do **not** use `'autoUpdate'`. It calls `skipWaiting` the instant a worker
installs, which reloads the page mid-sentence and leaves the app no chance to
defer. Keep the registration message-gated so the decision stays in the app,
where it can see the caret — then send the message on the user's behalf instead
of waiting for a click. This is also what makes workbox's `clientsClaim` safe to
turn on.

```js
VitePWA({ registerType: 'prompt', workbox: { clientsClaim: true } })
```

`clientsClaim: true` matters: without it the activated worker takes control of
the *next* navigation rather than the windows already open.

### 3. EVERY window polls for itself

This is the step that decides whether your second window updates.

```js
onRegisteredSW(_swUrl, registration) {
  const check = () => { registration.update().catch(() => {}); };
  setInterval(check, 60_000);
  document.addEventListener('visibilitychange',
    () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('online', check);
}
```

Three triggers, because they fail in different conditions. The interval covers a
window left open and untouched; refocus covers the most common "am I a deploy
behind?" moment; `online` covers a machine that was asleep when the deploy
landed. A window that only checks on focus will sit stale indefinitely behind
another window.

### 4. Apply on your own, and never over typing

```js
const attempt = () => {
  if (userIsEditing()) { setTimeout(attempt, 2000); return; }   // re-ask, do not drop
  apply();
};
setTimeout(attempt, 2500);
document.addEventListener('visibilitychange',
  () => { if (document.visibilityState === 'hidden') attempt(); });
```

`userIsEditing()` is true when the caret is in an `input`, a `textarea`, or
anything `contentEditable`. A hidden tab is the safest moment there is: nothing
is being typed into it and the reload finishes before anyone looks again.

Deferring must RE-ASK rather than cancel. A deferral that drops the update
produces a window that is permanently one release behind and reports nothing.

### 5. The backstop, and this is the one that bites

```js
navigator.serviceWorker.addEventListener('controllerchange',
  () => window.location.reload());
updateServiceWorker(true);
```

Arm `controllerchange` **before** applying, and guard it so it runs once.

`vite-plugin-pwa` has its own `controlling` listener, and it **does not fire for
a window the previous worker never controlled.** A window opened fresh after the
last activation is exactly that case. This is what makes a Reload button appear
to do nothing, and it is the most likely shape of "only one of my two windows
updated" — the window that updates is the one the old worker was controlling.

## What a correct implementation looks like from outside

Open two windows on the same origin. Deploy. Within one check interval both
windows reload on their own, neither discards a half-typed message, and a window
left hidden throughout comes back already on the new build.

If exactly one window updates, suspect step 3 or step 5 before anything else.

## What this does not do

It does not make an update instant. Detection is bounded by the check interval,
and application waits for the grace period or for the caret to leave a field, so
a user typing continuously holds their own window back — deliberately.

It does not help a browser with service workers disabled, and it does not
protect a window whose JavaScript has already failed; a page that cannot run its
own update logic cannot update itself.

It says nothing about whether the new build is correct. It only ensures the
build being served is the build being run.

## Reference implementation

`axona-chat/src/components/UpdatePrompt.jsx` and the `VitePWA` block in
`axona-chat/vite.config.js`, as of 0.73.0. The constants there are
`CHECK_INTERVAL_MS = 60_000`, `APPLY_GRACE_MS = 2500`,
`BUSY_RECHECK_MS = 2000`.
