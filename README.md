# Idea Inventory

**Live at [mariqa2002.github.io/IdeaInventory](https://mariqa2002.github.io/IdeaInventory/)**

A treasure chest for every idea that turns up in your head — capture it, describe it,
answer the three questions that turn an idea into a project, then break it into tasks
and a timeline you can actually follow.

One account, every device. Your phone, your iPad and your laptop all show the same
inventory, and it keeps working when you have no signal.

---

## What is in it

**One inventory, everywhere.** Sign in on any device and your ideas are there. Edits
sync both ways — add a task on your phone on the bus and it is on your laptop when you
get home. The app is *local-first*: every change is written to the device first, so it
never waits on the network, then syncs in the background. With no connection it carries
on working and pushes everything up when you are back online.

**Locked with your own email and password.** You stay signed in until you press
*Log out* — reloads, closed tabs and restarts do not sign you out.

**The inventory dashboard** — circular progress rings for ideas captured, ideas
completed and tasks completed across everything, a catalog you can flip between
**square view** and **list view**, and an *Add an Idea* button (a floating one on
phones). Each card shows the title, the description underneath it, its priority
number, task progress, and a warning chip when the long-form questions are still blank.

**Adding an idea** asks for a title, a description, and three long-form questions —
*Why am I making this project? Who is this project for? What is going to make it
valuable?* Those three are optional at creation, but the app keeps reminding you: a
chip on the idea card, a banner on the idea's dashboard, and a count in the toast when
you save.

**Priority is smart.** Priority numbers always form a gapless run — 1, 2, 3, … If you
give a new idea #2 and something already holds #2, that idea (and everything below it)
slides down one. The picker tells you which idea is about to be pushed. Deleting an
idea closes the gap again.

**Every idea opens into its own workspace** with a collapsible sidebar:

- **Dashboard** — rings for tasks added, tasks completed and days of runway left
  (taken straight from the timeline), plus what is on today, what is coming up this
  week, anything overdue, and the tasks with no dates yet in the order you added them.
- **Tasks** — a Kanban board: **Pending → In Progress → On Hold → Completed**. Drag
  cards between columns with a mouse or a finger, add and delete tasks, and open any
  card for notes/comments, an optional completion date and an optional start date and
  duration. A task marked **Priority** is pinned to the top of Pending, gets a maroon
  border, and cannot be dragged out of place. Completed tasks slide into an
  **Archive** 30 minutes after they are finished (the delay is configurable, and the
  archive column is hidden until you ask for it).
- **Timeline** — a Gantt chart in days or weeks. Drag a bar to move it, drag its right
  edge to change how long the task takes, or edit the dates in the task detail. Today
  is marked, weekends are shaded, and the whole thing feeds the "days left" ring on
  the dashboard.

**The timeline can draft itself.** *Generate timeline* reads the project brief and the
task titles, sorts the work into delivery phases (research → planning → design → build
→ test → launch → aftercare), estimates a realistic length for each task, runs up to
two tasks in parallel and lays it all out around your weekends. It runs offline on
your device. If you would rather have Claude's judgement, paste an Anthropic API key
into Settings and the same brief goes to the Claude API instead — with the built-in
planner as the fallback if the call fails. Either way you get an **Undo** for a few
seconds after it lands.

**Light and dark.** Light is the default. Both are built from maroon `#660033` with
warm, low-chroma neutrals — no bright colours anywhere.

---

## Setting up sync — once, about five minutes

The app is static files; the ideas live in a free [Supabase](https://supabase.com)
project that you own.

1. **Create the project.** Sign up at supabase.com, create a new project, and wait for
   it to finish provisioning. The free tier is plenty — this app stores text.
2. **Create the tables.** Open **SQL Editor → New query**, paste in the whole of
   [`supabase/schema.sql`](supabase/schema.sql) from this repo, and press Run. That
   creates the three tables, the triggers that stamp `updated_at`, and the Row Level
   Security policies that make each row readable only by the account that owns it.
3. **Copy your two values.** **Project Settings → API** gives you the *Project URL*
   and the *anon public* key.
4. **Tell the app.** Open the app and paste both in when it asks. To save doing that on
   every device, put them in [`js/config.js`](js/config.js) and commit — then each new
   device only needs your email and password.
5. **Create your account** in the app, and sign in with the same email and password on
   every other device.

**A note on the confirmation email.** New Supabase projects ask people to confirm their
address, so after creating the account you will get an email with a link to click. If
you would rather skip it, turn off **Authentication → Sign In / Providers → Email →
Confirm email** in the Supabase dashboard *before* creating the account.

**On the two values being public.** They are meant to be. The anon key identifies the
project, not you, and on its own it can read nothing: every table is guarded by the
policies in `schema.sql`, which only ever expose rows whose `user_id` matches the
signed-in account. Your password is handled by Supabase and never touches this code.
The one key you must never put in the repo is the *service_role* key, which bypasses
those policies.

### Prefer not to use a server at all?

The setup screen offers **"Skip — use this device only"**. The app then keeps
everything in that browser with a local password, exactly as it did before sync
existed. You can connect a project later from Settings, and the ideas already on the
device get uploaded when you first sign in.

## Running it locally

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

## Putting it on your phone and iPad

1. It is already published at **https://mariqa2002.github.io/IdeaInventory/**
   (GitHub Pages, **Settings → Pages → Deploy from a branch**, this branch, `/` root).
   Every push redeploys it. Any other static HTTPS host works too — every path in the
   app is relative, so it does not care whether it sits at a domain root or in a
   sub-folder.
2. Open that URL in Safari on the iPhone or iPad.
3. **Share → Add to Home Screen.** It installs with the treasure-chest icon, opens
   full screen without Safari's chrome, and works offline.
4. Android/Chrome is the same flow via **Install app**.

---

## How sync behaves

Worth knowing, because these are the moments where sync engines usually surprise people:

- **Push first, then pull.** Local changes always reach the server before anything
  comes back, so a sync can never overwrite an edit that has not been sent yet.
- **The database owns the clock.** `updated_at` is stamped by a Postgres trigger, and
  each device remembers the newest one it has seen. A laptop with a slow clock cannot
  hide a change from your phone.
- **Last write wins, per record.** Two devices editing *different* ideas — or different
  tasks in the same idea — never collide. If you genuinely edit the same task in two
  places while offline, the one that syncs last is the one that survives.
- **Delete beats edit.** Deletes travel as tombstones, so an idea you deleted on your
  phone does not reappear because your laptop still had it open.
- **Offline is normal, not an error.** Changes queue on the device; the header pill
  shows how many are waiting and flushes them when the connection returns.

The header pill is the whole status at a glance: *Synced*, *Syncing…*, *N waiting*,
*Offline*, or *Sync issue*. Tap it to sync immediately.

## Your data

- The server holds only what you type: ideas, tasks, notes and dates. Your password is
  managed by Supabase's auth service; this app never sees or stores it.
- Each device also keeps a full local copy so it works offline. **Erase this device**
  in Settings clears that copy without touching the server.
- **Export a backup** in the ⋮ menu writes the whole inventory to a JSON file, and
  **Import ideas** reads one back. Worth doing occasionally regardless.
- The only other outbound request the app can make is to `api.anthropic.com`, and only
  if you saved an API key for timeline drafting.

---

## How it is put together

```
index.html               app shell
manifest.webmanifest     PWA manifest (name, icons, standalone display)
sw.js                    service worker — offline cache
supabase/schema.sql      tables, updated_at triggers, row level security
css/styles.css           design tokens, light + dark themes, every component
icons/                   generated PNG icons + SVG favicon
js/
  app.js                 boot, auth gate, header, settings, sync scheduling
  config.js              Supabase URL + anon key defaults
  supabase.js            auth + REST over plain fetch (no SDK)
  sync.js                push/pull engine, cursors, conflict rules
  store.js               local state, dirty tracking, tombstones, priority rules
  router.js              hash routing (#/ and #/idea/<id>/<tab>)
  ui.js                  rings, modals, confirm dialogs, toasts, popup menus
  util.js                hyperscript helper + local-time date maths
  icons.js               stroke icon set
  ai.js                  timeline planners (built-in heuristic + Claude API)
  views/
    auth.js              connection setup, cloud sign-in, device-only mode
    home.js              inventory dashboard and catalog
    ideaForm.js          add / edit idea modal
    idea.js              idea workspace shell + per-idea dashboard
    tasks.js             Kanban board, drag and drop, task detail, archive
    timeline.js          Gantt chart + AI planner dialog
```

No dependencies, no bundler, no `node_modules` — not even the Supabase SDK, which is
just REST underneath. The files you see are the files that run.

### Notes on the drag and drop

Cards use pointer events rather than HTML5 drag events, so the same code works with a
mouse, a trackpad, a finger and an Apple Pencil. Cards are set to `touch-action: pan-y`,
which means a vertical swipe scrolls the board as usual while a sideways drag picks the
card up; a long press picks it up too. Priority cards in Pending deliberately refuse to
move.
