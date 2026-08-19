function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeGreeting({ title }: { title: string }) {
  return (
    <div className="pb-4">
      <p className="mb-1 text-[18px] text-muted-foreground">
        {greetingFor(new Date().getHours())}
      </p>
      <h1 className="text-[40px] leading-none font-bold tracking-[-1px] text-foreground">
        {title}
      </h1>
    </div>
  );
}
