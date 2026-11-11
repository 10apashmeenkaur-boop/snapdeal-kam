import Console from "@/components/Console";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { dev } = await searchParams;
  return <Console dev={dev === "1"} />;
}
