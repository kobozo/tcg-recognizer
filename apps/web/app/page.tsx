import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-20 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        Recognize any Pokémon card in seconds
      </h1>
      <p className="max-w-xl text-lg text-gray-600">
        Upload a photo of your trading card and get an instant attribute
        breakdown — name, type, set, rarity and more, with confidence scores.
      </p>
      <Link
        href="/scan"
        className="rounded-lg bg-blue-600 px-6 py-3 text-lg font-semibold text-white hover:bg-blue-700"
      >
        Scan a card
      </Link>
    </main>
  );
}
