import type { Testimonial } from "../../content.js";
import { withBrand } from "../../content.js";
import { SectionLabel, SectionTitle } from "./section-kit.js";

/* UNIT_BOUNDARY_DESCRIPTION: The "From the community" section: what users say
 * about the product, three cards in the first row and the rest centred below.
 * Each card shows the person's photo when the operator uploaded one, and their
 * initials otherwise. With no
 * testimonials the section is not rendered. */
const FIRST_ROW: Record<number, string> = {
  1: "mx-auto grid w-full grid-cols-1 gap-5 md:max-w-[calc(50%-10px)] lg:max-w-[calc(33.333%-14px)]",
  2: "mx-auto grid w-full grid-cols-1 gap-5 md:grid-cols-2 lg:max-w-[calc(66.666%+10px)]",
  3: "grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3",
};

export function TestimonialsSection({
  brand,
  testimonials,
}: {
  brand: string;
  testimonials: Testimonial[];
}) {
  if (testimonials.length === 0) return null;

  return (
    <section className="bg-section min-h-dvh snap-start overflow-hidden py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="text-center">
          <SectionLabel>From the community</SectionLabel>
          <SectionTitle>
            See how your colleagues
            <br />
            are using {brand}.
          </SectionTitle>
          <p className="text-muted-foreground mt-4 text-[16px] leading-relaxed">
            Real stories from teams running agents every day.
          </p>
        </div>

        <div className="mt-16 flex flex-col gap-5">
          <div className={FIRST_ROW[Math.min(testimonials.length, 3)]}>
            {testimonials.slice(0, 3).map((t, i) => (
              <TestimonialCard key={i} testimonial={t} brand={brand} />
            ))}
          </div>
          {testimonials.length > 3 && (
            <div className="mx-auto grid w-full grid-cols-1 gap-5 md:grid-cols-2 lg:max-w-[calc(66.666%+10px)]">
              {testimonials.slice(3).map((t, i) => (
                <TestimonialCard key={i + 3} testimonial={t} brand={brand} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({
  testimonial: { name, role, quote, photoUrl, initials, color },
  brand,
}: {
  testimonial: Testimonial;
  brand: string;
}) {
  return (
    <figure className="border-input bg-background break-inside-avoid rounded-2xl border p-6">
      <svg
        viewBox="0 0 24 24"
        className="text-foreground/10 size-6"
        fill="currentColor"
        aria-hidden
      >
        <path d="M11.3 5.1C7.6 6.4 5.2 9.3 5.2 13c0 2.4 1.3 4 3.2 4 1.5 0 2.7-1 2.7-2.4 0-1.4-1-2.3-2.4-2.3-.4 0-.8.1-1 .2.3-2 2-4 4.2-5l-.6-2.4zm8 0C15.6 6.4 13.2 9.3 13.2 13c0 2.4 1.3 4 3.2 4 1.5 0 2.7-1 2.7-2.4 0-1.4-1-2.3-2.4-2.3-.4 0-.8.1-1 .2.3-2 2-4 4.2-5l-.6-2.4z" />
      </svg>
      <blockquote className="text-foreground/80 mt-3 text-[15px] leading-relaxed">
        {withBrand(quote, brand)}
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            className="size-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{ background: color }}
            aria-hidden="true"
          >
            {initials}
          </div>
        )}
        <div>
          <p className="text-foreground text-[14px] font-semibold">{name}</p>
          {role && <p className="text-muted-foreground text-[13px]">{role}</p>}
        </div>
      </figcaption>
    </figure>
  );
}
