import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { WorkingDots } from "./working-dots.js";

const BUSY_VERBS = [
  "Bamboozling",
  "Bamming",
  "Cowabunga-ing",
  "Gadzooksing",
  "Gee whizzing",
  "Gee willikering",
  "Gollying",
  "Great Scotting",
  "Holy guacamoleing",
  "Holy mackereling",
  "Holy moleying",
  "Hot diggitying",
  "Jeepersing",
  "Jiminy cricketing",
  "Kablooeying",
  "Kabooming",
  "Kapowing",
  "Kersplatting",
  "Klonking",
  "Leapin' lizarding",
  "Powieing",
  "Sakes aliving",
  "Shazaming",
  "Thwacking",
  "Up-up-and-awaying",
  "Vrooming",
  "Whamming",
  "Whiz-banging",
  "Whomping",
  "Zlonking",
  "Zonking",
  "Zwapping",
];

export function BusyIndicator({ className }: { className?: string }) {
  const [verb, setVerb] = useState(
    () => BUSY_VERBS[Math.floor(Math.random() * BUSY_VERBS.length)],
  );
  useEffect(() => {
    const id = setInterval(() => {
      setVerb(BUSY_VERBS[Math.floor(Math.random() * BUSY_VERBS.length)]);
    }, 2500);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-normal text-muted-foreground",
        className,
      )}
    >
      <WorkingDots size="md" className="text-accent" />
      {verb}…
    </span>
  );
}
