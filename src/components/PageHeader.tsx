export default function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="pt-10 pb-6 sm:pt-14">
      {eyebrow && <div className="text-xs font-medium uppercase tracking-wider text-accent">{eyebrow}</div>}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function SectionTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mt-14 mb-4">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{children}</p>}
    </div>
  );
}
