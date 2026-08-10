# Idea Inventory

A treasure chest for every idea that turns up in your head — capture it, describe it,
answer the three questions that turn an idea into a project, then break it into tasks
and a timeline you can actually follow.

It is a single static web app: no build step, no framework, no server, no account
service. Everything you write is stored in your browser on your device.

![Colour scheme: maroon #660033 with warm neutrals, light and dark](icons/icon-192.png)

---

## What is in it

**Locked with your own email and password.** On first run you set them; after that the
app asks for the password to unlock. You stay signed in until you press *Log out* —
reloads, closed tabs and restarts do not sign you out. The password is stored as a
PBKDF2-SHA256 hash (120,000 iterations) with a random salt, never in plain text.

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

## Running it

Any static file server works, and so does opening `index.html` directly (though a
server is better — see the note below).

```bash
# from the project folder
python3 -m http.server 8000
# then open http://localhost:8000
```

> **Why a server matters:** browsers only expose the strong password hashing (WebCrypto)
> on `https://` and `localhost`. Opened straight off the filesystem the app falls back
> to a much weaker hash, and service workers are disabled. Use a server or a real host.

## Putting it on your phone and iPad

1. Publish the folder anywhere that serves static files over HTTPS. With GitHub Pages:
   push this branch, then **Settings → Pages → Deploy from a branch**, pick the branch
   and the `/` root. You will get a `https://<user>.github.io/<repo>/` URL.
2. Open that URL in Safari on the iPhone or iPad.
3. **Share → Add to Home Screen.** It installs with the treasure-chest icon, opens
   full screen without Safari's chrome, and works offline — the service worker caches
   the whole app.
4. Android/Chrome is the same flow via **Install app**.

Because the data lives in the browser, each device keeps its own inventory. To move
ideas across, use **Export a backup** on one device and **Import ideas** on the other
(both in the ⋮ menu in the header).

---

## Your data

- Ideas, tasks, notes, timelines, settings and the password hash live in
  `localStorage` under the `ideaInventory.*` keys — on your device, nowhere else.
- Nothing is uploaded anywhere. The only outbound request the app can ever make is to
  `api.anthropic.com`, and only if *you* saved an API key for timeline drafting.
- There is no password recovery, because there is no server to recover it from.
  Clearing your browser data (or "reset this device" on the login screen) erases
  everything — take an export first.

---

## How it is put together

```
index.html               app shell
manifest.webmanifest     PWA manifest (name, icons, standalone display)
sw.js                    service worker — offline cache
css/styles.css           design tokens, light + dark themes, every component
icons/                   generated PNG icons + SVG favicon
js/
  app.js                 boot, header, settings, theme, background archive sweep
  store.js               state, localStorage, auth hashing, priority rules, stats
  router.js              hash routing (#/ and #/idea/<id>/<tab>)
  ui.js                  rings, modals, confirm dialogs, toasts, popup menus
  util.js                hyperscript helper + local-time date maths
  icons.js               stroke icon set
  ai.js                  timeline planners (built-in heuristic + Claude API)
  views/
    auth.js              sign-up and unlock
    home.js              inventory dashboard and catalog
    ideaForm.js          add / edit idea modal
    idea.js              idea workspace shell + per-idea dashboard
    tasks.js             Kanban board, drag and drop, task detail, archive
    timeline.js          Gantt chart + AI planner dialog
```

No dependencies, no bundler, no `node_modules` — the files you see are the files that
run.

### Notes on the drag and drop

Cards use pointer events rather than HTML5 drag events, so the same code works with a
mouse, a trackpad, a finger and an Apple Pencil. Cards are set to `touch-action: pan-y`,
which means a vertical swipe scrolls the board as usual while a sideways drag picks the
card up; a long press picks it up too. Priority cards in Pending deliberately refuse to
move.
