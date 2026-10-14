-- Public URLs of images uploaded to an image host (ImgBB), keyed by the SHA-256 of the image bytes, so a restart or another replica reuses an upload instead of repeating it.
CREATE TABLE "public_image_urls" (
	"sha256" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
