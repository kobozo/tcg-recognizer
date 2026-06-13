import DemoLayout from "@/components/DemoLayout";

// This is the copy-paste template for new community demos.
// 1. Copy this folder to app/demos/<your-slug>/
// 2. Edit the title, author and content below.
// 3. Add a matching line to app/demos/registry.ts
export default function HelloDemoPage() {
  return (
    <DemoLayout title="Hello Demo" author="kobozo">
      <p>
        Welcome to the first community demo! This page is a friendly starting
        point that shows how anyone can add their own page to the site.
      </p>
      <p>
        You do not need to touch any of the core app code. Just copy this folder,
        change the text, and add one line to the registry. The shared layout and
        site header are handled for you, so your page always fits in with the
        rest of the site.
      </p>
      <p>Have fun, and build something cool.</p>
    </DemoLayout>
  );
}
