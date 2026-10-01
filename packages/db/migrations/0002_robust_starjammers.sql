CREATE TABLE "audio_takes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storyboard_id" uuid NOT NULL,
	"scene_id" text NOT NULL,
	"text_hash" text NOT NULL,
	"voice" text NOT NULL,
	"provider" text NOT NULL,
	"key" text,
	"duration_ms" integer NOT NULL,
	"words" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storyboard_id" uuid NOT NULL,
	"format" text NOT NULL,
	"key" text NOT NULL,
	"poster_key" text NOT NULL,
	"vtt_key" text NOT NULL,
	"frames" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"bytes" integer NOT NULL,
	"qa" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_takes" ADD CONSTRAINT "audio_takes_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "render_storyboard_format" ON "renders" USING btree ("storyboard_id","format");