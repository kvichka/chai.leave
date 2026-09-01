# Deploying

Publishes the app to GitHub Pages at `https://<your-username>.github.io/<repo>/`.

The database is already live — this only publishes the frontend that talks to it.

---

## One-time setup

### 1. Create the repository and push

There is no git repository yet. From `C:\dev\chai-leave`:

```bash
git init -b main
```

```bash
git add . && git commit -m "CHAI Cambodia leave management"
```

Create an empty repo on GitHub — **no** README, .gitignore or licence, or the
first push will conflict — then:

```bash
git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main
```

`.gitignore` already excludes `.env.local`, so your database password does not
go with it. Worth confirming before you push:

```bash
git ls-files | grep -c "^\.env\.local$"
```

That must print `0`.

#### Or: upload without the command line

If you would rather not use git, `chai-leave-github.zip` contains the same
files. Create the empty repository on GitHub, then on its front page choose
**uploading an existing file**, unzip the archive on your machine and drag the
*contents* — not the containing folder — into the browser. Commit directly to
`main`.

The archive already leaves out `node_modules`, `dist`, `.env.local` and
`demo-staff-passwords.csv`. Its paths use forward slashes, so GitHub keeps the
folder structure instead of flattening it.

Git is the better option if you plan to keep changing the app — every later edit
becomes one `git push` rather than another manual upload.

### 2. Turn on Pages

Repository → **Settings** → **Pages** → Source: **GitHub Actions**.

Not "Deploy from a branch" — the workflow uploads an artifact directly.

### 3. Add the two build variables

Settings → **Secrets and variables** → **Actions** → the **Variables** tab
(not Secrets):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://zuiddjqsuijvquiayzzk.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your `anon` / publishable key |

Optionally `VITE_ALLOWED_EMAIL_DOMAIN` to restrict sign-in to one domain.

**Do not add `VITE_DEMO_PASSWORD` here.** It powers the one-click demo sign-in
panel and lives only in your local `.env.local`. Setting it as a repository
variable would compile the demo staff's shared password into a bundle served to
the open internet — and one of those accounts is an HR administrator, who can
see every employee and reset anyone's password. The panel is stripped from
production builds regardless; the variable is the only way to undo that.

**Variables, deliberately, not Secrets.** Both values are compiled into the
JavaScript that Pages serves to the open internet — anyone can read them out of
the bundle. Putting them in Secrets would hide them from the settings page while
leaving them in plain sight in the published code, which is worse than not
hiding them at all: it invites someone to believe the key is a control. It is
not. Row Level Security is the control. See the README's *Security model*.

The build fails with a clear message if either is missing.

### 4. Point Supabase at the deployed URL

Supabase dashboard → **Authentication** → **URL Configuration**:

- **Site URL**: `https://<you>.github.io/<repo>/`
- **Redirect URLs**: add the same, and keep `http://localhost:5173` for local work

---

## What happens on every push to `main`

```
unit ──────────┐
               ├──> build ──> deploy
database ──────┘
```

| Job | What it does | Blocks the deploy? |
|---|---|---|
| **unit** | `tsc --noEmit`, 51 unit tests | yes |
| **database** | Starts a throwaway Supabase on the runner, applies all 13 migrations and the seed, runs the 13 RLS checks and acceptance suites A–D | yes |
| **build** | Compiles, then refuses to publish if a `service_role` key or any sourcemap reached `dist` | yes |
| **deploy** | Publishes to Pages | — |

Pull requests run **unit** and **database** but do not deploy.

Note the `database` job runs the *full local Docker stack* on GitHub's runners —
the one your laptop cannot run. So CI genuinely tests more than you can locally,
which is the main reason it is worth having here.

The build summary reports the deploy size and the largest chunks, so a
regression in bundle size is visible on the run page rather than discovered
months later.

---

## Checking it worked

1. Actions tab → the run should be green across all four jobs
2. Open `https://<you>.github.io/<repo>/`
3. Sign in with an account created through Admin → Employees

**The developer sign-in panel will not be there.** It is compiled out of
production builds, and the seeded demo accounts only exist on a database that
has had `seed.sql` sections 4–7 applied. Create yourself a real account first —
see the README's *Create the first administrator*.

---

## If something fails

| Symptom | Cause |
|---|---|
| Blank page, 404s on `/assets/…` | `VITE_BASE_PATH` wrong. The workflow derives it from the repo name; a renamed repo needs a fresh run. |
| "Not connected to a database" screen | The two repository variables are missing or misspelt. |
| Sign-in fails only on the deployed site | The Pages URL is not in Supabase's redirect allow-list (step 4). |
| `database` job fails but the app works | A real regression in the business rules. Read the failing assertion before dismissing it — that suite has already caught five genuine bugs. |
| `npm ci` fails | `package-lock.json` was not committed. |

---

## Free-tier warning

Supabase pauses a project after roughly a week without activity. A leave app has
quiet weeks. The first person to visit a paused project gets an error, not a
spinner, and somebody has to click **Restore** in the dashboard.

For anything beyond testing, budget the Pro tier (about USD 25/month) or accept
that this will happen.
