import { notFound, redirect } from "next/navigation";
import { findView, pathForView } from "@/lib/nav";

type ViewPageProps = { params: Promise<{ view: string }> };

export default async function ViewPage({ params }: ViewPageProps) {
  const { view } = await params;
  const name = findView(view);
  if (!name) notFound();

  const target = pathForView(name);
  if (`/${view.toLowerCase()}` !== target) redirect(target);

  return (
    <section className="view">
      <h1>{name}</h1>
      <p>This view is planned for T-21+</p>
    </section>
  );
}
