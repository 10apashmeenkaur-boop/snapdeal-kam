import Link from "next/link";
import DevToolPanel from "@/components/DevToolPanel";

// Phase 2 placeholder. The full dashboard + call panel arrive in Phase 3/4.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { dev } = await searchParams;
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      <h1 className="mb-1 text-xl font-semibold text-zinc-900">Snapdeal Virtual KAM</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Dashboard coming in Phase 3.{" "}
        {dev !== "1" && (
          <Link className="text-rose-600 underline" href="/?dev=1">
            Open the dev tool panel
          </Link>
        )}
      </p>
      {dev === "1" && <DevToolPanel />}
    </main>
  );
}
