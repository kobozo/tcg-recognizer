# Contributing a community demo page

Welcome! 👋 This guide is for classmates (and the AI helpers working with them)
who want to add a demo page to the site. You do **not** need to be a developer —
if you can copy a folder and change some text, you can do this.

Your page lives under `apps/web/app/demos/`. Nothing you do here can break the
main site: the shared layout and the site header are handled for you.

## How to add your page

1. **Copy the starter page.** In `apps/web/app/demos/`, copy the `hello` folder
   to a new folder named after your demo, for example `app/demos/my-cool-thing/`.
   The folder name (the "slug") becomes the URL: `/demos/my-cool-thing`.

2. **Edit your page.** Open `page.tsx` in your new folder and change the
   `title`, `author`, and the friendly content. Keep the `<DemoLayout>` wrapper —
   that is what keeps your page looking like the rest of the site.

3. **Add one line to the registry.** Open `apps/web/app/demos/registry.ts` and
   add an entry to the `demos` array so your page shows up on the `/demos` list:

   ```ts
   { slug: "my-cool-thing", title: "My Cool Thing", description: "What it does.", author: "your-name" },
   ```

4. **Test it locally.** Run `docker compose up` and open
   `http://192.168.3.177:3000/demos` to see your page in the list, then click
   through to it.

5. **Open a pull request.** Push your branch and open a PR. The PR template has a
   short checklist — please tick the boxes and attach a screenshot of your page.

## What happens next

- **CI** runs automatically: it type-checks and tests the app to make sure
  nothing is broken.
- The **Sentinel agent** will look at your PR, help shepherd it through, and let
  you know if anything needs a tweak.
- Because demo pages live in an open area of the project, once everything is
  green you can merge your own page — no waiting on a maintainer.

## The one rule

Please keep your changes **only under `app/demos/`** (plus your one line in the
registry). That keeps everyone's demos isolated and the main site safe. If you
think you need to touch anything else, ask first. 🙂

Happy building!
